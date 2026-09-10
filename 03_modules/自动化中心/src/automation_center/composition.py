"""Single in-module composition root for the authoritative AutomationReadAPI."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any

from automation_center.adapters import (
    LegacyExecutionResultAdapter,
    N8nExportAdapter,
    N8nExportContext,
    ResultIntakeContext,
)
from automation_center.application import (
    SnapshotSelectionPolicy,
    StaticWorkflowQueryService,
    StaticWorkflowSnapshot,
    StaticWorkflowSnapshotSelector,
    UnifiedAutomationQueryService,
    build_provider_instance_confirmation_resolver,
    build_v141_knowledge_collect_capability,
)
from automation_center.domain import AutomationProvider, ProviderCapability
from automation_center.public_api import AutomationReadAPI, _build_ui_read_api
from automation_center.public_api import _build_product_only_read_api
from automation_center.product import (
    AutomationProviderConfig,
    ProviderHealthObservation,
    knowledge_collect_readiness,
    project_ai_capability,
    candidate_pipeline_contracts,
    build_ui_reference_payload,
)
from automation_center.run_prep import build_tiangong_readiness_contract
from automation_center.auth_metadata import build_auth_metadata_product_status
from automation_center.metadata_reconcile import (
    build_reconciled_auth_metadata_product_status,
    build_tiangong_metadata_reconciliation_status,
)
from automation_center.production_update import build_production_update_status


AUTOMATION_UI_INTEGRATION_VERSION = "0.1"

_MODULE_ROOT = Path(__file__).resolve().parents[2]
_LEGACY_ROOT = _MODULE_ROOT / "source_import" / "n8n_工作流开发"
_CANONICAL = _LEGACY_ROOT / "output" / "中国AI知识库采集器_V1.4.1_网页失败兜底版.json"
_RESULT = _LEGACY_ROOT / "_system" / "n8n_runtime_test" / "evidence" / "authbridge5_parsed_results.json"
_SUMMARY = _LEGACY_ROOT / "_system" / "n8n_runtime_test" / "evidence" / "authbridge5_run_summary.json"
_PROVIDER_INSTANCE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _captured_at(path: Path) -> datetime:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)


def _workflow_profile_key(
    provider_kind: str,
    provider_instance_id: str,
    external_workflow_id: str,
) -> str:
    import json

    return json.dumps(
        [provider_kind, provider_instance_id, external_workflow_id],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _build_ui_profile(
    result_records: tuple[Any, ...],
    confirmed_provider_instance_id: str,
) -> dict[str, Any]:
    capability = build_v141_knowledge_collect_capability()
    confirmation = build_provider_instance_confirmation_resolver().resolve_v141()
    artifact = confirmation.target_resolution.result_artifact
    sandbox_execution_ids = sorted(
        (record.execution_external_id for record in result_records),
        key=lambda value: int(value) if value.isdigit() else value,
    )
    input_fields = [
        {
            "field_name": field.name,
            "display_name": field.display_name,
            "kind": field.field_kind.value,
            "required": field.required,
            "max_length": field.max_length,
        }
        for field in capability.input_schema.fields
    ]
    result_action = {
        "type": capability.output_schema.primary_action.value,
        "readiness": artifact.copy_markdown.value,
        "copy_ready": False,
        "open_ready": False,
        "reason": "execution_to_markdown_artifact_not_associated",
    }
    return _complete_ui_profile(
        capability,
        confirmation,
        input_fields,
        result_action,
        sandbox_execution_ids,
        confirmed_provider_instance_id,
    )


def _build_product_profile(
    config: AutomationProviderConfig,
    health: ProviderHealthObservation | None,
) -> dict[str, Any]:
    if health is None:
        health = config.last_health_observation
    capability = build_v141_knowledge_collect_capability()
    readiness = knowledge_collect_readiness(config, health)
    health_state = health.state.value if health else "UNKNOWN"
    provider = {
        "provider_kind": config.provider_kind,
        "provider_instance_id": config.provider_instance_id,
        "display_label": config.display_label,
        "identity_state": "confirmed" if config.confirmed else "confirmation_required",
        "endpoint_id": config.endpoint_id,
        "config_source": config.source,
        "capability_bindings": list(config.capability_bindings),
        "health": {
            "state": health_state,
            "observed_at": health.observed_at.isoformat() if health else None,
            "freshness": health.freshness if health else "not_observed",
            "source": health.source if health else "not_observed",
        },
    }
    workflow = {
        "capability_id": capability.capability_id,
        "display_name": capability.display_name,
        "purpose": capability.description_for_ai,
        "workflow_identity": {
            "provider_kind": "n8n",
            "provider_instance_id": config.provider_instance_id,
            "external_workflow_id": capability.workflow_identity.external_workflow_id,
            "join_ready": config.confirmed,
        },
        "provider": provider,
        "definition": {"state": "configured" if config.confirmed else "unresolved"},
        "current_workflow_run_state": "not_observed",
        "historical": {
            "sandbox_execution_count": 6,
            "sandbox_execution_ids": ["42", "43", "44", "45", "46", "47"],
            "production_linked_result_count": 0,
            "last_success": "observed_in_sandbox",
            "last_partial": "observed_in_sandbox",
            "last_failure": "observed_in_sandbox",
            "consecutive_trusted_failures": 0,
        },
        "sandbox_validation": {
            "state": "pass", "workflow_id": "V141Final403429",
            "execution_engine": "real_n8n_engine", "dependencies": "synthetic_or_stubbed",
        },
        "health": {
            "state": "NEEDS_CONFIGURATION" if not config.confirmed else (
                "RUNTIME_UNKNOWN" if health_state in {"UNKNOWN", "STALE"} else (
                    "NEEDS_ATTENTION" if health_state == "UNREACHABLE" else "AUTH_REQUIRED"
                )
            ),
            "provider_state": health_state,
            "workflow_runtime_state": "not_observed",
            "historical_failure_is_current_runtime_failure": False,
        },
        "actions": {
            "run": readiness["run"], "copy_result": readiness["result_copy"],
            "ai_diagnosis": readiness["diagnose"], "repair": readiness["repair"],
            "build": readiness["build"], "publish": readiness["publish"],
        },
        "result": {
            "type": "knowledge_markdown_document", "primary_action": "copy_markdown",
            "copy_readiness": "implementation_ready",
        },
    }
    return {
        "backend": {
            "version": "0.2", "state": "AUTOMATION_LOCAL_PRODUCT_BACKEND_V0.2_READY",
            "provider": provider, "workflow_total": 1,
            "workflow_runtime_observed": 0, "needs_attention": 1,
            "attention_states": ["OK", "NEEDS_CONFIGURATION", "NEEDS_ATTENTION", "FAILURE_OBSERVED", "RUNTIME_UNKNOWN", "AUTH_REQUIRED"],
            "historical": {"sandbox_success": 1, "sandbox_partial": 4, "sandbox_failure": 1},
            "second_workflow_engine": False,
            "artifact_reader": {
                "state": "implementation_ready", "real_content_read": False,
                "external_authorization_required": True,
            },
            "candidate_pipelines": candidate_pipeline_contracts(),
        },
        "workflows": [workflow],
        "ai_capabilities": [project_ai_capability(capability, config=config)],
        "readiness_matrix": [readiness],
        "ui_reference": build_ui_reference_payload(),
        "tiangong_run_prep": build_tiangong_readiness_contract(),
        "tiangong_auth_metadata": build_reconciled_auth_metadata_product_status(),
        "tiangong_metadata_reconciliation": build_tiangong_metadata_reconciliation_status(),
        "tiangong_production_update": build_production_update_status(),
    }


def _complete_ui_profile(
    capability: Any,
    confirmation: Any,
    input_fields: list[dict[str, Any]],
    result_action: dict[str, Any],
    sandbox_execution_ids: list[str],
    confirmed_provider_instance_id: str,
) -> dict[str, Any]:
    shared = {
        "capability_id": capability.capability_id,
        "capability_name": capability.display_name,
        "purpose": capability.description_for_ai,
        "current_availability": capability.availability.value,
        "target_readiness": confirmation.capability_binding.progress_state.value,
        "provider_instance_identity_state": "caller_confirmed",
        "provider_instance_id": confirmed_provider_instance_id,
        "provider_instance_display_name": "天工" if confirmed_provider_instance_id == "n8n-tiangong-primary" else "Configured n8n",
        "provider_identity_provenance": "USER_CONFIRMED" if confirmed_provider_instance_id == "n8n-tiangong-primary" else "CALLER_CONFIRMED",
        "provider_instance_candidate_label": None,
        "current_runtime_observation_state": "not_observed",
        "current_provider_runtime_state": "not_observed",
        "historical_provider_runtime_observation": {
            "state": confirmation.runtime.state.value,
            "observed_on": "2026-08-12",
            "freshness": "historical_not_current",
        },
        "health": {
            "needs_attention": True,
            "attention_kind": "configuration",
            "reasons": [
                "workflow_metadata_auth_required",
                "legacy_filename_safety_gap",
            ],
            "historical_result_does_not_define_current_runtime": True,
        },
        "primary_result_action": result_action,
        "control_readiness": {
            "state": "target_confirmed_execution_disabled",
            "execution_enabled": False,
            "production_revision": "auth_required",
            "form_url": "unresolved",
        },
    }
    return {
        "version": AUTOMATION_UI_INTEGRATION_VERSION,
        "overview": {
            "state": "ready",
            "attention_workflow_count": 1,
            "current_provider_runtime_state": "not_observed",
            "historical_provider_runtime_observation": {
                "state": confirmation.runtime.state.value,
                "observed_on": "2026-08-12",
                "freshness": "historical_not_current",
            },
            "workflow_runtime_observation_state": "not_observed",
            "authority": {
                "workflow_definition": "legacy_n8n_workflow_json",
                "workflow_execution": "n8n_runtime",
                "original_result_and_evidence": "legacy_n8n_assets",
                "normalized_read_view": "nexa_automation_read_api",
            },
        },
        "workflows": {
            _workflow_profile_key(
                "n8n",
                confirmed_provider_instance_id,
                capability.workflow_identity.external_workflow_id,
            ): {
                "list": shared,
                "detail": {
                    **shared,
                    "input_schema": input_fields,
                    "result_schema": {
                        "result_type": capability.output_schema.result_type,
                        "media_type": capability.output_schema.media_type,
                    },
                    "sandbox_validation": {
                        "state": "pass",
                        "production_target": False,
                        "real_n8n_engine": True,
                        "synthetic_dependencies": True,
                        "workflow_external_id": "V141Final403429",
                        "execution_ids": sandbox_execution_ids,
                        "execution_count": len(sandbox_execution_ids),
                    },
                    "historical_result_summary": {
                        "production_linked_result_count": 0,
                        "sandbox_historical_result_count": len(sandbox_execution_ids),
                        "no_production_result_does_not_mean_never_executed": True,
                        "sandbox_results_do_not_define_production_runtime": True,
                    },
                    "diagnosis": {
                        "contract_available": True,
                        "dispatch_connected": False,
                        "readiness": "contract_ready_dispatch_not_connected",
                    },
                },
            }
        },
        "result_action": result_action,
    }


def build_automation_read_context(
    *,
    confirmed_provider_instance_id: str | None = None,
    provider_config: AutomationProviderConfig | None = None,
    health_observation: ProviderHealthObservation | None = None,
) -> AutomationReadAPI:
    """Build the Read API with formal Tiangong identity unless explicitly overridden."""

    if provider_config is not None and confirmed_provider_instance_id is not None:
        raise ValueError("provide provider_config or confirmed_provider_instance_id, not both")
    if provider_config is None:
        if confirmed_provider_instance_id is None:
            provider_config = AutomationProviderConfig.tiangong()
        else:
            if not isinstance(confirmed_provider_instance_id, str):
                raise TypeError("confirmed_provider_instance_id must be a string")
            confirmed_provider_instance_id = confirmed_provider_instance_id.strip()
            if not _PROVIDER_INSTANCE_ID.fullmatch(confirmed_provider_instance_id):
                raise ValueError("confirmed_provider_instance_id is invalid")
            provider_config = AutomationProviderConfig.confirmed_instance(confirmed_provider_instance_id)
    if not isinstance(provider_config, AutomationProviderConfig):
        raise TypeError("provider_config must be AutomationProviderConfig")
    product_profile = _build_product_profile(provider_config, health_observation)
    if not provider_config.confirmed:
        return _build_product_only_read_api(product_profile)
    confirmed_provider_instance_id = provider_config.provider_instance_id
    assert confirmed_provider_instance_id is not None

    for path in (_CANONICAL, _RESULT, _SUMMARY):
        resolved = path.resolve()
        try:
            resolved.relative_to(_MODULE_ROOT.resolve())
        except ValueError as exc:
            raise RuntimeError("automation read composition escaped the module root") from exc
        if not resolved.is_file():
            raise FileNotFoundError("required Automation source asset is missing")

    mapped = N8nExportAdapter().map_export_file(
        _CANONICAL,
        N8nExportContext(
            provider_kind="n8n",
            provider_instance_id=confirmed_provider_instance_id,
            source_locator=(
                "source_import/n8n_工作流开发/output/"
                "中国AI知识库采集器_V1.4.1_网页失败兜底版.json"
            ),
            captured_at=_captured_at(_CANONICAL),
            synthetic=False,
        ),
    )
    provider = AutomationProvider(
        ref=mapped.workflow.provider,
        display_name="Confirmed n8n provider instance",
        capabilities=frozenset({ProviderCapability.DEFINITION_READ}),
        provenance=mapped.workflow.provenance,
    )
    selection = StaticWorkflowSnapshotSelector().select(
        (StaticWorkflowSnapshot(mapped.workflow, mapped.evidence),),
        policy=SnapshotSelectionPolicy.STRICT_UNIQUE,
    )
    static_query = StaticWorkflowQueryService.from_snapshot_selection(selection, (provider,))
    records = LegacyExecutionResultAdapter().read_files(
        _RESULT,
        _SUMMARY,
        ResultIntakeContext(
            provider_kind="n8n",
            provider_instance_context="n8n-v141-sandbox",
            result_artifact_ref="legacy-result:authbridge5-parsed-results",
            run_summary_artifact_ref="legacy-result:authbridge5-run-summary",
            report_ref="legacy-report:opencode-isolated-auth-bridge",
        ),
    )
    query = UnifiedAutomationQueryService(
        static_query,
        records,
        snapshot_selection=selection,
    )
    return _build_ui_read_api(
        query,
        _build_ui_profile(records, confirmed_provider_instance_id),
        product_profile,
    )


__all__ = [
    "AUTOMATION_UI_INTEGRATION_VERSION",
    "build_automation_read_context",
]
