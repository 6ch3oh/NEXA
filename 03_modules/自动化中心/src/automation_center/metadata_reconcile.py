"""Frozen Tiangong Metadata evidence and first-run reconciliation projections.

This module contains only sanitized evidence supplied by the user and safe
structural facts derived from the read-only Legacy exports. It cannot perform
network requests, Workflow execution, or production writes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping

from automation_center.auth_metadata import (
    CANONICAL_WORKFLOW_SHA256,
    CANONICAL_WORKFLOW_VERSION_ID,
)
from automation_center.run_prep import (
    TIANGONG_PROVIDER_INSTANCE_ID,
    TIANGONG_WORKFLOW_EXTERNAL_ID,
)


TIANGONG_METADATA_RECONCILE_VERSION = "0.1"
PRODUCTION_WORKFLOW_VERSION_ID = "0fd6b9b7-ee0d-44b3-a494-7469be49bf96"
PRODUCTION_WORKFLOW_UPDATED_AT = "2026-08-03T04:14:22.460000+00:00"
PRODUCTION_DEFINITION_SHA256 = "A083EE4194D326735CB511373CAA062C92D54E84AD1D19A7BFBE073EB74C4565"
AUTHENTICATED_METADATA_OBSERVED_AT = "2026-08-13T11:19:19.780687+00:00"
REPORTED_CANONICAL_SHA256 = "B9930522676127566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514"

_ALLOWED_READINESS = {
    "READY", "CONFIRMED", "AUTH_REQUIRED_AT_RUNTIME", "USER_DECISION_REQUIRED",
    "UPDATE_REQUIRED", "NOT_READY", "BLOCKED",
}


def build_frozen_authenticated_metadata_evidence() -> Mapping[str, Any]:
    return {
        "source": "AUTHENTICATED_N8N_METADATA",
        "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
        "provider_display_name": "天工",
        "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
        "workflow_membership": "CONFIRMED",
        "active": False,
        "production_revision": PRODUCTION_WORKFLOW_VERSION_ID,
        "production_updated_at": PRODUCTION_WORKFLOW_UPDATED_AT,
        "invocation_surface": "CONFIRMED",
        "observed_at": AUTHENTICATED_METADATA_OBSERVED_AT,
        "freshness": {
            "state": "FROZEN_OBSERVATION",
            "fresh_at_capture": True,
            "currentness_requires_new_read": True,
        },
        "metadata_auth": "CONFIRMED",
        "credential_runtime_available_at_capture": True,
        "credential_runtime_available_now": False,
        "credential_persisted": False,
        "secret_exposed": False,
        "workflow_execution": False,
        "form_submit": False,
        "production_write": False,
    }


def build_structural_reconciliation() -> Mapping[str, Any]:
    return {
        "state": "REVISION_DIVERGENCE",
        "decision": "CANONICAL_UPDATE_REQUIRED",
        "production": {
            "revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "updated_at": PRODUCTION_WORKFLOW_UPDATED_AT,
            "definition_sha256": PRODUCTION_DEFINITION_SHA256,
            "node_count": 11,
            "edge_count": 12,
            "active": False,
            "active_version_id": None,
            "trigger_count": 0,
            "error_trigger": False,
            "markdown_output_chain": True,
            "filename_expression_direct_ai_name": True,
            "settings": {"executionOrder": "v1", "binaryMode": "separate", "availableInMCP": False},
            "evidence_role": "CURRENT_PRODUCTION_SAVED_DEFINITION",
        },
        "canonical": {
            "revision": CANONICAL_WORKFLOW_VERSION_ID,
            "definition_sha256": CANONICAL_WORKFLOW_SHA256,
            "node_count": 21,
            "edge_count": 25,
            "active": False,
            "error_trigger": True,
            "markdown_output_chain": True,
            "filename_expression_direct_ai_name": True,
            "settings": {
                "executionOrder": "v1", "binaryMode": "separate",
                "availableInMCP": False, "onError": "continueRegularOutput",
            },
            "sandbox_execution_ids": ["42", "43", "44", "45", "46", "47"],
            "sandbox_six_state_result": "PASS",
            "evidence_role": "VALIDATED_UPDATE_CANDIDATE_SOURCE",
        },
        "canonical_hash_reconciliation": {
            "reported_in_smoke_transcript": REPORTED_CANONICAL_SHA256,
            "verified_from_disk": CANONICAL_WORKFLOW_SHA256,
            "state": "TRANSCRIPTION_DIFFERENCE_DISK_HASH_VERIFIED",
            "update_lock_uses": "VERIFIED_DISK_HASH",
        },
        "canonical_only_nodes": [
            "HTTP其他失败判断", "判断正文是否为空", "是否为禁止访问", "是否为限流失败",
            "标记为禁止访问", "标记为读取失败", "标记为限流", "标记网页为空",
            "读取来源网页规范化", "读取网页失败",
        ],
        "changed_shared_nodes": [
            "Basic LLM Chain", "提取网页正文", "汇总网页资料", "补齐无网页资料", "读取来源网页",
        ],
        "same_shared_nodes": [
            "Convert to File", "Edit Fields", "On form submission", "OpenAI Chat Model",
            "Read/Write Files from Disk", "是否提供来源网址",
        ],
        "material_differences": [
            "production lacks canonical empty-body handling",
            "production lacks canonical HTTP failure classification and fallback branches",
            "production lacks canonical Error Trigger and workflow onError setting",
            "production has older fallback field typing and incomplete status fields",
            "both definitions directly interpolate ai_name into the Markdown filename",
        ],
        "production_manual_change_assessment": "NO_NEWER_VALID_FIX_IDENTIFIED",
        "likely_newer_side": "CANONICAL",
        "recommended_authority": "CANONICAL_AS_HARDENED_UPDATE_CANDIDATE",
        "production_write_performed": False,
    }


def _readiness(status: str, reason: str) -> Mapping[str, str]:
    if status not in _ALLOWED_READINESS:
        raise ValueError("readiness status is invalid")
    return {"status": status, "reason": reason}


def build_first_run_readiness() -> Mapping[str, Any]:
    matrix = {
        "Provider Health": _readiness("READY", "loopback health is independently observable and must be rechecked before change"),
        "Provider Identity": _readiness("CONFIRMED", "user-confirmed Tiangong identity"),
        "Workflow Membership": _readiness("CONFIRMED", "authenticated provider Metadata"),
        "Production Revision": _readiness("CONFIRMED", PRODUCTION_WORKFLOW_VERSION_ID),
        "Canonical Alignment": _readiness("UPDATE_REQUIRED", "production is the older 11-node draft; canonical is the validated 21-node candidate"),
        "Published State": _readiness("NOT_READY", "activeVersionId is null; a published production version is not established"),
        "Active State": _readiness("BLOCKED", "authenticated Metadata reports active=false"),
        "Invocation Surface": _readiness("CONFIRMED", "Form trigger structure is confirmed but is not callable while inactive"),
        "Metadata Auth": _readiness("CONFIRMED", "process-only authenticated GET completed"),
        "Execution Auth": _readiness("AUTH_REQUIRED_AT_RUNTIME", "the API key was released after the smoke and is never persisted"),
        "Input Safety": _readiness("READY", "NEXA filename and source input policy is implemented"),
        "Artifact Safety": _readiness("NOT_READY", "collision metadata check and candidate filename hardening remain required"),
        "Result Copy": _readiness("READY", "safe Markdown copy adapter is implemented; a correlated result is still required"),
        "Diagnosis": _readiness("READY", "safe failure and Queqiao handoff payloads are implemented"),
        "Repair": _readiness("READY", "current production revision is confirmed for optimistic locking"),
        "Backup": _readiness("NOT_READY", "immutable production backup must precede an approved update"),
        "Publish": _readiness("NOT_READY", "production update and publish require separate user approval"),
    }
    return {
        "state": "KNOWLEDGE_COLLECT_FIRST_RUN_RECONCILED",
        "first_run_readiness": "UPDATE_REQUIRED",
        "update_required": True,
        "user_decision_required": False,
        "recommended_next_goal": "PRODUCTION_RECONCILIATION_AND_UPDATE",
        "matrix": matrix,
        "workflow_execution": False,
        "form_submit": False,
        "production_write": False,
    }


def build_update_preparation() -> Mapping[str, Any]:
    backup_name = (
        "tiangong_knowledge_collect_ymYh8t76VP3jGPbr_"
        "0fd6b9b7-ee0d-44b3-a494-7469be49bf96_20260803T041422460Z.json"
    )
    return {
        "state": "READY_FOR_USER_UPDATE_APPROVAL",
        "authority": "CANONICAL_AS_HARDENED_UPDATE_CANDIDATE",
        "backup_request": {
            "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
            "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
            "expected_current_revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "immutable_backup_name": backup_name,
            "include_definition": True,
            "include_credentials": False,
            "performed": False,
        },
        "candidate": {
            "candidate_id": "knowledge-collect-v141-canonical-reconcile-001",
            "source_revision": CANONICAL_WORKFLOW_VERSION_ID,
            "source_sha256": CANONICAL_WORKFLOW_SHA256,
            "required_validation": [
                "current revision lock still matches",
                "credential references remain opaque",
                "filename safety is hardened or enforced at every invocation surface",
                "six-state sandbox evidence remains valid",
                "candidate remains inactive until explicit publish approval",
            ],
        },
        "publish_payload": {
            "operation": "UPDATE_AND_PUBLISH_AFTER_APPROVAL",
            "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
            "workflow_external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
            "expected_current_revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "candidate_id": "knowledge-collect-v141-canonical-reconcile-001",
            "activate_without_approval": False,
            "performed": False,
        },
        "rollback_plan": {
            "source": backup_name,
            "trigger": "publish failure or post-publish verification failure",
            "restore_exact_revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "performed": False,
        },
        "post_publish_verification": [
            "authenticated Metadata membership and new revision",
            "published/active state",
            "Form invocation surface identity",
            "definition structural hash",
            "no credential exposure",
        ],
        "approval_payload": {
            "title": "天工 · knowledge.collect 生产版本对账更新",
            "current_revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "candidate_revision": CANONICAL_WORKFLOW_VERSION_ID,
            "summary": "将较旧 11 节点 production 草稿更新为经隔离六状态验证的 V1.4.1 加固候选",
            "requires_backup": True,
            "requires_post_publish_verify": True,
            "actions": ["APPROVE_UPDATE", "CANCEL"],
        },
        "production_write_performed": False,
    }


def build_reconciled_auth_metadata_product_status() -> Mapping[str, Any]:
    evidence = build_frozen_authenticated_metadata_evidence()
    return {
        "version": TIANGONG_METADATA_RECONCILE_VERSION,
        "state": "TIANGONG_AUTHENTICATED_METADATA_READY",
        "auth": {
            "mechanism": "N8N_PUBLIC_API_KEY",
            "header": "X-N8N-API-KEY",
            "credential_source": "EXTERNAL_RUNTIME_PROVIDER",
            "availability": "UNAVAILABLE",
            "availability_at_metadata_capture": "AVAILABLE",
            "lifecycle": "RELEASED_AFTER_SMOKE",
            "metadata_auth": "CONFIRMED",
            "execution_auth": "REQUIRED_AT_EXECUTION_TIME",
            "credential_persisted": False,
            "secret_exposed": False,
        },
        "provider": {"provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID, "display_name": "天工"},
        "workflow": {
            "external_id": TIANGONG_WORKFLOW_EXTERNAL_ID,
            "membership": "CONFIRMED",
            "active": False,
            "production_revision": PRODUCTION_WORKFLOW_VERSION_ID,
            "updated_at": PRODUCTION_WORKFLOW_UPDATED_AT,
            "observed_at": evidence["observed_at"],
        },
        "form_surface": "CONFIRMED_NOT_CALLABLE_WHILE_INACTIVE",
        "binding": {
            "binding_id": "knowledge-collect-v141",
            "provider_instance_id": TIANGONG_PROVIDER_INSTANCE_ID,
            "workflow_membership": "CONFIRMED",
            "progress_state": "INVOCATION_SURFACE_CONFIRMED",
            "execution_enabled": False,
        },
        "run_readiness": "UPDATE_REQUIRED",
        "revision_reconciliation": build_structural_reconciliation(),
        "side_effects": {
            "metadata_get": True, "workflow_execution": False,
            "form_submit": False, "production_write": False,
        },
    }


def build_tiangong_metadata_reconciliation_status() -> Mapping[str, Any]:
    return {
        "version": TIANGONG_METADATA_RECONCILE_VERSION,
        "state": "KNOWLEDGE_COLLECT_FIRST_RUN_RECONCILED",
        "authenticated_metadata": build_frozen_authenticated_metadata_evidence(),
        "definition_reconciliation": build_structural_reconciliation(),
        "readiness": build_first_run_readiness(),
        "update_preparation": build_update_preparation(),
    }


__all__ = [
    "AUTHENTICATED_METADATA_OBSERVED_AT", "PRODUCTION_DEFINITION_SHA256",
    "PRODUCTION_WORKFLOW_UPDATED_AT", "PRODUCTION_WORKFLOW_VERSION_ID", "REPORTED_CANONICAL_SHA256",
    "TIANGONG_METADATA_RECONCILE_VERSION", "build_first_run_readiness",
    "build_frozen_authenticated_metadata_evidence", "build_reconciled_auth_metadata_product_status",
    "build_structural_reconciliation", "build_tiangong_metadata_reconciliation_status",
    "build_update_preparation",
]
