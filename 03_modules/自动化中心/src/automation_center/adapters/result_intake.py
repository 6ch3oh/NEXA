"""Thin reader for existing legacy machine-readable execution result artifacts.

This adapter does not read raw execution logs, connect to n8n, or reconstruct an
execution. It only normalizes two explicitly supplied final result artifacts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from automation_center.application.results import (
    AutomationExecutionResultRecord,
    BusinessResultStatus,
    DependencyClass,
    ExecutionEngineReality,
    ProvenanceCompleteness,
    ProviderInstanceContextSource,
    ResultArtifactKind,
    ResultDiagnostic,
    ResultDiagnosticCode,
    ResultEnvironmentClass,
    ResultExecutionStatus,
    ResultSourceClassification,
    ResultSourceEvidence,
    ResultType,
    SourceArtifactIntegrity,
)


_PROVIDER_KIND = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_SAFE_CONTEXT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$")
_SENSITIVE_KEY = re.compile(
    r"(?:credential|password|secret|token|api[_-]?key|authorization|cookie|headers?|"
    r"prompt|full[_-]?content|binary|raw[_-]?payload)",
    re.IGNORECASE,
)
_ALLOWED_RESULT_FIELDS = {
    "webpage_read_status",
    "web_checked_at",
    "http_status_code",
    "web_error_code",
    "web_text_length",
}
_ALLOWED_RESULT_ITEM_KEYS = {"execution_id", "test_output_reached", "fields"}
_ALLOWED_RUN_ITEM_KEYS = {"case", "execute_exit_code", "execution_status"}


@dataclass(frozen=True, slots=True)
class ResultIntakeContext:
    provider_kind: str = "n8n"
    provider_instance_context: str | None = None
    result_type: ResultType = ResultType.WEBPAGE_READ
    result_artifact_ref: str = "legacy-result:machine-result"
    run_summary_artifact_ref: str = "legacy-result:run-summary"
    report_ref: str = "legacy-report:execution-result"

    def __post_init__(self) -> None:
        if not isinstance(self.provider_kind, str) or not _PROVIDER_KIND.fullmatch(self.provider_kind):
            raise ValueError("provider_kind must be a lowercase provider slug")
        if self.provider_instance_context is not None:
            if not isinstance(self.provider_instance_context, str) or not _SAFE_CONTEXT.fullmatch(
                self.provider_instance_context
            ):
                raise ValueError("provider_instance_context must be a safe caller-declared identifier")
        if not isinstance(self.result_type, ResultType):
            raise TypeError("result_type must be ResultType")
        for field_name in ("result_artifact_ref", "run_summary_artifact_ref", "report_ref"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip() or len(value) > 512:
                raise ValueError(f"{field_name} must be a safe logical reference")
            if "://" in value or re.match(r"^(?:[A-Za-z]:[\\/]|[/\\]{1,2})", value):
                raise ValueError(f"{field_name} must not be a URL or absolute path")


class ResultIntakeError(ValueError):
    def __init__(self, code: ResultDiagnosticCode, message: str) -> None:
        self.code = code
        self.diagnostics = (ResultDiagnostic(code, message),)
        super().__init__(message)


class LegacyExecutionResultAdapter:
    """Read final result JSON plus run summary JSON through an allowlist."""

    def read_files(
        self,
        result_path: str | Path,
        run_summary_path: str | Path,
        context: ResultIntakeContext,
    ) -> tuple[AutomationExecutionResultRecord, ...]:
        return self.read_artifacts(
            Path(result_path).read_bytes(),
            Path(run_summary_path).read_bytes(),
            context,
        )

    def read_artifacts(
        self,
        result_artifact: str | bytes,
        run_summary_artifact: str | bytes,
        context: ResultIntakeContext,
    ) -> tuple[AutomationExecutionResultRecord, ...]:
        if not isinstance(context, ResultIntakeContext):
            raise TypeError("context must be ResultIntakeContext")
        result_bytes, result_data = self._load_json(result_artifact)
        summary_bytes, summary_data = self._load_json(run_summary_artifact)
        if not isinstance(result_data, dict):
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Machine-readable result root must be an object",
            )
        if not isinstance(summary_data, list):
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Run summary root must be an array",
            )

        workflow_id = result_data.get("workflow_id")
        if not isinstance(workflow_id, str) or not workflow_id.strip():
            raise ResultIntakeError(
                ResultDiagnosticCode.MISSING_WORKFLOW_ID,
                "Machine-readable result requires a workflow id",
            )
        cases = result_data.get("cases")
        if not isinstance(cases, dict) or not cases:
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Machine-readable result requires a non-empty cases object",
            )
        summaries = self._summary_by_case(summary_data)
        artifacts = self._artifact_integrity(result_bytes, summary_bytes, context)
        source_integrity = self._bundle_hash(artifacts)

        records = []
        for case_name in sorted(cases):
            item = cases[case_name]
            if not isinstance(case_name, str) or not case_name or not isinstance(item, dict):
                raise ResultIntakeError(
                    ResultDiagnosticCode.MALFORMED_RESULT,
                    "Every result case must be a named object",
                )
            records.append(
                self._map_case(
                    workflow_id.strip(),
                    item,
                    summaries.get(case_name),
                    context,
                    artifacts,
                    source_integrity,
                )
            )
        return tuple(records)

    @staticmethod
    def _load_json(raw: str | bytes) -> tuple[bytes, Any]:
        if isinstance(raw, str):
            encoded = raw.encode("utf-8")
            text = raw
        elif isinstance(raw, bytes):
            encoded = raw
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise ResultIntakeError(
                    ResultDiagnosticCode.MALFORMED_RESULT,
                    "Machine-readable result must be UTF-8 JSON",
                ) from exc
        else:
            raise TypeError("result artifacts must be JSON text or bytes")
        try:
            return encoded, json.loads(text.lstrip("\ufeff"))
        except json.JSONDecodeError as exc:
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Machine-readable result is malformed JSON",
            ) from exc

    @staticmethod
    def _summary_by_case(summary_data: list[Any]) -> dict[str, dict[str, Any]]:
        summaries: dict[str, dict[str, Any]] = {}
        for item in summary_data:
            if not isinstance(item, dict) or not isinstance(item.get("case"), str):
                raise ResultIntakeError(
                    ResultDiagnosticCode.MALFORMED_RESULT,
                    "Every run summary entry must identify a case",
                )
            case_name = item["case"]
            if case_name in summaries:
                raise ResultIntakeError(
                    ResultDiagnosticCode.MALFORMED_RESULT,
                    "Run summary contains a duplicate case",
                )
            summaries[case_name] = item
        return summaries

    @staticmethod
    def _artifact_integrity(
        result_bytes: bytes,
        summary_bytes: bytes,
        context: ResultIntakeContext,
    ) -> tuple[SourceArtifactIntegrity, ...]:
        return (
            SourceArtifactIntegrity(
                ResultArtifactKind.LEGACY_MACHINE_RESULT,
                context.result_artifact_ref,
                len(result_bytes),
                hashlib.sha256(result_bytes).hexdigest(),
            ),
            SourceArtifactIntegrity(
                ResultArtifactKind.LEGACY_RUN_SUMMARY,
                context.run_summary_artifact_ref,
                len(summary_bytes),
                hashlib.sha256(summary_bytes).hexdigest(),
            ),
        )

    @staticmethod
    def _bundle_hash(artifacts: tuple[SourceArtifactIntegrity, ...]) -> str:
        primitive = [
            {
                "artifact_kind": item.artifact_kind.value,
                "logical_ref": item.logical_ref,
                "sha256": item.sha256,
                "size_bytes": item.size_bytes,
            }
            for item in artifacts
        ]
        encoded = json.dumps(primitive, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _map_case(
        self,
        workflow_id: str,
        item: dict[str, Any],
        run_item: dict[str, Any] | None,
        context: ResultIntakeContext,
        artifacts: tuple[SourceArtifactIntegrity, ...],
        source_integrity: str,
    ) -> AutomationExecutionResultRecord:
        execution_id = item.get("execution_id")
        if not isinstance(execution_id, str) or not execution_id.strip():
            raise ResultIntakeError(
                ResultDiagnosticCode.MISSING_EXECUTION_ID,
                "Machine-readable result requires an execution id",
            )
        fields = item.get("fields")
        if not isinstance(fields, dict):
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Machine-readable result fields must be an object",
            )

        diagnostics = [
            ResultDiagnostic(ResultDiagnosticCode.RESULT_READ_SUCCESS, "Historical result artifact was read")
        ]
        execution_status, source_execution_status, execution_complete = self._execution_status(
            run_item,
            diagnostics,
        )
        business_status, source_business_status, business_complete = self._business_status(
            fields.get("webpage_read_status"),
            diagnostics,
        )
        observed_at = self._observed_at(fields.get("web_checked_at"))
        provider_source = (
            ProviderInstanceContextSource.CALLER_DECLARED
            if context.provider_instance_context is not None
            else ProviderInstanceContextSource.UNRESOLVED
        )
        if context.provider_instance_context is None:
            diagnostics.append(
                ResultDiagnostic(
                    ResultDiagnosticCode.PROVIDER_INSTANCE_UNRESOLVED,
                    "Provider instance context was not supplied by the caller",
                )
            )

        removed = self._contains_removed_content(item, fields, run_item)
        if removed:
            diagnostics.append(
                ResultDiagnostic(
                    ResultDiagnosticCode.SANITIZED_FIELD_REMOVED,
                    "Non-allowlisted source fields were excluded from the result record",
                )
            )

        complete = (
            context.provider_instance_context is not None
            and observed_at is not None
            and execution_complete
            and business_complete
        )
        provenance = ProvenanceCompleteness.COMPLETE if complete else ProvenanceCompleteness.PARTIAL
        if not complete:
            diagnostics.append(
                ResultDiagnostic(
                    ResultDiagnosticCode.PROVENANCE_INCOMPLETE,
                    "Historical result provenance is incomplete",
                )
            )

        terminal_reached = item.get("test_output_reached") is True
        safe_summary = (
            f"Historical {context.result_type.value} result: "
            f"execution={execution_status.value}; business={business_status.value}; "
            f"terminal_output_reached={'true' if terminal_reached else 'false'}"
        )
        sanitized_payload = {
            "business_status": business_status.value,
            "dependency_class": DependencyClass.SYNTHETIC_OR_STUBBED.value,
            "environment_class": ResultEnvironmentClass.SANDBOX_ISOLATED.value,
            "execution_engine_reality": ExecutionEngineReality.REAL_N8N_ENGINE.value,
            "execution_external_id": execution_id.strip(),
            "execution_status": execution_status.value,
            "observed_at": observed_at.isoformat() if observed_at else None,
            "provider_instance_context": context.provider_instance_context,
            "provider_kind": context.provider_kind,
            "result_type": context.result_type.value,
            "safe_result_summary": safe_summary,
            "source_business_status": source_business_status,
            "source_execution_status": source_execution_status,
            "workflow_external_id": workflow_id,
        }
        sanitized_hash = hashlib.sha256(
            json.dumps(sanitized_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        identity_material = {
            "execution_external_id": execution_id.strip(),
            "provider_instance_context": context.provider_instance_context,
            "provider_kind": context.provider_kind,
            "source_integrity_if_unresolved": (
                source_integrity if context.provider_instance_context is None else None
            ),
            "workflow_external_id": workflow_id,
        }
        record_id = "result-" + hashlib.sha256(
            json.dumps(identity_material, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:32]
        evidence = ResultSourceEvidence(
            source_artifacts=artifacts,
            source_integrity_sha256=source_integrity,
            report_ref=context.report_ref,
            execution_engine_reality=ExecutionEngineReality.REAL_N8N_ENGINE,
            environment_class=ResultEnvironmentClass.SANDBOX_ISOLATED,
            dependency_class=DependencyClass.SYNTHETIC_OR_STUBBED,
            source_classification=(
                ResultSourceClassification.SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES
            ),
            provenance_completeness=provenance,
        )
        return AutomationExecutionResultRecord(
            record_id=record_id,
            provider_kind=context.provider_kind,
            provider_instance_id=context.provider_instance_context,
            provider_instance_context_source=provider_source,
            workflow_external_id=workflow_id,
            execution_external_id=execution_id.strip(),
            execution_status=execution_status,
            source_execution_status=source_execution_status,
            business_status=business_status,
            source_business_status=source_business_status,
            result_type=context.result_type,
            safe_result_summary=safe_summary,
            observed_at=observed_at,
            source_evidence=evidence,
            sanitized_result_sha256=sanitized_hash,
            diagnostics=tuple(diagnostics),
        )

    @staticmethod
    def _execution_status(
        run_item: dict[str, Any] | None,
        diagnostics: list[ResultDiagnostic],
    ) -> tuple[ResultExecutionStatus, str, bool]:
        if run_item is None:
            return ResultExecutionStatus.NOT_OBSERVED, "not_observed", False
        explicit = run_item.get("execution_status")
        if explicit is not None:
            if isinstance(explicit, str):
                lowered = explicit.strip().lower()
                if lowered in {"success", "succeeded"}:
                    return ResultExecutionStatus.SUCCESS, "success", True
                if lowered in {"failed", "failure"}:
                    return ResultExecutionStatus.FAILED, "failed", True
                if lowered in {"unknown"}:
                    return ResultExecutionStatus.UNKNOWN, "unknown", False
            diagnostics.append(
                ResultDiagnostic(
                    ResultDiagnosticCode.EXECUTION_STATUS_UNRECOGNIZED,
                    "Source execution status was not recognized",
                )
            )
            return ResultExecutionStatus.UNKNOWN, "unrecognized", False
        exit_code = run_item.get("execute_exit_code")
        if exit_code == 0:
            return ResultExecutionStatus.SUCCESS, "cli_exit_0", True
        if isinstance(exit_code, int) and exit_code > 0:
            return ResultExecutionStatus.FAILED, "cli_exit_nonzero", True
        if exit_code is None or exit_code == -1:
            return ResultExecutionStatus.NOT_OBSERVED, "not_observed", False
        diagnostics.append(
            ResultDiagnostic(
                ResultDiagnosticCode.EXECUTION_STATUS_UNRECOGNIZED,
                "Source execution status was not recognized",
            )
        )
        return ResultExecutionStatus.UNKNOWN, "unrecognized", False

    @staticmethod
    def _business_status(
        source: Any,
        diagnostics: list[ResultDiagnostic],
    ) -> tuple[BusinessResultStatus, str, bool]:
        if source is None or source == "":
            return BusinessResultStatus.NOT_REPORTED, "not_reported", False
        if not isinstance(source, str):
            diagnostics.append(
                ResultDiagnostic(
                    ResultDiagnosticCode.BUSINESS_STATUS_UNRECOGNIZED,
                    "Source business status was not recognized",
                )
            )
            return BusinessResultStatus.UNKNOWN, "unrecognized", False
        lowered = source.strip().lower()
        if lowered in {"success", "completed", "complete"}:
            return BusinessResultStatus.SUCCESS, lowered, True
        if lowered in {
            "partial",
            "empty",
            "forbidden",
            "rate_limited",
            "not_provided",
            "completed_with_insufficient_sources",
        }:
            return BusinessResultStatus.PARTIAL, lowered, True
        if lowered in {"failed", "failure"}:
            return BusinessResultStatus.FAILED, lowered, True
        if lowered == "unknown":
            return BusinessResultStatus.UNKNOWN, "unknown", False
        diagnostics.append(
            ResultDiagnostic(
                ResultDiagnosticCode.BUSINESS_STATUS_UNRECOGNIZED,
                "Source business status was not recognized",
            )
        )
        return BusinessResultStatus.UNKNOWN, "unrecognized", False

    @staticmethod
    def _observed_at(value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        if not isinstance(value, str):
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Result timestamp must be an ISO 8601 string",
            )
        candidate = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Result timestamp is malformed",
            ) from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ResultIntakeError(
                ResultDiagnosticCode.MALFORMED_RESULT,
                "Result timestamp must be timezone-aware",
            )
        return parsed

    @staticmethod
    def _contains_removed_content(
        item: dict[str, Any],
        fields: dict[str, Any],
        run_item: dict[str, Any] | None,
    ) -> bool:
        removed = any(
            key not in _ALLOWED_RESULT_ITEM_KEYS and value not in (None, "", [], {})
            for key, value in item.items()
        )
        removed = removed or any(
            (key not in _ALLOWED_RESULT_FIELDS or _SENSITIVE_KEY.search(key))
            and value not in (None, "", [], {})
            for key, value in fields.items()
        )
        if run_item is not None:
            removed = removed or any(
                key not in _ALLOWED_RUN_ITEM_KEYS and value not in (None, "", [], {})
                for key, value in run_item.items()
            )
        return removed
