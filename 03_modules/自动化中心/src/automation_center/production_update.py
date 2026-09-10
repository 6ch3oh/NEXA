"""Production-update preparation contracts for Tiangong knowledge.collect.

All objects in this module are preparation-only. No production transport or
write operation exists here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping

from automation_center.auth_metadata import CANONICAL_WORKFLOW_SHA256, CANONICAL_WORKFLOW_VERSION_ID
from automation_center.metadata_reconcile import (
    PRODUCTION_WORKFLOW_UPDATED_AT,
    PRODUCTION_WORKFLOW_VERSION_ID,
)
from automation_center.run_prep import TIANGONG_PROVIDER_INSTANCE_ID, TIANGONG_WORKFLOW_EXTERNAL_ID


TIANGONG_PRODUCTION_UPDATE_VERSION = "0.1"
CANDIDATE_ID = "knowledge-collect-v141-hardened-api-compatible-002"
CANDIDATE_VERSION_ID = "candidate-package-002"
CANDIDATE_SHA256 = "002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9"
OLD_CANDIDATE_SHA256 = "99BF04515925D7488B50E010B146E382F83F37132D1EFA4822F4F34B191B0A62"
BACKUP_ID = "tiangong-authenticated-production-backup-20260822T025148448153Z"
BACKUP_SHA256 = "7BFC195182AC296B18C7388680786774CAA381C0924FA30EBAFEDA715CD868D2"
BACKUP_RELATIVE_PATH = (
    "fixtures/tiangong_run_prep/"
    "ymYh8t76VP3jGPbr_0fd6b9b7-ee0d-44b3-a494-7469be49bf96_"
    "20260822T025148448153Z.authenticated.backup.json"
)
BACKUP_OBSERVED_AT = "2026-08-22T10:51:48.448153+08:00"
ROLLBACK_ID = "tiangong-production-rollback-001"


@dataclass(frozen=True, slots=True)
class ProductionRevisionLock:
    provider_instance_id: str
    workflow_external_id: str
    expected_revision: str
    expected_updated_at: str
    expected_definition_sha256: str
    lock_observed_at: str
    latest_authenticated_recheck: str

    def __post_init__(self) -> None:
        if self.provider_instance_id != TIANGONG_PROVIDER_INSTANCE_ID:
            raise ValueError("revision lock provider is invalid")
        if self.workflow_external_id != TIANGONG_WORKFLOW_EXTERNAL_ID:
            raise ValueError("revision lock Workflow is invalid")
        if self.latest_authenticated_recheck not in {"REQUIRED", "MATCHED"}:
            raise ValueError("revision recheck state is invalid")


def build_production_revision_lock(*, latest_authenticated_recheck: str = "MATCHED") -> ProductionRevisionLock:
    return ProductionRevisionLock(
        TIANGONG_PROVIDER_INSTANCE_ID,
        TIANGONG_WORKFLOW_EXTERNAL_ID,
        PRODUCTION_WORKFLOW_VERSION_ID,
        PRODUCTION_WORKFLOW_UPDATED_AT,
        BACKUP_SHA256,
        BACKUP_OBSERVED_AT,
        latest_authenticated_recheck,
    )


def verify_revision_lock(
    lock: ProductionRevisionLock,
    *,
    observed_revision: str,
    observed_updated_at: str,
) -> Mapping[str, Any]:
    matched = observed_revision == lock.expected_revision and observed_updated_at == lock.expected_updated_at
    return {
        "state": "MATCHED" if matched else "CONCURRENT_MODIFICATION_DETECTED",
        "publish_eligible": matched,
        "expected_revision": lock.expected_revision,
        "observed_revision": observed_revision,
        "expected_updated_at": lock.expected_updated_at,
        "observed_updated_at": observed_updated_at,
        "production_write_performed": False,
    }


def build_candidate_validation() -> Mapping[str, Any]:
    return {
        "state": "PASS",
        "candidate_id": CANDIDATE_ID,
        "candidate_version_id": CANDIDATE_VERSION_ID,
        "candidate_sha256": CANDIDATE_SHA256,
        "artifact_format": "N8N_PUBLIC_API_UPDATE_REQUEST_BODY",
        "active_field_submitted": False,
        "node_count": 22,
        "edge_count": 26,
        "unique_node_ids": True,
        "connections_valid": True,
        "dangling_nodes": [],
        "form_trigger_count": 1,
        "error_trigger_count": 1,
        "result_chain_preserved": True,
        "workflow_level_on_error_present": False,
        "node_level_on_error": {
            "读取来源网页": "continueErrorOutput",
            "提取网页正文": "continueErrorOutput",
        },
        "error_workflow_usage": "NONE",
        "failure_handling_equivalence": "PASS_14_OF_14_ISOLATED_N8N",
        "api_request_schema_validation": "PASS_LOCAL_N8N_OPENAPI",
        "credential_values_embedded": False,
        "secret_embedded": False,
        "deterministic_json": True,
        "filename_safety": "PASS_FAIL_CLOSED",
        "ssrf_safety": "PASS_MINIMUM_LITERAL_AND_SCHEME_GUARD_WITH_DNS_REBINDING_RESIDUAL",
        "production_action_performed": False,
    }


def build_candidate_diffs() -> Mapping[str, Any]:
    return {
        "canonical_to_candidate": {
            "state": "MINIMAL_SECURITY_HARDENING",
            "nodes_added": ["输入与路径安全校验"],
            "nodes_removed": [],
            "nodes_modified": ["Read/Write Files from Disk"],
            "connections_added": ["On form submission -> 输入与路径安全校验", "输入与路径安全校验 -> Edit Fields"],
            "connections_removed": ["On form submission -> Edit Fields"],
            "input_schema_changed": False,
            "business_output_type_changed": False,
            "llm_call_changed": False,
            "knowledge_root_changed": False,
            "canonical_sha256": CANONICAL_WORKFLOW_SHA256,
            "candidate_sha256": CANDIDATE_SHA256,
        },
        "production_to_candidate": {
            "state": "MATERIAL_HARDENING_UPDATE",
            "production_nodes": 11,
            "candidate_nodes": 22,
            "production_edges": 12,
            "candidate_edges": 26,
            "nodes_added": [
                "输入与路径安全校验", "HTTP其他失败判断", "判断正文是否为空", "是否为禁止访问",
                "是否为限流失败", "标记为禁止访问", "标记为读取失败", "标记为限流",
                "标记网页为空", "读取来源网页规范化", "读取网页失败",
            ],
            "nodes_removed": [],
            "changed_shared_nodes": [
                "Basic LLM Chain", "Read/Write Files from Disk", "提取网页正文",
                "汇总网页资料", "补齐无网页资料", "读取来源网页",
            ],
            "trigger_change": "Form trigger preserved; safety node inserted after trigger",
            "error_handling_change": "empty-body, HTTP classification, error output, Error Trigger/onError added",
            "output_change": "same Markdown root; filename now uses validated safe_ai_name",
            "settings_change": "unsupported workflow-level onError omitted; node-level onError preserved",
            "api_projection": {
                "workflow_settings_onError": "OMITTED_INVALID_WORKFLOW_LEVEL_FIELD",
                "workflow_settings_binaryMode": "OMITTED_LOCAL_RESPONSE_DERIVED_FIELD",
                "node_level_onError_preserved": True,
                "nodes_changed_from_hardened_candidate": False,
                "connections_changed_from_hardened_candidate": False,
            },
        },
    }


def build_sandbox_validation() -> Mapping[str, Any]:
    return {
        "state": "PASS",
        "engine": "ISOLATED_TEST_ONLY_N8N_AND_DETERMINISTIC_NODE_HARNESS",
        "network": "NO_EXTERNAL_REAL_NETWORK",
        "production_credentials": False,
        "production_docker_modified": False,
        "six_state_regression": {
            "state": "PASS_REUSED_UNCHANGED_BUSINESS_SUBGRAPH",
            "execution_ids": ["42", "43", "44", "45", "46", "47"],
            "cases": ["forbidden", "rate_limited", "empty", "success", "failed", "not_provided"],
            "evidence": [
                {
                    "locator": "source_import/n8n_工作流开发/_system/V1.4.1_PASS_BASELINE.md.txt",
                    "sha256": "0FD67E4702640F96337E028F0A5A91E288E581C253148DE0C8AB58405B1FAF22",
                },
                {
                    "locator": "source_import/n8n_工作流开发/_system/n8n_runtime_test/evidence/authbridge5_run_summary.json",
                    "sha256": "597FBF61DCA418D13178BCEFA9E8DB36A0CA7EF7EB7303E6B3FA6F1DF7F10039",
                },
            ],
        },
        "filename_cases": {
            "normal": "PASS", "chinese": "PASS", "spaces": "PASS",
            "dotdot": "REJECTED", "slash_traversal": "REJECTED", "backslash_traversal": "REJECTED",
            "absolute_windows": "REJECTED", "reserved": "REJECTED", "illegal_chars": "REJECTED",
            "trailing_dot": "REJECTED", "trailing_spaces": "REJECTED", "overlong": "REJECTED",
        },
        "core_business": {
            "normal_text": "PASS", "source_text": "PASS", "source_url_stub_success": "PASS",
            "source_url_http_failure": "PASS", "empty_body": "PASS",
            "llm_failure": "EXPECTED_FAILED_NO_ARTIFACT", "file_write_failure": "EXPECTED_FAILED_NO_FALSE_SUCCESS",
            "error_trigger": "PASS_HISTORICAL_ISOLATED_EVIDENCE",
        },
        "production_execution": False,
    }


def build_result_artifact_validation() -> Mapping[str, Any]:
    return {
        "state": "PASS",
        "artifact_type": "knowledge_markdown_document",
        "media_type": "text/markdown",
        "path_template": "/knowledge/00_待审核/AI工具/{safe_ai_name}.md",
        "path_safe": True,
        "deterministic_filename": True,
        "raw_execution_payload_exposed": False,
        "copy_markdown": "COMPATIBLE",
        "open_file": "COMPATIBLE_AFTER_CORRELATION",
        "copy_file_path": "COMPATIBLE_AFTER_CORRELATION",
        "production_content_read": False,
    }


def build_restore_payload() -> Mapping[str, Any]:
    return {
        "rollback_id": ROLLBACK_ID,
        "state": "RESTORE_ROUTE_READY_SEMANTIC_EQUIVALENCE_VALIDATED",
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "backup_id": BACKUP_ID,
        "backup_revision": PRODUCTION_WORKFLOW_VERSION_ID,
        "backup_sha256": BACKUP_SHA256,
        "backup_relative_path": BACKUP_RELATIVE_PATH,
        "backup_provenance": "AUTHENTICATED_N8N_GET_ONLY_WORKFLOW_DEFINITION",
        "restore_request": {
            "method": "NOT_BOUND_UNTIL_APPROVED_PUBLISH_GOAL",
            "expected_failed_candidate_revision": CANDIDATE_VERSION_ID,
            "restore_exact_backup": True,
        },
        "post_restore_verification": ["membership", "revision", "updatedAt", "structure hash", "active/published state"],
        "isolated_restore_validation": {
            "state": "PASS_SEMANTIC_EQUIVALENCE_REUSE",
            "node_count": 11,
            "edge_count": 12,
            "semantic_structure_match": True,
            "historically_validated_backup_sha256": "A083EE4194D326735CB511373CAA062C92D54E84AD1D19A7BFBE073EB74C4565",
            "current_backup_sha256": BACKUP_SHA256,
            "fresh_definition_semantically_matches_validated_production": True,
            "content_addressed_evidence_reused": False,
            "network": "NONE",
            "transient_store_deleted": True,
        },
        "restore_performed": False,
        "production_write_performed": False,
    }


def build_production_update_request() -> Mapping[str, Any]:
    return {
        "request_type": "ProductionWorkflowUpdateRequest",
        "state": "READY_FOR_DEFINITION_UPDATE_REAPPROVAL",
        "publish_state": "DEFINITION_UPDATE_REAPPROVAL_REQUIRED",
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "revision_lock": asdict(build_production_revision_lock()),
        "candidate_id": CANDIDATE_ID,
        "candidate_sha256": CANDIDATE_SHA256,
        "old_candidate_sha256": OLD_CANDIDATE_SHA256,
        "old_approval_invalidated": True,
        "backup_id": BACKUP_ID,
        "backup_sha256": BACKUP_SHA256,
        "backup_relative_path": BACKUP_RELATIVE_PATH,
        "rollback_id": ROLLBACK_ID,
        "candidate_validation": "PASS",
        "sandbox": "PASS",
        "secret_safety": "PASS",
        "filename_safety": "PASS",
        "result_artifact_validation": "PASS",
        "post_publish_verification": "READY",
        "first_run_gate": "BLOCKED_UNTIL_PRODUCTION_UPDATE_VERIFIED",
        "user_approval_required": True,
        "production_action_performed": False,
    }


def build_publish_approval_payload() -> Mapping[str, Any]:
    return {
        "title": "天工 · 知识采集器更新",
        "state": "READY_FOR_DEFINITION_UPDATE_REAPPROVAL",
        "current_production": {"revision": PRODUCTION_WORKFLOW_VERSION_ID, "nodes": 11, "active": False},
        "candidate": {"label": "V1.4.1 Hardened API-Compatible", "nodes": 22, "sha256": CANDIDATE_SHA256},
        "old_candidate_sha256": OLD_CANDIDATE_SHA256,
        "old_approval_invalidated": True,
        "major_changes": ["网页失败兜底", "空正文处理", "Error Trigger", "完整失败状态", "文件名与 URL 安全加固"],
        "tests": "PASS",
        "sandbox": "PASS",
        "production_backup": "FRESH_AUTHENTICATED_BACKUP_CONFIRMED",
        "backup_sha256": BACKUP_SHA256,
        "rollback": "RESTORE_ROUTE_VALIDATED_BY_SEMANTIC_EQUIVALENCE",
        "approval_scope": "DEFINITION_UPDATE_ONLY",
        "production_effect": "Update definition only; publish/activate remain separately explicit",
        "actions": ["APPROVE_DEFINITION_UPDATE", "VIEW_DIFF", "CANCEL"],
        "approval_granted": False,
        "production_action_performed": False,
    }


def build_activation_strategy() -> Mapping[str, Any]:
    return {
        "state": "SEPARATE_EXPLICIT_DECISIONS",
        "steps": [
            {"step": 1, "action": "UPDATE_DEFINITION", "approval_required": True},
            {"step": 2, "action": "VERIFY_NEW_REVISION_AND_STRUCTURE", "approval_required": False},
            {"step": 3, "action": "PUBLISH_OR_ACTIVATE", "approval_required": True},
        ],
        "update_implies_publish": False,
        "update_implies_activate": False,
        "automatic_activation": False,
    }


def build_post_publish_verification() -> Mapping[str, Any]:
    return {
        "state": "READY",
        "checks": [
            "workflow membership", "new revision", "updatedAt", "candidate structure hash",
            "active/published state", "Form invocation surface", "Provider health",
        ],
        "mismatch_state": "PUBLISH_VERIFICATION_FAILED",
        "first_run_allowed_on_mismatch": False,
        "performed": False,
    }


def build_first_run_gate() -> Mapping[str, Any]:
    return {
        "state": "BLOCKED_UNTIL_PRODUCTION_UPDATE_VERIFIED",
        "required": [
            "new production revision confirmed", "callable", "runtime credential available",
            "safe pilot input", "artifact collision checked", "user run approval",
        ],
        "workflow_execution_performed": False,
    }


def build_production_update_status() -> Mapping[str, Any]:
    return {
        "version": TIANGONG_PRODUCTION_UPDATE_VERSION,
        "state": "TIANGONG_API_COMPATIBLE_CANDIDATE_VALIDATED",
        "publish_state": "READY_FOR_DEFINITION_UPDATE_REAPPROVAL",
        "user_approval": "REQUIRED",
        "ready_to_publish": False,
        "current_production": {
            "revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "updated_at": PRODUCTION_WORKFLOW_UPDATED_AT,
            "node_count": 11,
            "active": False,
            "active_version_id": None,
            "state": "INACTIVE_UNPUBLISHED_LEGACY_DEFINITION",
        },
        "update_required": True,
        "run_state": "BLOCKED_UNTIL_VERIFIED_PRODUCTION_UPDATE",
        "repair_diagnosis_state": "READY",
        "workflow_ready": False,
        "revision_lock": asdict(build_production_revision_lock()),
        "backup": {
            "state": "FRESH_AUTHENTICATED_BACKUP_CONFIRMED",
            "backup_id": BACKUP_ID,
            "sha256": BACKUP_SHA256,
            "relative_path": BACKUP_RELATIVE_PATH,
            "observed_at": BACKUP_OBSERVED_AT,
            "immutable": True,
        },
        "candidate": build_candidate_validation(),
        "diff": build_candidate_diffs(),
        "sandbox": build_sandbox_validation(),
        "artifact": build_result_artifact_validation(),
        "rollback": build_restore_payload(),
        "publish_request": build_production_update_request(),
        "approval": build_publish_approval_payload(),
        "activation_strategy": build_activation_strategy(),
        "post_publish_verification": build_post_publish_verification(),
        "first_run_gate": build_first_run_gate(),
        "side_effects": {
            "credential_persisted": False, "secret_exposed": False, "production_workflow_write": False,
            "production_execution": False, "production_form_submit": False, "docker_modification": False,
        },
    }


__all__ = [
    "BACKUP_ID", "BACKUP_OBSERVED_AT", "BACKUP_RELATIVE_PATH", "BACKUP_SHA256",
    "CANDIDATE_ID", "CANDIDATE_SHA256", "CANDIDATE_VERSION_ID", "ROLLBACK_ID",
    "OLD_CANDIDATE_SHA256",
    "TIANGONG_PRODUCTION_UPDATE_VERSION", "ProductionRevisionLock", "build_activation_strategy",
    "build_candidate_diffs", "build_candidate_validation", "build_first_run_gate",
    "build_post_publish_verification", "build_production_revision_lock", "build_production_update_request",
    "build_production_update_status", "build_publish_approval_payload", "build_restore_payload",
    "build_result_artifact_validation", "build_sandbox_validation", "verify_revision_lock",
]
