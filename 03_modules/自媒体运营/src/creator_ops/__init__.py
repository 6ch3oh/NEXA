"""Controlled public export surface for Creator Ops V0.2."""

from creator_ops.api.application import CreatorOpsApplication, create_creator_ops_application
from creator_ops.api.contracts import (
    API_VERSION,
    MODULE_VERSION,
    AccountDTO,
    AssetDTO,
    CommandResult,
    CommandStatus,
    ContentDTO,
    ContentDetailDTO,
    CreatorDTO,
    CreatorOpsAPIError,
    DatabaseState,
    HealthReport,
    HealthStatus,
    LifecycleResult,
    LifecycleStatus,
    MetricsDTO,
    ProvenanceDTO,
    PublicError,
    PublishRecordDTO,
    ReviewDTO,
    RuntimeInfo,
)
from creator_ops.application.automation_contract import (
    AutomationResult, AutomationResultStatus, AutomationTask, AutomationTaskStatus,
    AutomationTrigger, AutomationTriggerType, HumanAIHandoff, LockPlan, LockStatus,
    RecoveryAction, RecoveryCheckpoint, RecoveryPlan, RetryPolicy, TaskLock,
)
from creator_ops.compatibility.case_library import LegacyCase
from creator_ops.domain.quality import QACheck, QALevel, QAReport, QAScope, QAStatus
from creator_ops.viewmodels.content_package import (
    ContentPackageManifest, ContentPackageRequest, PackageCompleteness,
    PackageCompatibility, PackageFileSpec,
)
from creator_ops.application.runtime import (
    AuditEvent, DurableTask, DurableTaskLock, DurableTaskStatus, DurableTaskType,
    RecoveryDecision, RecoveryEvidence,
)
from creator_ops.application.package_writer import (
    PackageBuildRequest, PackageFileInput, PackageWriteResult, PackageWriteStatus,
)
from creator_ops.application.qa_runtime import QAReceipt, QAReceiptStatus, QAType, RuntimeQACheck
from creator_ops.application.research import (
    ResearchSession, ResearchSource, ResearchSourceType, ResearchStatus, TopicCandidate,
)
from creator_ops.application.production_workflow import (
    ProductionAssetInput, ProductionStep, ProductionWorkflowRequest, ProductionWorkflowResult,
)
from creator_ops.services.import_readiness import FinalImportPlanV02
from creator_ops.application.production_import import (
    ProductionBackupReceipt, ProductionImportDisposition, ProductionImportLedgerEntry,
    ProductionImportReceipt, ProductionImportResult,
)
from creator_ops.application.canonical_activation import (
    ActivationResolutionStatus, CanonicalActivationReceipt,
    CanonicalActivationRequest, CanonicalActivationResolution,
)
from creator_ops.application.work_queue import (
    Blocker, BlockerCode, FieldOwnership, NextAction, NextActionType,
    OperatorWorkState, Priority, WorkItem, WorkItemStatus, WorkType,
)
from creator_ops.application.workbenches import (
    ActivityEvent, ActivityEventType, ChecklistStatus, ManualPublishingWorkbench,
    MetricsBackfillWorkbench, ReadinessCheck, ReviewWorkbench,
)
from creator_ops.application.real_asset_pipeline import RealReviewWorkbench
from creator_ops.application.visual_asset_pipeline import (
    AssetIntakeStatus, AssetIntakeSubmission, AssetRequirement, AssetRequirementStatus,
    AssetSubmissionStatus, HumanAIImageHandoff, MediaValidationResult,
    MediaValidationStatus, VisualProductionPacket, VisualProductionSpec,
    VisualReviewDecision, VisualReviewRecord, VisualReviewWorkbench,
)
from creator_ops.viewmodels.content_package import ContentPackageV01
from creator_ops.viewmodels.operator_dashboard import (
    AccountWorkload, OperatorDashboard, OperatorSummary,
)

__all__ = [
    "API_VERSION",
    "MODULE_VERSION",
    "CreatorOpsApplication",
    "create_creator_ops_application",
    "CreatorOpsAPIError",
    "DatabaseState",
    "LifecycleStatus",
    "CommandStatus",
    "HealthStatus",
    "LifecycleResult",
    "CommandResult",
    "PublicError",
    "RuntimeInfo",
    "HealthReport",
    "CreatorDTO",
    "AccountDTO",
    "ContentDTO",
    "AssetDTO",
    "PublishRecordDTO",
    "MetricsDTO",
    "ReviewDTO",
    "ProvenanceDTO",
    "ContentDetailDTO",
    "AutomationTask", "AutomationTaskStatus", "RetryPolicy", "TaskLock", "LockStatus",
    "AutomationTrigger", "AutomationTriggerType", "AutomationResult", "AutomationResultStatus",
    "HumanAIHandoff",
    "LockPlan", "RecoveryCheckpoint", "RecoveryAction", "RecoveryPlan",
    "QACheck", "QALevel", "QAReport", "QAScope", "QAStatus",
    "ContentPackageManifest", "ContentPackageRequest", "PackageCompleteness",
    "PackageCompatibility", "PackageFileSpec",
    "LegacyCase",
    "DurableTask", "DurableTaskType", "DurableTaskStatus", "DurableTaskLock",
    "RecoveryDecision", "RecoveryEvidence", "AuditEvent",
    "PackageBuildRequest", "PackageFileInput", "PackageWriteResult", "PackageWriteStatus",
    "QAReceipt", "QAReceiptStatus", "QAType", "RuntimeQACheck",
    "ResearchSession", "ResearchSource", "ResearchSourceType", "ResearchStatus", "TopicCandidate",
    "ProductionAssetInput", "ProductionStep", "ProductionWorkflowRequest", "ProductionWorkflowResult",
    "FinalImportPlanV02",
    "ProductionImportDisposition", "ProductionImportLedgerEntry",
    "ProductionImportReceipt", "ProductionImportResult",
    "ProductionBackupReceipt",
    "ActivationResolutionStatus", "CanonicalActivationRequest",
    "CanonicalActivationResolution", "CanonicalActivationReceipt",
    "Blocker", "BlockerCode", "FieldOwnership", "NextAction", "NextActionType",
    "OperatorWorkState", "Priority", "WorkItem", "WorkItemStatus", "WorkType",
    "ActivityEvent", "ActivityEventType", "ChecklistStatus",
    "ManualPublishingWorkbench", "MetricsBackfillWorkbench", "ReadinessCheck",
    "ReviewWorkbench", "RealReviewWorkbench",
    "AssetIntakeStatus", "AssetIntakeSubmission", "AssetRequirement", "AssetRequirementStatus",
    "AssetSubmissionStatus", "HumanAIImageHandoff", "MediaValidationResult",
    "MediaValidationStatus", "VisualProductionPacket", "VisualProductionSpec",
    "VisualReviewDecision", "VisualReviewRecord", "VisualReviewWorkbench",
    "ContentPackageV01", "AccountWorkload", "OperatorDashboard", "OperatorSummary",
    "CreatorOpsUIHost", "UIEndpoint", "UIHostLifecycleState", "UIHostReadiness",
    "create_creator_ops_ui_host",
]


def __getattr__(name: str):
    """Lazily expose the versioned local UI host contract."""

    if name in {
        "CreatorOpsUIHost",
        "UIEndpoint",
        "UIHostLifecycleState",
        "UIHostReadiness",
        "create_creator_ops_ui_host",
    }:
        from creator_ops.ui import host

        return getattr(host, name)
    raise AttributeError(name)
