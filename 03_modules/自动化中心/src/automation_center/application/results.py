"""Provider-neutral historical result intake records and read-only projections."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, fields, is_dataclass
from datetime import datetime
from enum import Enum
import json
import re
from typing import Any, Iterable


RESULT_INTAKE_VERSION = "0.1"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$")
_PROVIDER_KIND = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
_ABSOLUTE_OR_URL = re.compile(r"^(?:[A-Za-z]:[\\/]|[/\\]{1,2}|[a-zA-Z][a-zA-Z0-9+.-]*://)")
_SENSITIVE_TEXT = re.compile(
    r"(?:FAKE_SECRET_VALUE|bearer\s+[A-Za-z0-9._~+/=-]{8,}|sk-[A-Za-z0-9_-]{8,}|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----)",
    re.IGNORECASE,
)


class ResultExecutionStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    UNKNOWN = "unknown"
    NOT_OBSERVED = "not_observed"


class BusinessResultStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    UNKNOWN = "unknown"
    NOT_REPORTED = "not_reported"


class ResultType(str, Enum):
    WEBPAGE_READ = "webpage_read"
    KNOWLEDGE_COLLECTION = "knowledge_collection"
    OTHER = "other"


class ProviderInstanceContextSource(str, Enum):
    CALLER_DECLARED = "caller_declared"
    UNRESOLVED = "unresolved"


class ExecutionEngineReality(str, Enum):
    REAL_N8N_ENGINE = "real_n8n_engine"
    UNKNOWN = "unknown"


class ResultEnvironmentClass(str, Enum):
    SANDBOX_ISOLATED = "sandbox_isolated"
    UNKNOWN = "unknown"


class DependencyClass(str, Enum):
    SYNTHETIC_OR_STUBBED = "synthetic_or_stubbed"
    UNKNOWN = "unknown"


class ResultSourceClassification(str, Enum):
    SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES = (
        "sandbox_real_execution_with_synthetic_dependencies"
    )
    STATIC_VALIDATED_ONLY = "static_validated_only"
    UNKNOWN = "unknown"


class ResultArtifactKind(str, Enum):
    LEGACY_MACHINE_RESULT = "legacy_machine_result"
    LEGACY_RUN_SUMMARY = "legacy_run_summary"


class ProvenanceCompleteness(str, Enum):
    COMPLETE = "complete"
    PARTIAL = "partial"


class ResultDiagnosticCode(str, Enum):
    RESULT_READ_SUCCESS = "result_read_success"
    MALFORMED_RESULT = "malformed_result"
    MISSING_EXECUTION_ID = "missing_execution_id"
    MISSING_WORKFLOW_ID = "missing_workflow_id"
    PROVIDER_INSTANCE_UNRESOLVED = "provider_instance_unresolved"
    BUSINESS_STATUS_UNRECOGNIZED = "business_status_unrecognized"
    EXECUTION_STATUS_UNRECOGNIZED = "execution_status_unrecognized"
    SANITIZED_FIELD_REMOVED = "sanitized_field_removed"
    PROVENANCE_INCOMPLETE = "provenance_incomplete"


def _text(value: str, field_name: str, *, max_length: int = 512) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field_name} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} must not be empty")
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} exceeds {max_length} characters")
    if any(ord(character) < 32 for character in normalized):
        raise ValueError(f"{field_name} contains control characters")
    if _SENSITIVE_TEXT.search(normalized):
        raise ValueError(f"{field_name} contains sensitive text")
    return normalized


def _identifier(value: str, field_name: str) -> str:
    normalized = _text(value, field_name, max_length=256)
    if not _SAFE_ID.fullmatch(normalized):
        raise ValueError(f"{field_name} is not a safe identifier")
    return normalized


def _logical_ref(value: str, field_name: str) -> str:
    normalized = _text(value, field_name, max_length=512)
    if _ABSOLUTE_OR_URL.search(normalized):
        raise ValueError(f"{field_name} must be a logical reference")
    return normalized


def _aware(value: datetime | None, field_name: str) -> None:
    if value is None:
        return
    if not isinstance(value, datetime):
        raise TypeError(f"{field_name} must be datetime or None")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")


@dataclass(frozen=True, slots=True)
class ResultDiagnostic:
    code: ResultDiagnosticCode
    message: str

    def __post_init__(self) -> None:
        if not isinstance(self.code, ResultDiagnosticCode):
            raise TypeError("code must be ResultDiagnosticCode")
        object.__setattr__(self, "message", _text(self.message, "message"))


@dataclass(frozen=True, slots=True)
class SourceArtifactIntegrity:
    artifact_kind: ResultArtifactKind
    logical_ref: str
    size_bytes: int
    sha256: str

    def __post_init__(self) -> None:
        if not isinstance(self.artifact_kind, ResultArtifactKind):
            raise TypeError("artifact_kind must be ResultArtifactKind")
        object.__setattr__(self, "logical_ref", _logical_ref(self.logical_ref, "logical_ref"))
        if not isinstance(self.size_bytes, int) or self.size_bytes < 0:
            raise ValueError("size_bytes must be a non-negative integer")
        if not isinstance(self.sha256, str) or not _SHA256.fullmatch(self.sha256):
            raise ValueError("sha256 must be a SHA-256 digest")
        object.__setattr__(self, "sha256", self.sha256.lower())


@dataclass(frozen=True, slots=True)
class ResultSourceEvidence:
    source_artifacts: tuple[SourceArtifactIntegrity, ...]
    source_integrity_sha256: str
    report_ref: str
    execution_engine_reality: ExecutionEngineReality
    environment_class: ResultEnvironmentClass
    dependency_class: DependencyClass
    source_classification: ResultSourceClassification
    provenance_completeness: ProvenanceCompleteness

    def __post_init__(self) -> None:
        artifacts = tuple(self.source_artifacts)
        if not artifacts or not all(isinstance(item, SourceArtifactIntegrity) for item in artifacts):
            raise ValueError("source_artifacts must contain integrity records")
        object.__setattr__(self, "source_artifacts", artifacts)
        if not isinstance(self.source_integrity_sha256, str) or not _SHA256.fullmatch(
            self.source_integrity_sha256
        ):
            raise ValueError("source_integrity_sha256 must be a SHA-256 digest")
        object.__setattr__(self, "source_integrity_sha256", self.source_integrity_sha256.lower())
        object.__setattr__(self, "report_ref", _logical_ref(self.report_ref, "report_ref"))
        if not isinstance(self.execution_engine_reality, ExecutionEngineReality):
            raise TypeError("execution_engine_reality must be ExecutionEngineReality")
        if not isinstance(self.environment_class, ResultEnvironmentClass):
            raise TypeError("environment_class must be ResultEnvironmentClass")
        if not isinstance(self.dependency_class, DependencyClass):
            raise TypeError("dependency_class must be DependencyClass")
        if not isinstance(self.source_classification, ResultSourceClassification):
            raise TypeError("source_classification must be ResultSourceClassification")
        if not isinstance(self.provenance_completeness, ProvenanceCompleteness):
            raise TypeError("provenance_completeness must be ProvenanceCompleteness")


@dataclass(frozen=True, slots=True)
class ResultExecutionIdentity:
    provider_kind: str
    provider_instance_id: str
    execution_external_id: str

    def __post_init__(self) -> None:
        if not isinstance(self.provider_kind, str) or not _PROVIDER_KIND.fullmatch(self.provider_kind):
            raise ValueError("provider_kind must be a lowercase provider slug")
        object.__setattr__(
            self,
            "provider_instance_id",
            _identifier(self.provider_instance_id, "provider_instance_id"),
        )
        object.__setattr__(
            self,
            "execution_external_id",
            _identifier(self.execution_external_id, "execution_external_id"),
        )


@dataclass(frozen=True, slots=True)
class AutomationExecutionResultRecord:
    record_id: str
    provider_kind: str
    provider_instance_id: str | None
    provider_instance_context_source: ProviderInstanceContextSource
    workflow_external_id: str
    execution_external_id: str
    execution_status: ResultExecutionStatus
    source_execution_status: str
    business_status: BusinessResultStatus
    source_business_status: str
    result_type: ResultType
    safe_result_summary: str
    observed_at: datetime | None
    source_evidence: ResultSourceEvidence
    sanitized_result_sha256: str
    diagnostics: tuple[ResultDiagnostic, ...] = ()
    schema_version: str = RESULT_INTAKE_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "record_id", _identifier(self.record_id, "record_id"))
        if not isinstance(self.provider_kind, str) or not _PROVIDER_KIND.fullmatch(self.provider_kind):
            raise ValueError("provider_kind must be a lowercase provider slug")
        if self.provider_instance_id is not None:
            object.__setattr__(
                self,
                "provider_instance_id",
                _identifier(self.provider_instance_id, "provider_instance_id"),
            )
        if not isinstance(self.provider_instance_context_source, ProviderInstanceContextSource):
            raise TypeError("provider_instance_context_source must be ProviderInstanceContextSource")
        if self.provider_instance_id is None and (
            self.provider_instance_context_source is not ProviderInstanceContextSource.UNRESOLVED
        ):
            raise ValueError("missing provider instance must remain unresolved")
        if self.provider_instance_id is not None and (
            self.provider_instance_context_source is not ProviderInstanceContextSource.CALLER_DECLARED
        ):
            raise ValueError("provided instance context must be caller-declared")
        object.__setattr__(
            self,
            "workflow_external_id",
            _identifier(self.workflow_external_id, "workflow_external_id"),
        )
        object.__setattr__(
            self,
            "execution_external_id",
            _identifier(self.execution_external_id, "execution_external_id"),
        )
        if not isinstance(self.execution_status, ResultExecutionStatus):
            raise TypeError("execution_status must be ResultExecutionStatus")
        object.__setattr__(
            self,
            "source_execution_status",
            _identifier(self.source_execution_status, "source_execution_status"),
        )
        if not isinstance(self.business_status, BusinessResultStatus):
            raise TypeError("business_status must be BusinessResultStatus")
        object.__setattr__(
            self,
            "source_business_status",
            _identifier(self.source_business_status, "source_business_status"),
        )
        if not isinstance(self.result_type, ResultType):
            raise TypeError("result_type must be ResultType")
        object.__setattr__(
            self,
            "safe_result_summary",
            _text(self.safe_result_summary, "safe_result_summary", max_length=512),
        )
        _aware(self.observed_at, "observed_at")
        if not isinstance(self.source_evidence, ResultSourceEvidence):
            raise TypeError("source_evidence must be ResultSourceEvidence")
        if not isinstance(self.sanitized_result_sha256, str) or not _SHA256.fullmatch(
            self.sanitized_result_sha256
        ):
            raise ValueError("sanitized_result_sha256 must be a SHA-256 digest")
        object.__setattr__(self, "sanitized_result_sha256", self.sanitized_result_sha256.lower())
        diagnostics = tuple(self.diagnostics)
        if not all(isinstance(item, ResultDiagnostic) for item in diagnostics):
            raise TypeError("diagnostics must contain ResultDiagnostic values")
        object.__setattr__(self, "diagnostics", diagnostics)
        if self.schema_version != RESULT_INTAKE_VERSION:
            raise ValueError("unsupported result intake schema version")

    @property
    def execution_identity(self) -> ResultExecutionIdentity | None:
        if self.provider_instance_id is None:
            return None
        return ResultExecutionIdentity(
            self.provider_kind,
            self.provider_instance_id,
            self.execution_external_id,
        )

    @property
    def historical_result_only(self) -> bool:
        return True


@dataclass(frozen=True, slots=True)
class HistoricalResultListItemViewModel:
    record_id: str
    provider_kind: str
    provider_instance_id: str | None
    provider_instance_context_source: str
    workflow_external_id: str
    execution_external_id: str
    execution_status: str
    business_status: str
    result_type: str
    safe_result_summary: str
    observed_at: str | None
    source_classification: str
    execution_engine_reality: str
    environment_class: str
    dependency_class: str
    provenance_completeness: str
    source_integrity_prefix: str
    sanitized_result_integrity_prefix: str
    historical_result_only: bool = True
    current_runtime_inference_allowed: bool = False


@dataclass(frozen=True, slots=True)
class HistoricalResultSummaryViewModel:
    result_count: int
    execution_success_count: int
    execution_failure_count: int
    execution_unknown_count: int
    execution_not_observed_count: int
    business_success_count: int
    business_partial_count: int
    business_failure_count: int
    business_unknown_count: int
    business_not_reported_count: int
    sandbox_result_count: int
    unresolved_provider_instance_count: int
    historical_result_only: bool = True
    current_runtime_inference_allowed: bool = False


class ResultProjectionError(ValueError):
    pass


class ResultNotFoundError(LookupError):
    pass


class HistoricalResultQueryService:
    """Read historical result records without inferring current Runtime state."""

    def __init__(self, records: Iterable[AutomationExecutionResultRecord]) -> None:
        self._records = tuple(records)
        self._by_record_id: dict[str, AutomationExecutionResultRecord] = {}
        self._by_execution_identity: dict[ResultExecutionIdentity, AutomationExecutionResultRecord] = {}
        for record in self._records:
            if not isinstance(record, AutomationExecutionResultRecord):
                raise TypeError("records must contain AutomationExecutionResultRecord values")
            if record.record_id in self._by_record_id:
                raise ResultProjectionError("duplicate result record identity")
            self._by_record_id[record.record_id] = record
            identity = record.execution_identity
            if identity is not None:
                if identity in self._by_execution_identity:
                    raise ResultProjectionError("duplicate provider-scoped execution identity")
                self._by_execution_identity[identity] = record

    def list_results(
        self,
        *,
        execution_status: ResultExecutionStatus | None = None,
        business_status: BusinessResultStatus | None = None,
        provider_instance_id: str | None = None,
    ) -> tuple[HistoricalResultListItemViewModel, ...]:
        records = (
            record
            for record in self._records
            if (execution_status is None or record.execution_status is execution_status)
            and (business_status is None or record.business_status is business_status)
            and (provider_instance_id is None or record.provider_instance_id == provider_instance_id)
        )
        ordered = sorted(
            records,
            key=lambda record: (
                record.provider_kind,
                record.provider_instance_id or "",
                record.workflow_external_id,
                record.execution_external_id,
                record.record_id,
            ),
        )
        return tuple(self._project(record) for record in ordered)

    def get_result_by_execution_identity(
        self,
        identity: ResultExecutionIdentity,
    ) -> HistoricalResultListItemViewModel:
        if not isinstance(identity, ResultExecutionIdentity):
            raise TypeError("identity must be ResultExecutionIdentity")
        try:
            return self._project(self._by_execution_identity[identity])
        except KeyError as exc:
            raise ResultNotFoundError("historical execution result was not found") from exc

    def summarize_results(self) -> HistoricalResultSummaryViewModel:
        execution = Counter(record.execution_status for record in self._records)
        business = Counter(record.business_status for record in self._records)
        sandbox = sum(
            record.source_evidence.source_classification
            is ResultSourceClassification.SANDBOX_REAL_EXECUTION_WITH_SYNTHETIC_DEPENDENCIES
            for record in self._records
        )
        return HistoricalResultSummaryViewModel(
            result_count=len(self._records),
            execution_success_count=execution[ResultExecutionStatus.SUCCESS],
            execution_failure_count=execution[ResultExecutionStatus.FAILED],
            execution_unknown_count=execution[ResultExecutionStatus.UNKNOWN],
            execution_not_observed_count=execution[ResultExecutionStatus.NOT_OBSERVED],
            business_success_count=business[BusinessResultStatus.SUCCESS],
            business_partial_count=business[BusinessResultStatus.PARTIAL],
            business_failure_count=business[BusinessResultStatus.FAILED],
            business_unknown_count=business[BusinessResultStatus.UNKNOWN],
            business_not_reported_count=business[BusinessResultStatus.NOT_REPORTED],
            sandbox_result_count=sandbox,
            unresolved_provider_instance_count=sum(
                record.provider_instance_id is None for record in self._records
            ),
        )

    @staticmethod
    def _project(record: AutomationExecutionResultRecord) -> HistoricalResultListItemViewModel:
        evidence = record.source_evidence
        return HistoricalResultListItemViewModel(
            record_id=record.record_id,
            provider_kind=record.provider_kind,
            provider_instance_id=record.provider_instance_id,
            provider_instance_context_source=record.provider_instance_context_source.value,
            workflow_external_id=record.workflow_external_id,
            execution_external_id=record.execution_external_id,
            execution_status=record.execution_status.value,
            business_status=record.business_status.value,
            result_type=record.result_type.value,
            safe_result_summary=record.safe_result_summary,
            observed_at=record.observed_at.isoformat() if record.observed_at else None,
            source_classification=evidence.source_classification.value,
            execution_engine_reality=evidence.execution_engine_reality.value,
            environment_class=evidence.environment_class.value,
            dependency_class=evidence.dependency_class.value,
            provenance_completeness=evidence.provenance_completeness.value,
            source_integrity_prefix=evidence.source_integrity_sha256[:12],
            sanitized_result_integrity_prefix=record.sanitized_result_sha256[:12],
        )


def result_to_primitive(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        _aware(value, "datetime")
        return value.isoformat()
    if is_dataclass(value) and not isinstance(value, type):
        return {item.name: result_to_primitive(getattr(value, item.name)) for item in fields(value)}
    if isinstance(value, (tuple, list)):
        return [result_to_primitive(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("result dictionaries require string keys")
        return {key: result_to_primitive(value[key]) for key in sorted(value)}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"unsupported result value: {type(value).__name__}")


def serialize_result_record(value: Any) -> str:
    return json.dumps(
        result_to_primitive(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
