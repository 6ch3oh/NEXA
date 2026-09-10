"""Creator Ops authoritative Public Application API / Facade V0.2."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from creator_ops.api.composition import CreatorOpsCompositionRoot, create_composition_root
from creator_ops.api.contracts import (
    API_VERSION, HISTORICAL_ASSET_STATE, MODULE_VERSION, AccountDTO, AssetDTO,
    CommandResult, CommandStatus, ContentDTO, ContentDetailDTO, CreatorDTO,
    CreatorOpsAPIError, DatabaseState, HealthReport, HealthStatus, LifecycleResult,
    MetricsDTO, ProvenanceDTO, PublicError, PublishRecordDTO, ReviewDTO, RuntimeInfo,
)
from creator_ops.application.work_queue import WorkItem, WorkItemStatus
from creator_ops.application.automation_contract import (
    RecoveryCheckpoint, RecoveryPlan, RetryPolicy, TaskLock, LockPlan,
)
from creator_ops.application.runtime import (
    AuditEvent, DurableTask, DurableTaskType, RecoveryEvidence,
)
from creator_ops.application.qa_runtime import FormalQARunner, QAReceipt, QAReceiptStatus, QAType
from creator_ops.application.package_writer import (
    LocalPackageWriter, PackageBuildRequest, PackageFileInput,
)
from creator_ops.application.canonical_activation import CanonicalActivationRequest
from creator_ops.application.real_asset_pipeline import (
    RealAssetCandidate, RealReviewWorkbench, RealReviewWorkbenchService,
    VerifiedAssetActivationService,
)
from creator_ops.application.visual_asset_pipeline import (
    AssetIntakeStatus, AssetIntakeSubmission, AssetRequirement, AssetSubmissionStatus,
    VisualProductionPacket, VisualReviewDecision, VisualReviewRecord, VisualReviewWorkbench,
    build_authoritative_visual_packets,
)
from creator_ops.application.research import (
    ResearchSession, ResearchSource, ResearchSourceType, TopicCandidate,
)
from creator_ops.application.works import LocalWorksService, WorksError
from creator_ops.application.workbenches import (
    ActivityEvent, ManualPublishingWorkbench, MetricsBackfillWorkbench, ReviewWorkbench,
)
from creator_ops.compatibility.case_library import LegacyCase, LegacyCaseLibraryMapper
from creator_ops.domain.quality import QACompatibilityMapper, QAReport
from creator_ops.viewmodels.content_package import (
    ContentPackageManifest, ContentPackageRequest, PackageCompleteness,
    evaluate_package_completeness, map_legacy_content_request, map_legacy_package_manifest,
)
from creator_ops.domain.models import (
    Account, AccountStatus, Asset, AssetStatus, AssetType, ContentItem, ContentState,
    ContentType, ContractError, Creator, CreatorStatus, GenerationMethod, Metrics,
    Provenance, PublishRecord, Review,
)
from creator_ops.persistence.contracts import WorkItemOverlay
from creator_ops.persistence.errors import PersistenceError, PersistenceErrorCode
from creator_ops.persistence.sqlite_adapter import DatabaseLocation, SCHEMA_VERSION
from creator_ops.services.content_pipeline import MetricsInputMode, PipelineError
from creator_ops.services.import_readiness import FinalImportPlannerV02
from creator_ops.compatibility.real_legacy import RealLegacyAdapter, RealLegacyReader
from creator_ops.viewmodels.operator_dashboard import (
    AccountWorkload, OperatorDashboard, build_account_workload,
)


class CreatorOpsApplication:
    """Stable boundary used by future UI/Core integration code."""

    def __init__(self, composition_root: CreatorOpsCompositionRoot) -> None:
        self._root = composition_root

    def open(self) -> LifecycleResult:
        return self._root.open()

    def initialize_local_store(self, *, confirmation: bool) -> LifecycleResult:
        return self._root.initialize(confirmation=confirmation)

    def close(self) -> LifecycleResult:
        return self._root.close()

    def __enter__(self) -> "CreatorOpsApplication":
        result = self.open()
        if result.database_state is not DatabaseState.OPEN:
            raise CreatorOpsAPIError(result.status.value, result.message)
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def get_runtime_info(self) -> RuntimeInfo:
        inspected = self._root.lifecycle.inspect()
        historical_asset_state = self._historical_asset_state()
        return RuntimeInfo(
            module_version=MODULE_VERSION, api_version=API_VERSION,
            schema_version=inspected.schema_version or SCHEMA_VERSION,
            database_state=self._root.database_state,
            database_location=self._root.database_path,
            historical_asset_state=historical_asset_state,
        )

    def health(self) -> HealthReport:
        state = self._root.database_state
        query_available = self._root.query is not None
        schema_compatible = state in {DatabaseState.READY, DatabaseState.OPEN, DatabaseState.CLOSED}
        operational = state is DatabaseState.OPEN and query_available
        if state in {DatabaseState.UNSUPPORTED_SCHEMA, DatabaseState.STORAGE_ERROR}:
            status = HealthStatus.UNHEALTHY
        elif operational:
            status = HealthStatus.HEALTHY
        else:
            status = HealthStatus.DEGRADED
        historical_asset_state = self._historical_asset_state()
        notes = [historical_asset_state]
        if state is DatabaseState.NOT_INITIALIZED:
            notes.append("INITIALIZATION_REQUIRED")
        elif state is DatabaseState.CLOSED:
            notes.append("DATABASE_CLOSED")
        elif operational:
            notes.append("CORE_APPLICATION_PATH_AVAILABLE")
        active_task_count = stale_lock_count = recovery_required_count = 0
        incomplete_package_count = qa_failure_count = 0
        import_authorization_state = "PRODUCTION_IMPORT_NOT_AUTHORIZED"
        deferred_legacy_count = 0
        asset_requirements_pending = asset_submissions_pending = 0
        visual_reviews_pending = asset_validation_failures = 0
        if self._root.store is not None:
            tasks = self._root.store.runtime.list_tasks()
            locks = self._root.store.runtime.list_active_locks()
            now = datetime.now(timezone.utc)
            active_task_count = sum(item.status.value in {"PENDING", "RUNNING", "BLOCKED", "FAILED"} for item in tasks)
            stale_lock_count = sum(item.is_stale(now) for item in locks)
            recovery_required_count = sum(item.status.value == "RUNNING" for item in tasks if any(
                lock.task_id == item.task_id and lock.is_stale(now) for lock in locks
            ))
            incomplete_package_count = sum(
                item.task_type is DurableTaskType.PACKAGE_BUILD and item.status.value != "SUCCEEDED"
                for item in tasks
            )
            qa_failure_count = sum(
                item.status is not QAReceiptStatus.PASS
                for item in self._root.store.runtime.list_qa_receipts()
            )
            production_metadata = self._root.store.production_import.get_store_metadata()
            import_authorization_state = production_metadata.get(
                "import_authorization_state", import_authorization_state,
            )
            deferred_legacy_count = int(production_metadata.get("deferred_import_count", 0))
            requirements = self._root.store.visual_assets.list_requirements()
            submissions = self._root.store.visual_assets.list_submissions()
            asset_requirements_pending = sum(item.status.value != "VERIFIED" for item in requirements)
            asset_submissions_pending = sum(item.status in {
                AssetSubmissionStatus.PENDING_HUMAN_VISUAL_REVIEW,
                AssetSubmissionStatus.ACTIVATED_PACKAGE_PENDING,
                AssetSubmissionStatus.RECOVERY_REQUIRED,
            } for item in submissions)
            visual_reviews_pending = sum(
                item.status is AssetSubmissionStatus.PENDING_HUMAN_VISUAL_REVIEW for item in submissions
            )
            asset_validation_failures = sum(
                item.status is AssetSubmissionStatus.VALIDATION_FAILED for item in submissions
            )
            if asset_requirements_pending:
                notes.append("BUSINESS_BLOCKED:MISSING_ASSET")
        return HealthReport(
            status=status, operational=operational, module_reachable=True,
            database_state=state, schema_compatible=schema_compatible,
            query_available=query_available, automatic_publishing="NONE",
            network_capability="NONE", historical_asset_state=historical_asset_state,
            notes=tuple(notes),
            task_runtime_status="READY" if self._root.runtime_service else "UNAVAILABLE",
            active_task_count=active_task_count, stale_lock_count=stale_lock_count,
            recovery_required_count=recovery_required_count,
            incomplete_package_count=incomplete_package_count,
            qa_failure_count=qa_failure_count,
            production_database_exists=DatabaseLocation.default_path().exists(),
            legacy_adapter_status="READY_READ_ONLY",
            import_authorization_state=import_authorization_state,
            deferred_legacy_count=deferred_legacy_count,
            asset_requirements_pending=asset_requirements_pending,
            asset_submissions_pending=asset_submissions_pending,
            visual_reviews_pending=visual_reviews_pending,
            asset_validation_failures=asset_validation_failures,
            business_state="BUSINESS_BLOCKED" if asset_requirements_pending else "READY",
        )

    # ---- Read API -----------------------------------------------------

    def get_dashboard(self, *, now: datetime) -> OperatorDashboard:
        return self._read(lambda: self._query().operator_dashboard(now=now))

    def get_work_queue(self, *, now: datetime) -> tuple[WorkItem, ...]:
        return self._read(lambda: self._query().derive_work_queue(now=now))

    def get_content_detail(self, content_id: str) -> ContentDetailDTO:
        detail = self._read(lambda: self._query().get_content_detail(content_id))
        return ContentDetailDTO(
            content=_content_dto(detail.content),
            accounts=tuple(_account_dto(item) for item in detail.accounts),
            assets=tuple(_asset_dto(item) for item in detail.assets),
            publish_records=tuple(_publish_dto(item) for item in detail.publish_records),
            metrics=tuple(_metrics_dto(item) for item in detail.metrics),
            reviews=tuple(_review_dto(item) for item in detail.reviews),
        )

    def list_content(self, *, state: str | None = None) -> tuple[ContentDTO, ...]:
        query = self._query()
        try:
            items = self._read(
                lambda: query.list_active_content()
                if state is None else query.list_content_by_state(ContentState(state))
            )
        except ValueError as exc:
            raise CreatorOpsAPIError(CommandStatus.VALIDATION_ERROR.value, "Unknown content state") from exc
        return tuple(_content_dto(item) for item in items)

    def list_accounts(self) -> tuple[AccountDTO, ...]:
        return self._read(lambda: tuple(_account_dto(item) for item in self._query().list_accounts()))

    def list_creators(self) -> tuple[CreatorDTO, ...]:
        return self._read(lambda: tuple(_creator_dto(item) for item in self._query().list_creators()))

    def get_account_workload(self, account_id: str, *, now: datetime) -> AccountWorkload:
        query = self._query()
        account, contents, publishes = self._read(lambda: query.get_account_workload_inputs(account_id))
        store = self._store()
        work_queue = self._read(lambda: query.derive_work_queue(now=now))
        return self._read(lambda: build_account_workload(
            (account,), contents, publishes, store.metrics.list(), store.reviews.list(), now=now,
            work_queue=work_queue,
        )[0])

    # ---- Local Works V0.1 -------------------------------------------

    def list_local_works(self, *, view: str = "recent", now: datetime | None = None) -> tuple[dict[str, Any], ...]:
        return self._read(lambda: tuple(
            self._works().work_payload(item) for item in self._works().list_works(view, now=now)
        ))

    def get_local_work(self, work_id: str) -> dict[str, Any]:
        return self._read(lambda: self._works().work_payload(self._works().get_work(work_id)))

    def intake_local_work_resources(self, resources: Sequence[Mapping[str, Any]]) -> tuple[dict[str, Any], ...]:
        return self._read(lambda: tuple(
            self._works().work_payload(item) for item in self._works().intake_resources(resources)
        ))

    def set_local_work_portfolio(self, work_id: str, *, included: bool) -> dict[str, Any]:
        return self._read(lambda: self._works().work_payload(self._works().set_portfolio(work_id, included)))

    def relocate_local_work_media(self, media_id: str, *, absolute_path: str) -> dict[str, Any]:
        return self._read(lambda: self._works().work_payload(self._works().relocate(media_id, absolute_path)))

    def get_local_works_capabilities(self) -> dict[str, Any]:
        works = self._works()
        return self._read(lambda: {
            "contract_version": "0.1", "copy_on_import": "NONE", "real_file_delete": "NONE",
            "portfolio_selection": "MANUAL_ONLY", "move_permission": works.move_permission,
            "boot_default_off": True, "managed_root": works.managed_root_status(),
            "potplayer": works.potplayer_status(),
        })

    def set_local_work_move_permission(self, *, enabled: bool) -> dict[str, Any]:
        return self._read(lambda: self._works().set_move_permission(enabled))

    def move_local_work_to_managed(self, work_id: str, *, explicit_user_intent: bool) -> dict[str, Any]:
        return self._read(lambda: self._works().work_payload(
            self._works().move_to_managed(work_id, explicit_user_intent=explicit_user_intent)
        ))

    def configure_local_work_potplayer(self, *, absolute_path: str) -> dict[str, Any]:
        return self._read(lambda: self._works().configure_potplayer(absolute_path))

    def open_local_work_original(self, media_id: str) -> dict[str, Any]:
        return self._read(lambda: self._works().open_original(media_id))

    def open_local_work_location(self, media_id: str) -> dict[str, Any]:
        return self._read(lambda: self._works().open_location(media_id))

    def open_local_work_potplayer(self, media_id: str) -> dict[str, Any]:
        return self._read(lambda: self._works().open_potplayer(media_id))

    def local_work_media_path(self, media_id: str) -> Path:
        return self._read(lambda: self._works().media_path(media_id))

    def local_work_thumbnail_path(self, media_id: str) -> Path:
        return self._read(lambda: self._works().thumbnail_path(media_id))

    def get_publishing_workbench(
        self, content_id: str, account_id: str, *, planned_time: datetime | None = None,
        publish_notes: str | None = None,
    ) -> ManualPublishingWorkbench:
        detail = self._read(lambda: self._query().get_content_detail(content_id))
        service = self._root.manual_workbench
        assert service is not None
        return self._read(lambda: service.build(
            detail.content, target_account_id=account_id,
            accounts=self._store().accounts.list(), assets=detail.assets,
            planned_time=planned_time, publish_notes=publish_notes,
        ))

    def get_metrics_workbench(self, content_id: str, publish_record_id: str) -> MetricsBackfillWorkbench:
        detail = self._read(lambda: self._query().get_content_detail(content_id))
        publish = self._read(lambda: self._store().publish_records.get_by_id(publish_record_id))
        service = self._root.metrics_workbench
        assert service is not None
        return self._read(lambda: service.build(
            detail.content, publish, self._query().latest_metric_snapshot(publish_record_id),
        ))

    def get_review_workbench(self, content_id: str, publish_record_id: str) -> ReviewWorkbench:
        detail = self._read(lambda: self._query().get_content_detail(content_id))
        publish = self._read(lambda: self._store().publish_records.get_by_id(publish_record_id))
        reviews = self._store().reviews.find_by_publish_record_id(publish_record_id)
        service = self._root.review_workbench
        assert service is not None
        return self._read(lambda: service.build(
            detail.content, publish, metrics=self._query().latest_metric_snapshot(publish_record_id),
            assets=detail.assets, existing_review=reviews[-1] if reviews else None,
        ))

    def get_activity(self) -> tuple[ActivityEvent, ...]:
        store = self._store()
        service = self._root.activity_view
        assert service is not None
        return self._read(lambda: service.derive(
            store.contents.list(), store.assets.list(), store.publish_records.list(),
            store.metrics.list(), store.reviews.list(),
        ))

    def get_audit_trail(self, *, content_id: str | None = None) -> tuple[AuditEvent, ...]:
        return self._read(lambda: self._store().runtime.list_audit(content_id))

    def run_production_workflow(self, request: Any, *, now: datetime):
        from creator_ops.application.production_workflow import CreatorOpsProductionWorkflow
        return self._read(lambda: CreatorOpsProductionWorkflow(self).run(request, now=now))

    def inspect_production_workflow(self, workflow_id: str, content_id: str):
        from creator_ops.application.production_workflow import CreatorOpsProductionWorkflow
        return self._read(lambda: CreatorOpsProductionWorkflow(self).inspect(workflow_id, content_id))

    def validate_legacy_package(
        self, package: dict[str, Any], *, source_reference: str,
        existing_paths: Sequence[str], risk_checklist: Sequence[dict[str, Any]] = (),
    ) -> tuple[ContentPackageManifest, PackageCompleteness, QAReport | None]:
        """Validate a detached package without reading or writing its source tree."""
        def operation():
            manifest = map_legacy_package_manifest(package, source_reference=source_reference)
            qa = QACompatibilityMapper.from_risk_checklist(
                manifest.content_id, risk_checklist, source_reference=source_reference,
            ) if risk_checklist else None
            completeness = evaluate_package_completeness(
                manifest, existing_paths=existing_paths, qa_reports=(qa,) if qa else (),
            )
            return manifest, completeness, qa
        return self._read(operation)

    def map_legacy_content_request(
        self, data: dict[str, Any], *, source_reference: str,
    ) -> ContentPackageRequest:
        return self._read(lambda: map_legacy_content_request(
            data, source_reference=source_reference,
        ))

    def plan_task_lock(self, lock: TaskLock | None, *, task_id: str, owner_id: str) -> LockPlan:
        return self._read(lambda: self._root.task_lock_planner.plan_acquire(
            lock, task_id=task_id, owner_id=owner_id,
        ))

    def plan_recovery(
        self, checkpoint: RecoveryCheckpoint, *, observed_hashes: dict[str, str | None],
        retry_policy: RetryPolicy | None = None,
    ) -> RecoveryPlan:
        return self._read(lambda: self._root.recovery_planner.plan(
            checkpoint, observed_hashes=observed_hashes, retry_policy=retry_policy,
        ))

    def map_legacy_case(
        self, data: dict[str, Any], *, source_reference: str,
        evidence_manifest_reference: str | None = None,
    ) -> LegacyCase:
        """Map a detached Case Library record; this never creates a Review."""
        return self._read(lambda: LegacyCaseLibraryMapper.map_case(
            data, source_reference=source_reference,
            evidence_manifest_reference=evidence_manifest_reference,
        ))

    def list_runtime_tasks(self) -> tuple[DurableTask, ...]:
        return self._read(lambda: self._store().runtime.list_tasks())

    def list_recovery_evidence(self, task_id: str | None = None) -> tuple[RecoveryEvidence, ...]:
        return self._read(lambda: self._store().runtime.list_recoveries(task_id))

    def list_qa_receipts(self, content_id: str, *, qa_type: str | None = None) -> tuple[QAReceipt, ...]:
        kind = QAType(qa_type) if qa_type else None
        return self._read(lambda: self._store().runtime.list_qa_receipts(
            content_id=content_id, qa_type=kind,
        ))

    def list_research(self, *, account_id: str | None = None) -> tuple[ResearchSession, ...]:
        return self._read(lambda: self._store().runtime.list_research(account_id))

    def create_research(
        self, *, research_id: str, topic: str, account_id: str,
        content_intent: str, now: datetime, source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        return self._command("create_research", lambda: self._research().create(
            research_id=research_id, topic=topic, account_id=account_id,
            content_intent=content_intent,
            provenance={"source": "local_research", "reference": source_reference}, now=now,
        ), entity_id=research_id)

    def add_research_source(
        self, research_id: str, *, source_id: str, source_type: str,
        reference: str, summary: str, evidence: Sequence[str], now: datetime,
    ) -> CommandResult:
        source = lambda: ResearchSource(
            source_id, ResearchSourceType(source_type), reference, summary, tuple(evidence),
        )
        return self._command("add_research_source", lambda: self._research().add_source(
            research_id, source(), now=now,
        ), entity_id=research_id)

    def synthesize_research(self, research_id: str, *, now: datetime) -> CommandResult:
        return self._command("synthesize_research", lambda: self._research().synthesize(
            research_id, now=now,
        ), entity_id=research_id)

    def plan_topics(
        self, research_id: str, *, operator_intent: str,
    ):
        def operation():
            store = self._store()
            research = store.runtime.get_research(research_id)
            account = store.accounts.get_by_id(research.account_id)
            return self._research().topic_planner.plan(
                account_id=account.account_id, account_direction=account.content_direction,
                research=research, existing_topics=tuple(item.topic for item in store.contents.list()),
                operator_intent=operator_intent,
            )
        return self._read(operation)

    def get_import_readiness_v0_2(self):
        """Re-evaluate the confirmed 006 records; always returns a zero-write plan."""
        return self._read(lambda: FinalImportPlannerV02().plan(
            RealLegacyAdapter(RealLegacyReader.confirmed_creator_ops()).build_reconciliation_records()
        ))

    def initialize_production_import_metadata(
        self, *, source_fingerprints: dict[str, str], now: datetime,
        production_store_confirmation: bool,
    ) -> CommandResult:
        if not production_store_confirmation:
            return CommandResult(
                "initialize_production_import_metadata", CommandStatus.CONFIRMATION_REQUIRED,
                error=PublicError("CONFIRMATION_REQUIRED", "Production store confirmation is required"),
            )
        return self._command(
            "initialize_production_import_metadata",
            lambda: self._production_import().initialize_production_store(
                source_fingerprints=source_fingerprints, now=now,
                schema_version=SCHEMA_VERSION, runtime_version=MODULE_VERSION,
                application_version=API_VERSION,
                source_reconciliation_version="FULL_SOURCE_RECONCILIATION_V0.2",
            ),
            entity_id="CREATOR_OPS_PRODUCTION_STORE",
        )

    def execute_safe_production_import(
        self, *, run_id: str, source_fingerprints: dict[str, str],
        production_import_confirmation: bool, now: datetime,
    ) -> CommandResult:
        if not production_import_confirmation:
            return CommandResult(
                "execute_safe_production_import", CommandStatus.CONFIRMATION_REQUIRED,
                entity_id=run_id,
                error=PublicError("CONFIRMATION_REQUIRED", "Production import confirmation is required"),
            )
        return self._command(
            "execute_safe_production_import",
            lambda: self._production_import().execute(
                run_id=run_id, source_fingerprints=source_fingerprints,
                production_import_confirmation=production_import_confirmation, now=now,
            ), entity_id=run_id,
        )

    def list_production_import_ledger(self, *, disposition: str | None = None):
        from creator_ops.application.production_import import ProductionImportDisposition
        value = ProductionImportDisposition(disposition) if disposition else None
        return self._read(lambda: self._store().production_import.list_entries(value))

    def list_production_import_receipts(self, *, run_id: str | None = None):
        return self._read(lambda: self._store().production_import.list_receipts(run_id))

    def list_canonical_activation_resolutions(self):
        return self._read(lambda: self._store().production_import.list_activation_resolutions())

    def get_canonical_activation_receipt(self, activation_id: str):
        return self._read(lambda: self._store().production_import.find_activation_receipt(activation_id))

    def activate_canonical_baseline(
        self, request: CanonicalActivationRequest, *, activation_confirmation: bool,
        now: datetime,
    ) -> CommandResult:
        if not activation_confirmation:
            return CommandResult(
                "activate_canonical_baseline", CommandStatus.CONFIRMATION_REQUIRED,
                entity_id=request.activation_id,
                error=PublicError("CONFIRMATION_REQUIRED", "Canonical activation confirmation is required"),
            )
        return self._command(
            "activate_canonical_baseline",
            lambda: self._canonical_activation().activate(
                request, confirmation=activation_confirmation, now=now,
            ), entity_id=request.activation_id,
        )

    def seal_canonical_production_baseline(
        self, *, activation_id: str, baseline_state: str,
        seal_confirmation: bool, now: datetime,
    ) -> CommandResult:
        if not seal_confirmation:
            return CommandResult(
                "seal_canonical_production_baseline", CommandStatus.CONFIRMATION_REQUIRED,
                entity_id=activation_id,
                error=PublicError("CONFIRMATION_REQUIRED", "Production baseline seal confirmation is required"),
            )
        return self._command(
            "seal_canonical_production_baseline",
            lambda: self._canonical_activation().seal_production_baseline(
                activation_id=activation_id, baseline_state=baseline_state,
                confirmation=seal_confirmation, now=now,
            ), entity_id=activation_id,
        )

    def get_production_store_metadata(self):
        return self._read(lambda: self._store().production_import.get_store_metadata())

    def create_first_production_baseline_backup(
        self, destination: str | Path, *, now: datetime,
    ) -> CommandResult:
        return self._command(
            "create_first_production_baseline_backup",
            lambda: self._production_import().create_first_production_backup(
                destination=destination, now=now,
            ), entity_id="FIRST_PRODUCTION_BASELINE_BACKUP",
        )

    def create_canonical_activation_baseline_backup(
        self, destination: str | Path, *, now: datetime,
    ) -> CommandResult:
        return self._command(
            "create_canonical_activation_baseline_backup",
            lambda: self._production_import().create_canonical_activation_backup(
                destination=destination, now=now,
            ), entity_id="CANONICAL_ACTIVATION_BASELINE_BACKUP",
        )

    def create_real_asset_pipeline_baseline_backup(
        self, destination: str | Path, *, now: datetime,
    ) -> CommandResult:
        return self._command(
            "create_real_asset_pipeline_baseline_backup",
            lambda: self._production_import().create_real_asset_pipeline_backup(
                destination=destination, now=now,
            ), entity_id="REAL_ASSET_PIPELINE_BASELINE_BACKUP",
        )

    def run_content_qa(self, content_id: str, *, now: datetime) -> CommandResult:
        return self._command("run_content_qa", lambda: self._qa().persist(
            FormalQARunner.content(self._store().contents.get_by_id(content_id), now=now)
        ), content_id=content_id)

    def build_local_package(
        self, content_id: str, *, account_id: str, package_id: str,
        target_root: str | Path, now: datetime,
        asset_candidate_counts: dict[str, int] | None = None,
    ) -> CommandResult:
        """Build a reference-first local package through the single public facade."""
        def operation():
            store = self._store()
            content = store.contents.get_by_id(content_id)
            if account_id not in content.target_accounts:
                raise ValueError("package account is not a target account")
            assets = store.assets.find_by_content_id(content_id)
            metadata = {
                "content_id": content.content_id, "creator_id": content.creator_id,
                "account": account_id, "topic": content.topic, "title": content.title,
                "content_type": content.content_type.value,
                "platform_intent": list(content.platform_intent),
                "asset_references": [item.location for item in assets],
                "content_state": content.current_state.value,
                "asset_inventory": {
                    "verified_canonical_assets": [
                        item.location for item in assets if item.status is AssetStatus.AVAILABLE
                    ],
                    "legacy_reference_only_assets": [
                        item.location for item in assets if item.status is AssetStatus.REFERENCE_ONLY
                    ],
                    "unverified_candidate_counts": dict(asset_candidate_counts or {}),
                    "missing_required_asset": not bool(assets),
                },
                "provenance": {
                    "source_system": content.provenance.source_system,
                    "source_reference": content.provenance.source_reference,
                },
            }
            files = (
                PackageFileInput(
                    "content_metadata", "metadata/content_metadata.json",
                    (json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"),
                    True, "application/json",
                ),
                PackageFileInput(
                    "script", "02_script/script.md",
                    self._package_script_bytes(content),
                    True, "text/markdown",
                ),
                PackageFileInput(
                    "publish_plan", "07_publish/publish_plan.md",
                    f"# Manual Publish Preparation\n\nAccount: {account_id}\n\nAutomatic publishing: NONE\n".encode("utf-8"),
                    True, "text/markdown",
                ),
            )
            request = PackageBuildRequest(
                package_id, content_id, account_id, files,
                tuple(item.location for item in assets),
                {"source": "CreatorOpsApplication", "content": content.provenance.source_reference},
                now, asset_inventory=metadata["asset_inventory"],
            )
            result = LocalPackageWriter(target_root).write(request)
            if result.status.value in {"FAILED", "CONFLICT"}:
                raise ValueError(result.message)
            self._store().runtime.save_audit(AuditEvent(
                f"audit:{package_id}:{result.status.value}", content_id, "CreatorOpsApplication",
                "PACKAGE_BUILD", now, result.status.value,
                evidence={"package_id": package_id, "target_path": str(result.target_path),
                          "package_digest": result.package_digest},
            ))
            return result
        return self._command("build_local_package", operation, entity_id=package_id, content_id=content_id)

    @staticmethod
    def _package_script_bytes(content: ContentItem) -> bytes:
        if content.body:
            return content.body.encode("utf-8")
        if content.source == "legacy_canonical_activation" and content.script_reference:
            return RealLegacyReader.confirmed_creator_ops().read_bytes(content.script_reference)
        return f"Script reference: {content.script_reference or ''}".encode("utf-8")

    def rollback_package_staging(
        self, *, package_id: str, target_root: str | Path, content_id: str,
        operator_confirmation: bool, now: datetime,
    ) -> CommandResult:
        """Delete only one named staging directory after explicit operator confirmation."""
        if not operator_confirmation:
            return CommandResult(
                "rollback_package_staging", CommandStatus.CONFIRMATION_REQUIRED,
                entity_id=package_id, content_id=content_id,
                error=PublicError("CONFIRMATION_REQUIRED", "Package staging rollback requires confirmation"),
            )

        def operation():
            removed = LocalPackageWriter(target_root).rollback_staging(package_id)
            self._store().runtime.save_audit(AuditEvent(
                f"audit:{package_id}:ROLLBACK_STAGING", content_id, "CreatorOpsApplication",
                "ROLLBACK_PACKAGE_STAGING", now, "REMOVED" if removed else "NOT_FOUND",
                evidence={"package_id": package_id, "target_root": str(Path(target_root)),
                          "operator_confirmation": True},
            ))
            return {"package_id": package_id, "removed": removed}

        return self._command(
            "rollback_package_staging", operation, entity_id=package_id, content_id=content_id,
        )

    def run_asset_qa(self, content_id: str, *, now: datetime) -> CommandResult:
        def operation():
            requirements = self._store().visual_assets.list_requirements(content_id)
            statuses = {item.requirement_id: item.status.value for item in requirements} if requirements else None
            return self._qa().persist(FormalQARunner.assets(
                self._store().contents.get_by_id(content_id),
                self._store().assets.find_by_content_id(content_id), now=now,
                requirement_statuses=statuses,
            ))
        return self._command("run_asset_qa", operation, content_id=content_id)

    def run_package_qa(
        self, content_id: str, *, package_id: str, manifest_path: str | Path, now: datetime,
    ) -> CommandResult:
        return self._command("run_package_qa", lambda: self._qa().persist(
            FormalQARunner.package(content_id, package_id, manifest_path, now=now)
        ), entity_id=package_id, content_id=content_id)

    def run_publish_prep_qa(
        self, content_id: str, *, package_id: str, now: datetime,
    ) -> CommandResult:
        def operation():
            store = self._store()
            content = store.contents.get_by_id(content_id)
            receipts = store.runtime.list_qa_receipts(content_id=content_id)
            prerequisites = [
                next((item for item in reversed(receipts)
                      if item.qa_type is kind and item.package_id in {None, package_id}), None)
                for kind in (QAType.CONTENT, QAType.ASSET, QAType.PACKAGE, QAType.VISUAL)
            ]
            if store.visual_assets.list_requirements(content_id):
                prerequisites[-1] = next((
                    item for item in reversed(receipts) if item.qa_type is QAType.VISUAL
                ), None)
            else:
                prerequisites = prerequisites[:3]
            return self._qa().persist(FormalQARunner.publish_prep(
                content, store.accounts.list(), store.assets.find_by_content_id(content_id),
                tuple(item for item in prerequisites if item is not None),
                package_id=package_id, now=now,
            ))
        return self._command("run_publish_prep_qa", operation, entity_id=package_id, content_id=content_id)

    def run_visual_qa(
        self, content_id: str, *, package_id: str | None,
        operator_checks: Sequence[dict[str, Any]], now: datetime,
    ) -> CommandResult:
        return self._command("run_visual_qa", lambda: self._qa().persist(
            FormalQARunner.visual(
                content_id, package_id=package_id, operator_checks=operator_checks, now=now,
            )
        ), entity_id=package_id, content_id=content_id)

    def create_runtime_task(
        self, *, task_id: str, content_id: str, task_type: str,
        idempotency_key: str, now: datetime,
        source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        return self._command("create_runtime_task", lambda: self._runtime().create_task(
            task_id=task_id, content_id=content_id, task_type=DurableTaskType(task_type),
            idempotency_key=idempotency_key,
            provenance={"source": "local_runtime", "reference": source_reference}, now=now,
        ), entity_id=task_id, content_id=content_id)

    def acquire_runtime_task(self, task_id: str, *, owner: str, now: datetime) -> CommandResult:
        return self._command("acquire_runtime_task", lambda: self._runtime().acquire(
            task_id, owner=owner, now=now,
        ), entity_id=task_id)

    def heartbeat_runtime_task(
        self, task_id: str, *, owner: str, fencing_token: int, now: datetime,
    ) -> CommandResult:
        return self._command("heartbeat_runtime_task", lambda: self._runtime().heartbeat(
            task_id, owner=owner, fencing_token=fencing_token, now=now,
        ), entity_id=task_id)

    def release_runtime_task(
        self, task_id: str, *, owner: str, fencing_token: int, now: datetime,
    ) -> CommandResult:
        return self._command("release_runtime_task", lambda: self._runtime().release(
            task_id, owner=owner, fencing_token=fencing_token, now=now,
        ), entity_id=task_id)

    def complete_runtime_task(
        self, task_id: str, *, owner: str, fencing_token: int, now: datetime,
    ) -> CommandResult:
        return self._command("complete_runtime_task", lambda: self._runtime().complete(
            task_id, owner=owner, fencing_token=fencing_token, now=now,
        ), entity_id=task_id)

    def fail_runtime_task(
        self, task_id: str, *, owner: str, fencing_token: int,
        error: str, retryable: bool, now: datetime,
    ) -> CommandResult:
        return self._command("fail_runtime_task", lambda: self._runtime().fail(
            task_id, owner=owner, fencing_token=fencing_token, error=error,
            retryable=retryable, now=now,
        ), entity_id=task_id)

    def recover_runtime(self, *, now: datetime) -> CommandResult:
        return self._command("recover_runtime", lambda: self._runtime().recover_stale(now=now))

    # ---- Command API --------------------------------------------------

    def create_creator(
        self, *, creator_id: str, name: str, now: datetime, source: str = "local_manual",
        source_reference: str = "creator_ops_api", status: str = "ACTIVE",
    ) -> CommandResult:
        return self._command("create_creator", lambda: self._service().create_creator(
            creator_id=creator_id, name=name, status=CreatorStatus(status), source=source,
            provenance=_provenance(source, source_reference, now), now=now,
        ), entity_id=creator_id)

    def create_account(
        self, *, account_id: str, creator_id: str, platform: str, account_name: str,
        display_name: str, content_direction: str, now: datetime,
        legacy_account_code: str | None = None, status: str = "ACTIVE",
        source: str = "local_manual", source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        return self._command("create_account", lambda: self._service().create_account(
            account_id=account_id, creator_id=creator_id,
            legacy_account_code=legacy_account_code, platform=platform,
            account_name=account_name, display_name=display_name,
            content_direction=content_direction, status=AccountStatus(status),
            source=source, provenance=_provenance(source, source_reference, now), now=now,
        ), entity_id=account_id)

    def create_idea(
        self, *, content_id: str, creator_id: str, target_accounts: Sequence[str],
        topic: str, content_type: str, platform_intent: Sequence[str], now: datetime,
        source: str = "local_manual", source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        return self._command("create_idea", lambda: self._service().create_idea(
            content_id=content_id, creator_id=creator_id, target_accounts=target_accounts,
            topic=topic, content_type=ContentType(content_type), platform_intent=platform_intent,
            provenance=_provenance(source, source_reference, now), source=source, now=now,
        ), entity_id=content_id, content_id=content_id)

    def start_draft(
        self, content_id: str, *, title: str | None, body: str | None,
        script_reference: str | None, now: datetime,
    ) -> CommandResult:
        return self._content_command("start_draft", content_id, lambda: self._service().start_draft(
            content_id, title=title, body=body, script_reference=script_reference, now=now,
        ))

    def attach_asset(
        self, content_id: str, *, asset_id: str, asset_type: str, location: str,
        now: datetime, account_relations: Sequence[str] = (), creator_id: str | None = None,
        generation_method: str = "HUMAN_CREATED", status: str = "AVAILABLE",
        source: str = "local_manual", source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        return self._content_command("attach_asset", content_id, lambda: self._service().attach_asset(
            content_id, asset_id=asset_id, asset_type=AssetType(asset_type), source=source,
            location=location, provenance=_provenance(source, source_reference, now),
            generation_method=GenerationMethod(generation_method), creator_id=creator_id,
            account_relations=account_relations, status=AssetStatus(status), now=now,
        ), entity_id=asset_id)

    def complete_draft(self, content_id: str, *, now: datetime) -> CommandResult:
        return self._content_command(
            "complete_draft", content_id,
            lambda: self._service().complete_draft(content_id, now=now),
        )

    def get_real_review_workbench(
        self, content_id: str, *, package_id: str, manifest_path: str | Path,
    ):
        return self._read(lambda: RealReviewWorkbenchService(self._store()).build(
            content_id, package_id=package_id, manifest_path=manifest_path,
        ))

    def freeze_authoritative_visual_asset_requirements(self, *, now: datetime) -> CommandResult:
        """Persist the reconciled A2/B3 contracts; this does not create an Asset."""
        def operation():
            packets = build_authoritative_visual_packets(
                now=now, workspace_root=Path(__file__).resolve().parents[3] / "runtime" / "asset-intake",
            )
            service = self._visual_assets()
            service.freeze_requirements(tuple(
                requirement for packet in packets for requirement in packet.requirements
            ))
            return packets
        return self._command(
            "freeze_authoritative_visual_asset_requirements", operation,
            entity_id="CREATOR_OPS_VISUAL_ASSET_PIPELINE_V0_1",
        )

    def get_asset_requirements(self, content_id: str) -> tuple[AssetRequirement, ...]:
        return self._read(lambda: self._visual_assets().get_requirements(content_id))

    def get_visual_production_packet(self, content_id: str) -> VisualProductionPacket:
        def operation():
            now = datetime.now(timezone.utc)
            packets = build_authoritative_visual_packets(
                now=now, workspace_root=Path(__file__).resolve().parents[3] / "runtime" / "asset-intake",
            )
            packet = next((item for item in packets if item.content_id == content_id), None)
            if packet is None:
                raise ValueError("no authoritative visual production packet for content")
            persisted = self._visual_assets().get_requirements(content_id)
            if not persisted:
                raise ValueError("visual Asset Requirements are not frozen")
            return type(packet)(
                packet.content_id, packet.account_id, packet.summary, persisted,
                packet.specification, packet.handoffs, packet.intake_directory,
                packet.status, packet.version,
            )
        return self._read(operation)

    def submit_asset(
        self, content_id: str, requirement_id: str, asset_path: str | Path, *, now: datetime,
    ) -> CommandResult:
        def operation():
            requirement = self._store().visual_assets.get_requirement(requirement_id)
            if requirement.content_id != content_id:
                raise ValueError("requirement does not belong to content")
            return self._visual_assets().submit_asset(requirement_id, asset_path, now=now)
        return self._command(
            "submit_asset", operation, entity_id=requirement_id, content_id=content_id,
        )

    def get_asset_intake_status(self, content_id: str) -> AssetIntakeStatus:
        return self._read(lambda: self._visual_assets().get_intake_status(content_id))

    def list_asset_submissions(
        self, content_id: str | None = None,
    ) -> tuple[AssetIntakeSubmission, ...]:
        return self._read(
            lambda: self._store().visual_assets.list_submissions(content_id=content_id),
        )

    def list_visual_review_records(
        self, content_id: str | None = None,
    ) -> tuple[VisualReviewRecord, ...]:
        return self._read(
            lambda: self._store().visual_assets.list_reviews(content_id=content_id),
        )

    def get_visual_review_workbench(self, submission_id: str) -> VisualReviewWorkbench:
        return self._read(lambda: self._visual_assets().get_review_workbench(submission_id))

    def review_visual_asset(
        self, submission_id: str, *, decision: str, operator_checks: Mapping[str, str],
        notes: str | None, human_confirmation: bool, now: datetime,
    ) -> CommandResult:
        return self._command(
            "review_visual_asset",
            lambda: self._visual_assets().review_submission(
                submission_id, decision=VisualReviewDecision(decision),
                operator_checks=operator_checks, notes=notes,
                human_confirmation=human_confirmation, now=now,
            ), entity_id=submission_id,
        )

    def mark_visual_asset_package_complete(
        self, submission_id: str, *, now: datetime,
    ) -> CommandResult:
        return self._command(
            "mark_visual_asset_package_complete",
            lambda: self._visual_assets().mark_package_complete(submission_id, now=now),
            entity_id=submission_id,
        )

    def continue_visual_asset_pipeline(
        self, submission_id: str, *, package_id: str, target_root: str | Path,
        now: datetime,
    ) -> CommandResult:
        """Rebuild package and QA after human-approved canonical activation.

        Failures leave the durable submission at ACTIVATED_PACKAGE_PENDING so the
        same command can be retried without inventing a second workflow state.
        Editorial review remains a separate human-controlled gate.
        """
        submission = self._read(lambda: self._store().visual_assets.get_submission(submission_id))
        if submission.status not in {
            AssetSubmissionStatus.ACTIVATED_PACKAGE_PENDING,
            AssetSubmissionStatus.ACTIVATED,
        }:
            return CommandResult(
                "continue_visual_asset_pipeline", CommandStatus.REJECTED,
                entity_id=submission_id, content_id=submission.content_id,
                error=PublicError("VISUAL_ASSET_NOT_ACTIVATED", "Human-approved canonical asset is required"),
            )
        requirement = self._read(
            lambda: self._store().visual_assets.get_requirement(submission.requirement_id)
        )
        requirements = self._read(
            lambda: self._store().visual_assets.list_requirements(submission.content_id)
        )
        missing = tuple(
            item.requirement_id for item in requirements
            if item.required and item.status.value != "VERIFIED"
        )
        if missing:
            return CommandResult(
                "continue_visual_asset_pipeline", CommandStatus.REJECTED,
                entity_id=submission_id, content_id=submission.content_id,
                warnings=missing,
                error=PublicError(
                    "ASSET_REQUIREMENTS_INCOMPLETE",
                    "All required visual assets must be human-approved before package rebuild",
                ),
                data={"stage": "REQUIREMENT_GATE", "missing_requirement_ids": missing},
            )
        build = self.build_local_package(
            submission.content_id, account_id=requirement.account_id, package_id=package_id,
            target_root=target_root, now=now,
        )
        if build.status is not CommandStatus.SUCCESS:
            return CommandResult(
                "continue_visual_asset_pipeline", build.status, entity_id=submission_id,
                content_id=submission.content_id, error=build.error,
                data={"stage": "PACKAGE_BUILD", "submission_status": submission.status.value},
            )
        manifest_path = build.data.manifest_path
        results = {
            "content_qa": self.run_content_qa(submission.content_id, now=now),
            "asset_qa": self.run_asset_qa(submission.content_id, now=now),
            "package_qa": self.run_package_qa(
                submission.content_id, package_id=package_id, manifest_path=manifest_path, now=now,
            ),
        }
        results["publish_prep_qa"] = self.run_publish_prep_qa(
            submission.content_id, package_id=package_id, now=now,
        )
        hard_failures = tuple(
            name for name in ("content_qa", "asset_qa", "package_qa")
            if results[name].status is not CommandStatus.SUCCESS or results[name].data.status.value != "PASS"
        )
        if hard_failures:
            return CommandResult(
                "continue_visual_asset_pipeline", CommandStatus.REJECTED,
                entity_id=submission_id, content_id=submission.content_id,
                warnings=hard_failures,
                error=PublicError("QA_GATE_NOT_PASSED", "Package remains retryable pending required QA"),
                data={"stage": "QA", "submission_status": submission.status.value, "results": results},
            )
        completed = self.mark_visual_asset_package_complete(submission_id, now=now)
        return CommandResult(
            "continue_visual_asset_pipeline", CommandStatus.SUCCESS,
            entity_id=submission_id, content_id=submission.content_id,
            warnings=("EDITORIAL_REVIEW_STILL_REQUIRED",) if results["publish_prep_qa"].data.status.value != "PASS" else (),
            data={
                "submission": completed.data, "package": build.data, "qa": results,
                "next_gate": "EDITORIAL_REVIEW" if results["publish_prep_qa"].data.status.value != "PASS" else "PUBLISH_PREP_COMPLETE",
            },
        )

    def recover_visual_asset_intake(self, *, now: datetime) -> CommandResult:
        return self._command(
            "recover_visual_asset_intake", lambda: self._visual_assets().recover(now=now),
            entity_id="CREATOR_OPS_VISUAL_ASSET_PIPELINE_V0_1",
        )

    def activate_verified_asset(
        self, candidate: RealAssetCandidate, *, now: datetime,
    ) -> CommandResult:
        return self._command(
            "activate_verified_asset",
            lambda: VerifiedAssetActivationService(self._store()).activate(candidate, now=now),
            entity_id=candidate.asset_candidate_id, content_id=candidate.legacy_content_id,
        )

    def submit_for_review(self, content_id: str, *, now: datetime) -> CommandResult:
        return self._content_command("submit_for_review", content_id, lambda: self._service().submit_for_review(content_id, now=now))

    def approve_review(self, content_id: str, *, now: datetime) -> CommandResult:
        return self._content_command("approve_review", content_id, lambda: self._service().approve_review(content_id, now=now))

    def reject_review(self, content_id: str, *, now: datetime) -> CommandResult:
        return self._content_command("reject_review", content_id, lambda: self._service().reject_review(content_id, now=now))

    def mark_ready_to_publish(self, content_id: str, *, now: datetime) -> CommandResult:
        try:
            latest = self._store().runtime.list_qa_receipts(
                content_id=content_id, qa_type=QAType.PUBLISH_PREP,
            )
        except Exception as exc:
            status, message = _translate_error(exc)
            return CommandResult("mark_ready_to_publish", status, content_id=content_id,
                                 error=PublicError(status.value, message))
        if not latest or latest[-1].status is not QAReceiptStatus.PASS:
            return CommandResult(
                "mark_ready_to_publish", CommandStatus.REJECTED, content_id=content_id,
                error=PublicError("QA_GATE_NOT_PASSED", "Latest publish-prep QA must pass"),
            )
        return self._content_command("mark_ready_to_publish", content_id, lambda: self._service().mark_ready_to_publish(content_id, now=now))

    def confirm_manual_publish(
        self, content_id: str, account_id: str, *, actual_publish_time: datetime,
        manual_confirmation: bool, now: datetime, external_url: str | None = None,
        external_post_id: str | None = None, source: str = "manual_confirmation",
        source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        if not manual_confirmation:
            return CommandResult(
                "confirm_manual_publish", CommandStatus.CONFIRMATION_REQUIRED,
                content_id=content_id, error=PublicError(
                    CommandStatus.CONFIRMATION_REQUIRED.value,
                    "manual_confirmation=True is required",
                ),
            )
        def operation():
            return self._service().record_manual_publish(
                content_id=content_id, account_id=account_id,
                actual_publish_time=actual_publish_time, external_url=external_url,
                external_post_id=external_post_id, manual_confirmation=True,
                provenance=_provenance(source, source_reference, now), now=now,
            )
        result = self._command("confirm_manual_publish", operation, content_id=content_id)
        if result.status is not CommandStatus.SUCCESS:
            return result
        raw = result.data
        return CommandResult(
            result.command, result.status,
            entity_id=raw.pipeline_result.publish_record.publish_record_id,
            content_id=content_id,
            updated_state=raw.pipeline_result.content.current_state.value,
            warnings=result.warnings,
            data=_publish_dto(raw.pipeline_result.publish_record),
        )

    def record_metrics(
        self, content_id: str, publish_record_id: str, *, metrics_id: str,
        collected_at: datetime, now: datetime, views: int | None = None,
        impressions: int | None = None, likes: int | None = None,
        comments: int | None = None, favorites: int | None = None,
        shares: int | None = None, followers_delta: int | None = None,
        engagement: float | None = None, input_mode: str = "MANUAL",
        source: str = "manual_metrics", source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        def operation():
            return self._service().record_metrics(
                content_id=content_id, publish_record_id=publish_record_id,
                metrics_id=metrics_id, views=views, impressions=impressions, likes=likes,
                comments=comments, favorites=favorites, shares=shares,
                followers_delta=followers_delta, engagement=engagement,
                collected_at=collected_at, input_mode=MetricsInputMode(input_mode),
                provenance=_provenance(source, source_reference, now), now=now,
            )
        result = self._command("record_metrics", operation, entity_id=metrics_id, content_id=content_id)
        if result.status is not CommandStatus.SUCCESS:
            return result
        raw = result.data
        return CommandResult(
            result.command, result.status, entity_id=metrics_id, content_id=content_id,
            updated_state=raw.content.current_state.value, data=_metrics_dto(raw.metrics),
        )

    def complete_review(
        self, content_id: str, publish_record_id: str, metrics_id: str, *,
        review_id: str, strengths: Sequence[str], weaknesses: Sequence[str],
        reusable_patterns: Sequence[str], failed_patterns: Sequence[str],
        next_action: str | None, evidence: Sequence[str], now: datetime,
        source: str = "manual_review", source_reference: str = "creator_ops_api",
    ) -> CommandResult:
        def operation():
            return self._service().complete_review(
                content_id=content_id, publish_record_id=publish_record_id,
                metrics_id=metrics_id, review_id=review_id, strengths=strengths,
                weaknesses=weaknesses, reusable_patterns=reusable_patterns,
                failed_patterns=failed_patterns, next_action=next_action,
                evidence=evidence, provenance=_provenance(source, source_reference, now), now=now,
            )
        result = self._command("complete_review", operation, entity_id=review_id, content_id=content_id)
        if result.status is not CommandStatus.SUCCESS:
            return result
        raw = result.data
        return CommandResult(
            result.command, result.status, entity_id=review_id, content_id=content_id,
            updated_state=raw.content.current_state.value, data=_review_dto(raw.review),
        )

    def update_work_item_overlay(
        self, *, work_item_id: str, content_id: str, status: str,
        due_at: datetime | None, blocked_reason: str | None,
        operator_notes: str | None, now: datetime,
    ) -> CommandResult:
        overlay = lambda: WorkItemOverlay(
            work_item_id=work_item_id, content_id=content_id,
            status=WorkItemStatus(status), due_at=due_at,
            blocked_reason=blocked_reason, operator_notes=operator_notes,
            updated_at=now,
        )
        def operation():
            value = overlay()
            self._service().save_work_item_overlay(value)
            return value
        return self._command("update_work_item_overlay", operation, entity_id=work_item_id, content_id=content_id)

    def create_local_backup(self, destination: str | Path) -> CommandResult:
        if self._root.database_state is DatabaseState.NOT_INITIALIZED:
            return CommandResult(
                "create_local_backup", CommandStatus.STORAGE_ERROR,
                error=PublicError("NOT_INITIALIZED", "Local store is not initialized"),
            )
        return self._command(
            "create_local_backup", lambda: self._store().create_local_backup(destination),
            entity_id=str(destination),
        )

    # ---- Boundary helpers --------------------------------------------

    @staticmethod
    def _read(operation: Callable[[], Any]) -> Any:
        try:
            return operation()
        except CreatorOpsAPIError:
            raise
        except WorksError as exc:
            raise CreatorOpsAPIError(exc.code, str(exc)) from None
        except Exception as exc:
            status, message = _translate_error(exc)
            raise CreatorOpsAPIError(status.value, message) from None

    def _query(self):
        if self._root.query is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops local store is not open")
        return self._root.query

    def _store(self):
        if self._root.store is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops local store is not open")
        return self._root.store

    def _service(self):
        if self._root.application_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops local store is not open")
        return self._root.application_service

    def _runtime(self):
        if self._root.runtime_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops local store is not open")
        return self._root.runtime_service

    def _qa(self):
        if self._root.qa_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops QA runtime is not open")
        return self._root.qa_service

    def _research(self):
        if self._root.research_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops research runtime is not open")
        return self._root.research_service

    def _works(self) -> LocalWorksService:
        if self._root.works_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops Works runtime is not open")
        return self._root.works_service

    def _production_import(self):
        if self._root.production_import_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops production import runtime is not open")
        return self._root.production_import_service

    def _canonical_activation(self):
        if self._root.canonical_activation_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops canonical activation runtime is not open")
        return self._root.canonical_activation_service

    def _visual_assets(self):
        if self._root.visual_asset_service is None:
            raise CreatorOpsAPIError("DATABASE_NOT_OPEN", "Creator Ops visual asset runtime is not open")
        return self._root.visual_asset_service

    def _historical_asset_state(self) -> str:
        if self._root.store is None:
            return HISTORICAL_ASSET_STATE
        metadata = self._root.store.production_import.get_store_metadata()
        state = metadata.get("import_authorization_state")
        if state == "SAFE_PRODUCTION_IMPORT_COMPLETE_WITH_DEFERRED":
            return "LEGACY_SOURCE_RECONCILED_SAFE_IMPORT_COMPLETE_WITH_DEFERRED"
        if state == "CANONICAL_ACTIVATION_COMPLETE_WITH_PRESERVED_INVALID":
            return "LEGACY_CANONICAL_ACTIVATION_COMPLETE_WITH_PRESERVED_INVALID"
        if state == "AUTHORIZED_FOR_SAFE_PRODUCTION_IMPORT":
            return "LEGACY_SOURCE_RECONCILED_SAFE_IMPORT_AUTHORIZED"
        return HISTORICAL_ASSET_STATE

    def _content_command(
        self, command: str, content_id: str, operation: Callable[[], ContentItem],
        *, entity_id: str | None = None,
    ) -> CommandResult:
        result = self._command(command, operation, entity_id=entity_id or content_id, content_id=content_id)
        if result.status is not CommandStatus.SUCCESS:
            return result
        content = result.data
        return CommandResult(
            command, CommandStatus.SUCCESS, entity_id=entity_id or content_id,
            content_id=content_id, updated_state=content.current_state,
            data=content,
        )

    def _command(
        self, command: str, operation: Callable[[], Any], *,
        entity_id: str | None = None, content_id: str | None = None,
    ) -> CommandResult:
        try:
            value = operation()
            updated_state = value.current_state.value if isinstance(value, ContentItem) else None
            data = _public_value(value)
            return CommandResult(
                command, CommandStatus.SUCCESS, entity_id=entity_id,
                content_id=content_id, updated_state=updated_state, data=data,
            )
        except CreatorOpsAPIError as exc:
            return CommandResult(
                command, CommandStatus.STORAGE_ERROR, entity_id=entity_id,
                content_id=content_id, error=PublicError(exc.code, str(exc)),
            )
        except Exception as exc:
            status, message = _translate_error(exc)
            return CommandResult(
                command, status, entity_id=entity_id, content_id=content_id,
                error=PublicError(status.value, message),
            )


def create_creator_ops_application(database_path: str | Path | None = None) -> CreatorOpsApplication:
    try:
        return create_composition_root(database_path).build_application()
    except PersistenceError as exc:
        raise CreatorOpsAPIError(CommandStatus.VALIDATION_ERROR.value, str(exc)) from exc


def _provenance(source: str, reference: str, now: datetime) -> Provenance:
    return Provenance(source, reference, now, captured_by="CreatorOpsApplication")


def _translate_error(exc: Exception) -> tuple[CommandStatus, str]:
    current: Exception | None = exc
    while isinstance(current, PersistenceError) and current.code is PersistenceErrorCode.TRANSACTION_FAILED:
        current = current.cause
    if isinstance(current, PersistenceError):
        mapping = {
            PersistenceErrorCode.NOT_FOUND: CommandStatus.NOT_FOUND,
            PersistenceErrorCode.CONFLICT: CommandStatus.CONFLICT,
            PersistenceErrorCode.VALIDATION_ERROR: CommandStatus.VALIDATION_ERROR,
            PersistenceErrorCode.SCHEMA_VERSION_UNSUPPORTED: CommandStatus.STORAGE_ERROR,
            PersistenceErrorCode.STORAGE_ERROR: CommandStatus.STORAGE_ERROR,
            PersistenceErrorCode.TRANSACTION_FAILED: CommandStatus.STORAGE_ERROR,
        }
        return mapping[current.code], str(current)
    if isinstance(current, PipelineError):
        return CommandStatus.REJECTED, str(current)
    if isinstance(current, WorksError):
        return CommandStatus.REJECTED, str(current)
    if isinstance(current, (ContractError, ValueError, TypeError)):
        return CommandStatus.VALIDATION_ERROR, str(current)
    return CommandStatus.STORAGE_ERROR, "Creator Ops command could not be completed"


def _creator_dto(item: Creator) -> CreatorDTO:
    return CreatorDTO(
        item.creator_id, item.name, item.status.value, item.source, item.version,
        _provenance_dto(item.provenance), item.created_at, item.updated_at,
    )


def _account_dto(item: Account) -> AccountDTO:
    return AccountDTO(
        item.account_id, item.creator_id, item.legacy_account_code, item.platform,
        item.account_name, item.display_name, item.content_direction,
        item.status.value, item.source, item.version,
        _provenance_dto(item.provenance), item.created_at, item.updated_at,
    )


def _content_dto(item: ContentItem) -> ContentDTO:
    return ContentDTO(
        item.content_id, item.creator_id, item.target_accounts, item.topic,
        item.title, item.body, item.script_reference, item.content_type.value,
        item.platform_intent, item.asset_references, item.current_state.value,
        item.review_state.value, item.publish_readiness.value, item.source, item.version,
        _provenance_dto(item.provenance), item.created_at, item.updated_at,
    )


def _asset_dto(item: Asset) -> AssetDTO:
    return AssetDTO(
        item.asset_id, item.asset_type.value, item.source, item.location,
        item.content_relations, item.account_relations, item.generation_method.value,
        item.status.value, item.version,
        _provenance_dto(item.provenance), item.created_at, item.updated_at,
    )


def _provenance_dto(item: Provenance) -> ProvenanceDTO:
    return ProvenanceDTO(
        item.source_system, item.source_reference, item.captured_at,
        item.captured_by, item.confidence, item.notes, item.version,
    )


def _publish_dto(item: PublishRecord) -> PublishRecordDTO:
    return PublishRecordDTO(
        item.publish_record_id, item.platform, item.account_id, item.content_id,
        item.publish_status.value, item.actual_publish_time, item.external_url,
        item.external_post_id, item.manual_confirmation,
        item.publication_mode.value, item.version,
    )


def _metrics_dto(item: Metrics) -> MetricsDTO:
    return MetricsDTO(
        item.metrics_id, item.publish_record_id, item.views, item.impressions,
        item.likes, item.comments, item.favorites, item.shares,
        item.followers_delta, item.engagement, item.collected_at, item.version,
    )


def _review_dto(item: Review) -> ReviewDTO:
    return ReviewDTO(
        item.review_id, item.content_id, item.publish_record_id, item.strengths,
        item.weaknesses, item.reusable_patterns, item.failed_patterns,
        item.next_action, item.evidence, item.status.value, item.version,
    )


def _public_value(value: Any) -> Any:
    if isinstance(value, Creator):
        return _creator_dto(value)
    if isinstance(value, Account):
        return _account_dto(value)
    if isinstance(value, ContentItem):
        return _content_dto(value)
    if isinstance(value, Asset):
        return _asset_dto(value)
    if isinstance(value, PublishRecord):
        return _publish_dto(value)
    if isinstance(value, Metrics):
        return _metrics_dto(value)
    if isinstance(value, Review):
        return _review_dto(value)
    return value
