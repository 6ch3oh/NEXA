"""The single Creator Ops V0.1 composition root."""

from __future__ import annotations

from pathlib import Path

from creator_ops.api.contracts import DatabaseState, LifecycleResult, LifecycleStatus
from creator_ops.api.lifecycle import DatabaseLifecycleService
from creator_ops.application.persistent_service import PersistentCreatorOpsService
from creator_ops.application.automation_contract import AutomationRecoveryPlanner, TaskLockPlanner
from creator_ops.application.runtime import DurableRuntimeService
from creator_ops.application.qa_runtime import QAService
from creator_ops.application.research import ResearchRuntimeService
from creator_ops.application.production_import import ProductionImportService
from creator_ops.application.canonical_activation import CanonicalActivationService
from creator_ops.application.visual_asset_pipeline import VisualAssetPipelineService
from creator_ops.application.works import LocalWorksService
from creator_ops.application.workbenches import (
    ActivityViewService,
    ManualPublishingWorkbenchService,
    MetricsBackfillWorkbenchService,
    ReviewWorkbenchService,
)
from creator_ops.persistence.query_service import CreatorOpsQueryService
from creator_ops.persistence.sqlite_adapter import DatabaseLocation, SQLiteCreatorOpsStore


class CreatorOpsCompositionRoot:
    """Only place that assembles storage, repositories, services and public API."""

    def __init__(self, database_path: str | Path | None = None) -> None:
        self.database_path = DatabaseLocation.validate(
            Path(database_path) if database_path is not None else DatabaseLocation.default_path()
        )
        self.lifecycle = DatabaseLifecycleService(self.database_path)
        self.store: SQLiteCreatorOpsStore | None = None
        self.query: CreatorOpsQueryService | None = None
        self.application_service: PersistentCreatorOpsService | None = None
        self.manual_workbench: ManualPublishingWorkbenchService | None = None
        self.metrics_workbench: MetricsBackfillWorkbenchService | None = None
        self.review_workbench: ReviewWorkbenchService | None = None
        self.activity_view: ActivityViewService | None = None
        self.runtime_service: DurableRuntimeService | None = None
        self.qa_service: QAService | None = None
        self.research_service: ResearchRuntimeService | None = None
        self.production_import_service: ProductionImportService | None = None
        self.canonical_activation_service: CanonicalActivationService | None = None
        self.visual_asset_service: VisualAssetPipelineService | None = None
        self.works_service: LocalWorksService | None = None
        self.task_lock_planner = TaskLockPlanner()
        self.recovery_planner = AutomationRecoveryPlanner()
        self._closed_once = False

    @property
    def database_state(self) -> DatabaseState:
        if self.store is not None:
            return DatabaseState.OPEN
        inspected = self.lifecycle.inspect().state
        if self._closed_once and inspected is DatabaseState.READY:
            return DatabaseState.CLOSED
        return inspected

    def open(self) -> LifecycleResult:
        if self.store is not None:
            return LifecycleResult("open", LifecycleStatus.ALREADY_OPEN, DatabaseState.OPEN, "Local store is already open")
        inspected = self.lifecycle.inspect()
        if inspected.state is DatabaseState.NOT_INITIALIZED:
            return LifecycleResult(
                "open", LifecycleStatus.INITIALIZATION_REQUIRED, inspected.state,
                "Explicit initialize_local_store(confirmation=True) is required",
            )
        if inspected.state is DatabaseState.UNSUPPORTED_SCHEMA:
            return LifecycleResult("open", LifecycleStatus.UNSUPPORTED_SCHEMA, inspected.state, inspected.message)
        if inspected.state is DatabaseState.STORAGE_ERROR:
            return LifecycleResult("open", LifecycleStatus.STORAGE_ERROR, inspected.state, inspected.message)
        try:
            self._assemble()
            self._closed_once = False
            return LifecycleResult("open", LifecycleStatus.SUCCESS, DatabaseState.OPEN, "Local store opened")
        except Exception:
            self.close()
            return LifecycleResult("open", LifecycleStatus.STORAGE_ERROR, DatabaseState.STORAGE_ERROR, "Unable to open local store")

    def initialize(self, *, confirmation: bool) -> LifecycleResult:
        if not confirmation:
            return LifecycleResult(
                "initialize_local_store", LifecycleStatus.CONFIRMATION_REQUIRED,
                self.database_state, "confirmation=True is required",
            )
        if self.store is not None:
            return LifecycleResult(
                "initialize_local_store", LifecycleStatus.ALREADY_INITIALIZED,
                DatabaseState.OPEN, "Compatible local store is already initialized",
            )
        inspected = self.lifecycle.inspect()
        if inspected.state is DatabaseState.UNSUPPORTED_SCHEMA:
            return LifecycleResult(
                "initialize_local_store", LifecycleStatus.UNSUPPORTED_SCHEMA,
                inspected.state, inspected.message,
            )
        if inspected.state is DatabaseState.STORAGE_ERROR:
            return LifecycleResult(
                "initialize_local_store", LifecycleStatus.STORAGE_ERROR,
                inspected.state, inspected.message,
            )
        created = inspected.state is DatabaseState.NOT_INITIALIZED
        try:
            if created:
                self.database_path.parent.mkdir(parents=True, exist_ok=True)
            self._assemble()
            self._closed_once = False
            status = LifecycleStatus.SUCCESS if created else LifecycleStatus.ALREADY_INITIALIZED
            message = "Local store initialized" if created else "Compatible local store already initialized"
            return LifecycleResult("initialize_local_store", status, DatabaseState.OPEN, message, created=created)
        except Exception:
            self.close()
            return LifecycleResult(
                "initialize_local_store", LifecycleStatus.STORAGE_ERROR,
                DatabaseState.STORAGE_ERROR, "Unable to initialize local store", created=False,
            )

    def _assemble(self) -> None:
        store = SQLiteCreatorOpsStore(self.database_path)
        self.store = store
        self.query = CreatorOpsQueryService(store)
        self.application_service = PersistentCreatorOpsService(store)
        pipeline = self.application_service.pipeline
        self.manual_workbench = ManualPublishingWorkbenchService(pipeline)
        self.metrics_workbench = MetricsBackfillWorkbenchService()
        self.review_workbench = ReviewWorkbenchService()
        self.activity_view = ActivityViewService()
        self.runtime_service = DurableRuntimeService(store)
        self.qa_service = QAService(store)
        self.research_service = ResearchRuntimeService(store)
        self.production_import_service = ProductionImportService(store)
        self.canonical_activation_service = CanonicalActivationService(store)
        self.visual_asset_service = VisualAssetPipelineService(store)
        self.works_service = LocalWorksService(store)

    def close(self) -> LifecycleResult:
        was_open = self.store is not None
        if self.store is not None:
            self.store.close()
        self.store = None
        self.query = None
        self.application_service = None
        self.manual_workbench = None
        self.metrics_workbench = None
        self.review_workbench = None
        self.activity_view = None
        self.runtime_service = None
        self.qa_service = None
        self.research_service = None
        self.production_import_service = None
        self.canonical_activation_service = None
        self.visual_asset_service = None
        self.works_service = None
        self._closed_once = self._closed_once or was_open
        return LifecycleResult("close", LifecycleStatus.SUCCESS, self.database_state, "Local store closed")

    def build_application(self):
        """Construct the public facade without exporting the assembled internals."""

        from creator_ops.api.application import CreatorOpsApplication
        return CreatorOpsApplication(self)


def create_composition_root(database_path: str | Path | None = None) -> CreatorOpsCompositionRoot:
    """Small constructor/factory seam for tests and future adapters."""

    return CreatorOpsCompositionRoot(database_path)
