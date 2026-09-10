"""Single application-layer local production orchestration over authoritative APIs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Sequence

from creator_ops.api.contracts import CommandStatus


class ProductionStep(str, Enum):
    RESEARCH = "RESEARCH"
    DRAFT = "DRAFT"
    ASSET_PREP = "ASSET_PREP"
    PACKAGE_BUILD = "PACKAGE_BUILD"
    QA = "QA"
    REVIEW = "REVIEW"
    PUBLISH_PREP = "PUBLISH_PREP"
    COMPLETE = "COMPLETE"


@dataclass(frozen=True)
class ProductionAssetInput:
    asset_id: str
    asset_type: str
    location: str


@dataclass(frozen=True)
class ProductionWorkflowRequest:
    workflow_id: str
    content_id: str
    creator_id: str
    account_id: str
    research_id: str
    topic: str
    content_intent: str
    research_source_id: str
    research_source_type: str
    research_reference: str
    research_summary: str
    research_evidence: tuple[str, ...]
    title: str
    body: str
    content_type: str
    platform_intent: tuple[str, ...]
    assets: tuple[ProductionAssetInput, ...]
    package_id: str
    package_root: Path
    operator_id: str


@dataclass(frozen=True)
class ProductionWorkflowResult:
    workflow_id: str
    content_id: str
    step: ProductionStep
    completed_steps: tuple[ProductionStep, ...]
    next_action: str
    blocker: str | None
    package_path: Path | None
    manual_workbench_ready: bool
    automatic_publishing: str = "NONE"
    version: str = "0.2"


class CreatorOpsProductionWorkflow:
    """Coordinates existing APIs; contains no alternate domain state machine."""

    TASKS = {
        ProductionStep.RESEARCH: "RESEARCH",
        ProductionStep.DRAFT: "DRAFT",
        ProductionStep.ASSET_PREP: "ASSET_PREP",
        ProductionStep.PACKAGE_BUILD: "PACKAGE_BUILD",
        ProductionStep.QA: "QA",
        ProductionStep.REVIEW: "REVIEW",
        ProductionStep.PUBLISH_PREP: "PUBLISH_PREP",
    }

    def __init__(self, application: Any) -> None:
        self.app = application

    def run(self, request: ProductionWorkflowRequest, *, now: datetime) -> ProductionWorkflowResult:
        completed: list[ProductionStep] = []
        package_path: Path | None = None
        for step, operation in (
            (ProductionStep.RESEARCH, lambda: self._research(request, now)),
            (ProductionStep.DRAFT, lambda: self._draft(request, now)),
            (ProductionStep.ASSET_PREP, lambda: self._assets(request, now)),
            (ProductionStep.PACKAGE_BUILD, lambda: self._package(request, now)),
            (ProductionStep.QA, lambda: self._qa(request, now)),
            (ProductionStep.REVIEW, lambda: self._review(request, now)),
            (ProductionStep.PUBLISH_PREP, lambda: self._publish_prep(request, now)),
        ):
            task_id = f"{request.workflow_id}:{step.value}"
            created = self.app.create_runtime_task(
                task_id=task_id, content_id=request.content_id, task_type=self.TASKS[step],
                idempotency_key=task_id, now=now, source_reference=request.workflow_id,
            )
            if created.status is not CommandStatus.SUCCESS:
                return self._blocked(request, step, completed, created.error.message, package_path)
            task = created.data
            if task.status.value == "SUCCEEDED":
                completed.append(step)
                if step is ProductionStep.PACKAGE_BUILD:
                    package_path = request.package_root / request.account_id / request.content_id
                continue
            acquired = self.app.acquire_runtime_task(task.task_id, owner=request.operator_id, now=now)
            if acquired.status is not CommandStatus.SUCCESS:
                return self._blocked(request, step, completed, acquired.error.message, package_path)
            token = acquired.data.fencing_token
            try:
                value = operation()
                if isinstance(value, tuple) and not all(item.status is CommandStatus.SUCCESS for item in value):
                    failure = next(item for item in value if item.status is not CommandStatus.SUCCESS)
                    raise ValueError(failure.error.message if failure.error else failure.status.value)
                if hasattr(value, "status") and value.status is not CommandStatus.SUCCESS:
                    raise ValueError(value.error.message if value.error else value.status.value)
                if step is ProductionStep.PACKAGE_BUILD:
                    package_path = value.data.target_path
                completed_task = self.app.complete_runtime_task(
                    task.task_id, owner=request.operator_id, fencing_token=token, now=now,
                )
                if completed_task.status is not CommandStatus.SUCCESS:
                    raise ValueError("unable to commit durable task completion")
                completed.append(step)
            except Exception as exc:
                self.app.fail_runtime_task(
                    task.task_id, owner=request.operator_id, fencing_token=token,
                    error=str(exc), retryable=True, now=now,
                )
                return self._blocked(request, step, completed, str(exc), package_path)
        workbench = self.app.get_publishing_workbench(request.content_id, request.account_id)
        return ProductionWorkflowResult(
            request.workflow_id, request.content_id, ProductionStep.COMPLETE, tuple(completed),
            "MANUAL_PUBLISH", None, package_path, workbench.ready,
        )

    def inspect(self, workflow_id: str, content_id: str) -> ProductionWorkflowResult:
        tasks = {item.task_id: item for item in self.app.list_runtime_tasks()
                 if item.task_id.startswith(f"{workflow_id}:")}
        completed = tuple(step for step in self.TASKS
                          if tasks.get(f"{workflow_id}:{step.value}") and
                          tasks[f"{workflow_id}:{step.value}"].status.value == "SUCCEEDED")
        current = next((step for step in self.TASKS if step not in completed), ProductionStep.COMPLETE)
        blocker_task = next((item for item in tasks.values()
                             if item.status.value in {"BLOCKED", "FAILED", "TERMINAL_FAILURE"}), None)
        return ProductionWorkflowResult(
            workflow_id, content_id, current, completed,
            "RESUME" if current is not ProductionStep.COMPLETE else "MANUAL_PUBLISH",
            blocker_task.last_error if blocker_task else None, None,
            current is ProductionStep.COMPLETE,
        )

    def _research(self, request: ProductionWorkflowRequest, now: datetime):
        results = [self.app.create_research(
            research_id=request.research_id, topic=request.topic, account_id=request.account_id,
            content_intent=request.content_intent, now=now, source_reference=request.workflow_id,
        )]
        results.append(self.app.add_research_source(
            request.research_id, source_id=request.research_source_id,
            source_type=request.research_source_type, reference=request.research_reference,
            summary=request.research_summary, evidence=request.research_evidence, now=now,
        ))
        results.append(self.app.synthesize_research(request.research_id, now=now))
        return tuple(results)

    def _draft(self, request: ProductionWorkflowRequest, now: datetime):
        try:
            self.app.get_content_detail(request.content_id)
        except Exception:
            idea = self.app.create_idea(
                content_id=request.content_id, creator_id=request.creator_id,
                target_accounts=(request.account_id,), topic=request.topic,
                content_type=request.content_type, platform_intent=request.platform_intent, now=now,
                source="production_workflow", source_reference=request.workflow_id,
            )
            if idea.status is not CommandStatus.SUCCESS:
                return idea
        detail = self.app.get_content_detail(request.content_id)
        if detail.content.current_state == "IDEA":
            return self.app.start_draft(
                request.content_id, title=request.title, body=request.body,
                script_reference=None, now=now,
            )
        return _success("draft_already_present")

    def _assets(self, request: ProductionWorkflowRequest, now: datetime):
        existing = {item.asset_id for item in self.app.get_content_detail(request.content_id).assets}
        results = []
        for asset in request.assets:
            if asset.asset_id in existing:
                continue
            results.append(self.app.attach_asset(
                request.content_id, asset_id=asset.asset_id, asset_type=asset.asset_type,
                location=asset.location, account_relations=(request.account_id,),
                creator_id=request.creator_id, now=now, source="production_workflow",
                source_reference=request.workflow_id,
            ))
        return tuple(results) or (_success("assets_already_present"),)

    def _package(self, request: ProductionWorkflowRequest, now: datetime):
        return self.app.build_local_package(
            request.content_id, account_id=request.account_id, package_id=request.package_id,
            target_root=request.package_root, now=now,
        )

    def _qa(self, request: ProductionWorkflowRequest, now: datetime):
        manifest = request.package_root / request.account_id / request.content_id / "metadata/package_manifest.json"
        return (
            self.app.run_content_qa(request.content_id, now=now),
            self.app.run_asset_qa(request.content_id, now=now),
            self.app.run_package_qa(
                request.content_id, package_id=request.package_id, manifest_path=manifest, now=now,
            ),
        )

    def _review(self, request: ProductionWorkflowRequest, now: datetime):
        state = self.app.get_content_detail(request.content_id).content.current_state
        results = []
        if state == "ASSET_PREPARATION":
            results.append(self.app.submit_for_review(request.content_id, now=now))
            state = "REVIEW"
        detail = self.app.get_content_detail(request.content_id)
        if state == "REVIEW" and detail.content.review_state != "APPROVED":
            results.append(self.app.approve_review(request.content_id, now=now))
        return tuple(results) or (_success("review_already_approved"),)

    def _publish_prep(self, request: ProductionWorkflowRequest, now: datetime):
        qa = self.app.run_publish_prep_qa(
            request.content_id, package_id=request.package_id, now=now,
        )
        if qa.status is not CommandStatus.SUCCESS or not qa.data.passed:
            return qa
        return self.app.mark_ready_to_publish(request.content_id, now=now)

    @staticmethod
    def _blocked(request, step, completed, blocker, package_path):
        return ProductionWorkflowResult(
            request.workflow_id, request.content_id, step, tuple(completed),
            "RESOLVE_BLOCKER_AND_RESUME", blocker, package_path, False,
        )


@dataclass(frozen=True)
class _LocalSuccess:
    status: CommandStatus = CommandStatus.SUCCESS


def _success(_: str) -> _LocalSuccess:
    return _LocalSuccess()
