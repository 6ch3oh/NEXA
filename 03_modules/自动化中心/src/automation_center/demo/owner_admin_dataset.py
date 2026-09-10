"""Deterministic NONPROD OWNER Admin demo Request Ledger generator."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from automation_center.adapters.request_ledger import SQLiteRequestLedger
from automation_center.domain.customer_request import (
    ActorType,
    CustomerRequestRecord,
    CustomerRequestStatus,
    KnowledgeReviewState,
    OWNER_IDENTITY,
    RequestInputType,
    RequestResultStatus,
)
from automation_center.domain.model_gateway import UserTier
from automation_center.domain.model_invocation import (
    CostSource,
    InvocationStatus,
    ModelErrorCategory,
    ModelInvocationRecord,
    UsageAvailability,
)


DEMO_CUSTOMER_COUNT = 120
DEMO_REQUESTS_PER_CUSTOMER = 10
DEMO_OWNER_REQUEST_COUNT = 12


def build_nonprod_owner_admin_dataset(
    path: str | Path,
    *,
    now: datetime | None = None,
) -> Path:
    """Create one fresh demo ledger; existing files are never overwritten."""

    target = Path(path)
    if "nonprod-demo" not in target.name.lower():
        raise ValueError("demo ledger filename must contain 'nonprod-demo'")
    if target.exists():
        raise FileExistsError("demo ledger already exists; refusing to overwrite")
    anchor = now or datetime.now(timezone.utc)
    if anchor.tzinfo is None or anchor.utcoffset() is None:
        raise ValueError("demo anchor must be timezone-aware")
    anchor = anchor.astimezone(timezone.utc)

    with SQLiteRequestLedger(target) as ledger:
        sequence = 0
        for customer_number in range(1, DEMO_CUSTOMER_COUNT + 1):
            customer_id = f"customer-demo-{customer_number:03d}"
            tier = (UserTier.FREE, UserTier.BASIC, UserTier.PRO, UserTier.PREMIUM)[
                customer_number % 4
            ]
            for customer_request_number in range(DEMO_REQUESTS_PER_CUSTOMER):
                sequence += 1
                created_at = (
                    anchor - timedelta(minutes=sequence % 30)
                    if sequence <= 50
                    else anchor - timedelta(
                        days=sequence % 42,
                        hours=sequence % 17,
                        minutes=sequence % 53,
                    )
                )
                item = _request(
                    request_id=f"demo-request-{sequence:05d}",
                    customer_id=customer_id,
                    tier=tier,
                    created_at=created_at,
                    sequence=sequence,
                )
                ledger.create_request(item)
                for invocation in _invocations(item, sequence):
                    ledger.link_invocation(invocation)

        for owner_number in range(1, DEMO_OWNER_REQUEST_COUNT + 1):
            sequence += 1
            created_at = anchor - timedelta(minutes=owner_number * 2)
            item = _request(
                request_id=f"demo-owner-request-{owner_number:03d}",
                customer_id=OWNER_IDENTITY,
                tier=UserTier.OWNER,
                created_at=created_at,
                sequence=sequence,
                actor=ActorType.OWNER,
            )
            ledger.create_request(item)
            for invocation in _invocations(item, sequence):
                ledger.link_invocation(invocation)
    return target


def _request(
    *,
    request_id: str,
    customer_id: str,
    tier: UserTier,
    created_at: datetime,
    sequence: int,
    actor: ActorType = ActorType.CUSTOMER,
) -> CustomerRequestRecord:
    capabilities = ("knowledge.collect", "report.compose", "content.summarize")
    item = CustomerRequestRecord.new(
        request_id=request_id,
        actor_type=actor,
        customer_id=customer_id,
        user_tier=tier,
        capability_id=capabilities[sequence % len(capabilities)],
        input_type=RequestInputType.REFERENCE,
        input_summary=(
            "NONPROD demo metadata; referenced input is intentionally not loaded"
            if sequence % 31 == 0
            else f"NONPROD demo request metadata {sequence:05d}"
        ),
        input_ref=(
            f"demo-large-input:logical-only:{sequence:05d}"
            if sequence % 31 == 0
            else f"demo-input:{sequence:05d}"
        ),
        source_url=f"https://demo.invalid/source/{sequence:05d}",
        created_at=created_at,
    )
    status = _status(sequence)
    if status in {CustomerRequestStatus.REJECTED, CustomerRequestStatus.CANCELLED}:
        item = item.transition(status, at=created_at + timedelta(seconds=1))
    else:
        item = item.transition(CustomerRequestStatus.VALIDATING, at=created_at + timedelta(seconds=1))
        item = item.transition(CustomerRequestStatus.ACCEPTED, at=created_at + timedelta(seconds=2))
        if status is not CustomerRequestStatus.ACCEPTED:
            item = item.transition(CustomerRequestStatus.RUNNING, at=created_at + timedelta(seconds=3))
        if status not in {CustomerRequestStatus.ACCEPTED, CustomerRequestStatus.RUNNING}:
            item = item.transition(status, at=created_at + timedelta(seconds=5))

    if status in {
        CustomerRequestStatus.SUCCEEDED,
        CustomerRequestStatus.PARTIAL_SUCCESS,
        CustomerRequestStatus.FAILED,
    }:
        result_status = {
            CustomerRequestStatus.SUCCEEDED: RequestResultStatus.AVAILABLE,
            CustomerRequestStatus.PARTIAL_SUCCESS: RequestResultStatus.PARTIAL,
            CustomerRequestStatus.FAILED: RequestResultStatus.FAILED,
        }[status]
        item = item.with_result(
            result_status=result_status,
            result_summary=f"NONPROD demo result reference for {request_id}",
            result_ref=f"demo-result:{request_id}",
            artifact_refs=(f"demo-artifact:{request_id}",),
            markdown_ref=(
                f"demo-markdown:{request_id}"
                if status is not CustomerRequestStatus.FAILED
                else None
            ),
            at=created_at + timedelta(seconds=6),
        )
    if actor is ActorType.CUSTOMER and sequence % 7 == 0:
        item = item.with_review_state(
            KnowledgeReviewState.PENDING_REVIEW,
            at=created_at + timedelta(seconds=7),
        )
    return item


def _status(sequence: int) -> CustomerRequestStatus:
    if sequence % 19 == 0:
        return CustomerRequestStatus.RUNNING
    if sequence % 17 == 0:
        return CustomerRequestStatus.REJECTED
    if sequence % 13 == 0:
        return CustomerRequestStatus.PARTIAL_SUCCESS
    if sequence % 11 == 0:
        return CustomerRequestStatus.FAILED
    return CustomerRequestStatus.SUCCEEDED


def _invocations(
    item: CustomerRequestRecord, sequence: int
) -> tuple[ModelInvocationRecord, ...]:
    if item.status is CustomerRequestStatus.REJECTED:
        return ()
    models = (
        ("openai", "gpt-4.1-mini"),
        ("anthropic", "claude-sonnet-demo"),
        ("google", "gemini-flash-demo"),
    )
    provider, model = models[sequence % len(models)]
    if sequence % 40 == 0:
        costs = ((0.012, "USD"), (0.08, "CNY"))
    elif sequence % 25 == 0:
        costs = ((0.018, "USD"), (None, None))
    elif sequence % 23 == 0:
        costs = ((None, None),)
    else:
        costs = (((sequence % 9 + 1) / 1000, "USD"),)
    values = []
    for invocation_number, (cost, currency) in enumerate(costs, start=1):
        failed = item.status is CustomerRequestStatus.FAILED and invocation_number == len(costs)
        started = item.created_at + timedelta(seconds=10 + invocation_number)
        values.append(
            ModelInvocationRecord(
                request_id=item.request_id,
                customer_id=item.customer_id,
                user_tier=item.user_tier,
                capability_id=item.capability_id,
                workflow_id=None,
                execution_id=None,
                model_profile=f"demo.{item.user_tier.value.lower()}",
                requested_alias=f"demo/{model}",
                resolved_provider=provider,
                resolved_model=model,
                status=InvocationStatus.ERROR if failed else InvocationStatus.SUCCESS,
                started_at=started,
                completed_at=started + timedelta(milliseconds=240 + sequence % 700),
                latency_ms=240 + sequence % 700,
                usage_availability=UsageAvailability.COMPLETE,
                input_tokens=80 + sequence % 300,
                output_tokens=20 + sequence % 120,
                total_tokens=100 + (sequence % 300) + (sequence % 120),
                cost_amount=cost,
                cost_currency=currency,
                cost_source=(
                    CostSource.LITELLM_CALCULATED
                    if cost is not None
                    else CostSource.UNAVAILABLE
                ),
                provider_request_id=f"demo-provider-request-{sequence:05d}-{invocation_number}",
                provider_response_id=f"demo-provider-response-{sequence:05d}-{invocation_number}",
                result_type="MODEL_COMPLETION",
                result_summary="NONPROD demo invocation projection",
                artifact_ref=None,
                error_category=ModelErrorCategory.TIMEOUT if failed else None,
                error_code="DEMO_TIMEOUT" if failed else None,
                retryable=True if failed else None,
                safe_message="Demo provider timed out safely" if failed else None,
                provider_status_code=504 if failed else None,
                provider_error_id=f"demo-error-{sequence:05d}" if failed else None,
            )
        )
    return tuple(values)
