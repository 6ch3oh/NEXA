"""Read-only SQLite projections for OWNER operations views."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable, Mapping

from automation_center.adapters.request_ledger import RequestNotFoundError
from automation_center.domain.customer_request import (
    ActorType,
    CustomerRequestStatus,
    KnowledgeReviewState,
    RequestInputType,
    RequestResultStatus,
)
from automation_center.domain.model_gateway import UserTier
from automation_center.domain.model_invocation import CostSource, InvocationStatus
from automation_center.domain.owner_read import (
    CostCompleteness,
    CurrencySubtotal,
    CustomerActivityFilter,
    OwnerActivityKind,
    OwnerCostSummary,
    OwnerCustomerDetail,
    OwnerCustomerFilters,
    OwnerCustomerListItem,
    OwnerCustomerPage,
    OwnerInvocationReadItem,
    OwnerKnowledgeReviewCounts,
    OwnerKnowledgeReviewPage,
    OwnerKnowledgeReviewProjection,
    OwnerKnowledgeReviewQueueItem,
    OwnerModelUsageItem,
    OwnerOperationsOverview,
    OwnerRecentActivity,
    OwnerRequestCounts,
    OwnerRequestDetail,
    OwnerRequestFilters,
    OwnerRequestListItem,
    OwnerRequestPage,
    OwnerRequestSort,
    OwnerTierUsageItem,
    OwnerTimeWindow,
    OwnerTokenSummary,
    page_info,
    validate_page,
)


class SQLiteOwnerReadRepository:
    """Queries the existing ledger in SQLite read-only mode; creates no cache or data."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).resolve()
        if not self.path.is_file():
            raise FileNotFoundError("Request Ledger SQLite file does not exist")
        self._connection = sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA query_only = ON")

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> "SQLiteOwnerReadRepository":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.close()

    def get_overview(
        self, window: OwnerTimeWindow, *, recent_limit: int
    ) -> OwnerOperationsOverview:
        validate_page(recent_limit, 0)
        request_row = self._connection.execute(
            """SELECT
                COUNT(*) AS total_requests,
                COUNT(DISTINCT CASE WHEN actor_type='CUSTOMER' THEN customer_id END)
                    AS unique_customer_count,
                SUM(CASE WHEN actor_type='OWNER' THEN 1 ELSE 0 END) AS owner_request_count,
                SUM(CASE WHEN actor_type='CUSTOMER' THEN 1 ELSE 0 END) AS customer_request_count,
                SUM(CASE WHEN status='SUCCEEDED' THEN 1 ELSE 0 END) AS succeeded,
                SUM(CASE WHEN status='PARTIAL_SUCCESS' THEN 1 ELSE 0 END) AS partial_success,
                SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS running,
                SUM(CASE WHEN knowledge_review_state='NOT_REVIEWED' THEN 1 ELSE 0 END)
                    AS not_reviewed,
                SUM(CASE WHEN knowledge_review_state='PENDING_REVIEW' THEN 1 ELSE 0 END)
                    AS pending_review,
                SUM(CASE WHEN knowledge_review_state='ACCEPTED' THEN 1 ELSE 0 END)
                    AS review_accepted,
                SUM(CASE WHEN knowledge_review_state='REJECTED' THEN 1 ELSE 0 END)
                    AS review_rejected
            FROM customer_requests WHERE created_at>=? AND created_at<?""",
            (_iso(window.from_at), _iso(window.to_at)),
        ).fetchone()
        invocation_row = self._connection.execute(
            """SELECT COUNT(*) AS invocation_count,
                COALESCE(SUM(input_tokens), 0) AS input_tokens_known,
                COALESCE(SUM(output_tokens), 0) AS output_tokens_known,
                COALESCE(SUM(total_tokens), 0) AS total_tokens_known,
                SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL
                    OR total_tokens IS NULL THEN 1 ELSE 0 END) AS token_unknown_count,
                COUNT(cost_amount) AS known_cost_count,
                COUNT(*) - COUNT(cost_amount) AS unknown_cost_count
            FROM request_invocations WHERE created_at>=? AND created_at<?""",
            (_iso(window.from_at), _iso(window.to_at)),
        ).fetchone()
        subtotals = self._currency_subtotals(
            "request_invocations", "created_at>=? AND created_at<?",
            (_iso(window.from_at), _iso(window.to_at)),
        )
        recent = self.list_requests(
            OwnerRequestFilters(window=window),
            sort=OwnerRequestSort.NEWEST_FIRST,
            limit=recent_limit,
            offset=0,
        ).items
        return OwnerOperationsOverview(
            window=window,
            unique_customer_count=_int(request_row["unique_customer_count"]),
            owner_request_count=_int(request_row["owner_request_count"]),
            customer_request_count=_int(request_row["customer_request_count"]),
            request_counts=OwnerRequestCounts(
                _int(request_row["total_requests"]),
                _int(request_row["succeeded"]),
                _int(request_row["partial_success"]),
                _int(request_row["failed"]),
                _int(request_row["rejected"]),
                _int(request_row["running"]),
            ),
            invocation_count=_int(invocation_row["invocation_count"]),
            token_summary=OwnerTokenSummary(
                _int(invocation_row["input_tokens_known"]),
                _int(invocation_row["output_tokens_known"]),
                _int(invocation_row["total_tokens_known"]),
                _int(invocation_row["token_unknown_count"]),
            ),
            cost_summary=_cost_summary(
                _int(invocation_row["known_cost_count"]),
                _int(invocation_row["unknown_cost_count"]),
                subtotals,
            ),
            knowledge_review=OwnerKnowledgeReviewCounts(
                _int(request_row["not_reviewed"]),
                _int(request_row["pending_review"]),
                _int(request_row["review_accepted"]),
                _int(request_row["review_rejected"]),
            ),
            recent_requests=recent,
        )

    def list_customers(
        self,
        filters: OwnerCustomerFilters,
        *,
        limit: int,
        offset: int,
        active_since: datetime,
    ) -> OwnerCustomerPage:
        limit, offset = validate_page(limit, offset)
        predicates: list[str] = []
        args: list[Any] = []
        if filters.customer_id_search:
            predicates.append("instr(customer_id, ?) > 0")
            args.append(filters.customer_id_search)
        if filters.user_tier is not None:
            predicates.append("current_tier=?")
            args.append(filters.user_tier.value)
        if filters.activity is CustomerActivityFilter.ACTIVE:
            predicates.append("last_seen_at>=?")
            args.append(_iso(active_since))
        elif filters.activity is CustomerActivityFilter.INACTIVE:
            predicates.append("last_seen_at<?")
            args.append(_iso(active_since))
        where = " AND ".join(predicates) if predicates else "1=1"
        cte = self._customer_rollup_cte()
        rows = self._connection.execute(
            cte
            + f""" SELECT * FROM customer_rollup WHERE {where}
                ORDER BY last_seen_at DESC, customer_id
                LIMIT ? OFFSET ?""",
            tuple(args) + (limit + 1, offset),
        ).fetchall()
        selected = rows[:limit]
        customer_ids = tuple(row["customer_id"] for row in selected)
        currency_map = self._customer_currency_subtotals(customer_ids)
        items = tuple(
            self._customer_item(row, currency_map.get(row["customer_id"], ()), active_since)
            for row in selected
        )
        return OwnerCustomerPage(items, page_info(limit, offset, len(rows)), active_since)

    def get_customer(
        self, customer_id: str, *, request_limit: int, request_offset: int
    ) -> OwnerCustomerDetail:
        request_limit, request_offset = validate_page(request_limit, request_offset)
        row = self._connection.execute(
            self._customer_rollup_cte() + " SELECT * FROM customer_rollup WHERE customer_id=?",
            (customer_id,),
        ).fetchone()
        if row is None:
            raise RequestNotFoundError("customer was not found")
        currency = self._customer_currency_subtotals((customer_id,)).get(customer_id, ())
        recent = self.list_requests(
            OwnerRequestFilters(actor_type=ActorType.CUSTOMER, customer_id=customer_id),
            sort=OwnerRequestSort.NEWEST_FIRST,
            limit=request_limit,
            offset=request_offset,
        )
        return OwnerCustomerDetail(
            customer_id=customer_id,
            current_observed_tier=UserTier(row["current_tier"]),
            first_seen_at=_datetime(row["first_seen_at"]),
            last_seen_at=_datetime(row["last_seen_at"]),
            total_requests=_int(row["request_count"]),
            succeeded=_int(row["success_count"]),
            failed=_int(row["failed_count"]),
            invocation_count=_int(row["invocation_count"]),
            token_summary=OwnerTokenSummary(
                _int(row["input_tokens_known"]),
                _int(row["output_tokens_known"]),
                _int(row["known_token_total"]),
                _int(row["token_unknown_count"]),
            ),
            cost_summary=_cost_summary(
                _int(row["known_cost_count"]), _int(row["unknown_cost_count"]), currency
            ),
            pending_review_count=_int(row["pending_review_count"]),
            recent_requests=recent,
        )

    def list_requests(
        self,
        filters: OwnerRequestFilters,
        *,
        sort: OwnerRequestSort,
        limit: int,
        offset: int,
    ) -> OwnerRequestPage:
        limit, offset = validate_page(limit, offset)
        predicates, args = self._request_predicates(filters)
        direction = "DESC" if sort is OwnerRequestSort.NEWEST_FIRST else "ASC"
        rows = self._connection.execute(
            f"""SELECT r.*,
                COUNT(i.invocation_id) AS invocation_count,
                COALESCE(SUM(i.input_tokens),0) AS input_tokens_known,
                COALESCE(SUM(i.output_tokens),0) AS output_tokens_known,
                COALESCE(SUM(i.total_tokens),0) AS total_tokens_known,
                SUM(CASE WHEN i.invocation_id IS NOT NULL AND
                    (i.input_tokens IS NULL OR i.output_tokens IS NULL
                    OR i.total_tokens IS NULL) THEN 1 ELSE 0 END) AS token_unknown_count,
                COUNT(i.cost_amount) AS known_cost_count,
                COUNT(i.invocation_id)-COUNT(i.cost_amount) AS unknown_cost_count
            FROM customer_requests r
            LEFT JOIN request_invocations i ON i.request_id=r.request_id
            WHERE {' AND '.join(predicates)}
            GROUP BY r.request_id
            ORDER BY r.created_at {direction}, r.request_id {direction}
            LIMIT ? OFFSET ?""",
            tuple(args) + (limit + 1, offset),
        ).fetchall()
        selected = rows[:limit]
        request_ids = tuple(row["request_id"] for row in selected)
        models, providers = self._request_model_summaries(request_ids)
        currencies = self._request_currency_subtotals(request_ids)
        items = tuple(
            self._request_list_item(
                row,
                models.get(row["request_id"], ()),
                providers.get(row["request_id"], ()),
                currencies.get(row["request_id"], ()),
            )
            for row in selected
        )
        return OwnerRequestPage(items, page_info(limit, offset, len(rows)))

    def get_request(self, request_id: str) -> OwnerRequestDetail:
        row = self._connection.execute(
            "SELECT * FROM customer_requests WHERE request_id=?", (request_id,)
        ).fetchone()
        if row is None:
            raise RequestNotFoundError("customer request was not found")
        invocation_rows = self._connection.execute(
            """SELECT i.*, o.payload_json FROM request_invocations i
            LEFT JOIN usage_outbox o ON o.invocation_id=i.invocation_id
            WHERE i.request_id=? ORDER BY i.created_at, i.invocation_id LIMIT 501""",
            (request_id,),
        ).fetchall()
        invocations = tuple(self._invocation_item(item) for item in invocation_rows[:500])
        invocation_total = self._connection.execute(
            "SELECT COUNT(*) AS amount FROM request_invocations WHERE request_id=?", (request_id,)
        ).fetchone()["amount"]
        artifact_rows = self._connection.execute(
            "SELECT artifact_ref FROM request_artifacts WHERE request_id=? ORDER BY artifact_ref LIMIT 501",
            (request_id,),
        ).fetchall()
        artifacts = tuple(item["artifact_ref"] for item in artifact_rows[:500])
        state = KnowledgeReviewState(row["knowledge_review_state"])
        actions = (
            ("REQUEST_OWNER_REVIEW",)
            if state in {KnowledgeReviewState.NOT_REVIEWED, KnowledgeReviewState.PENDING_REVIEW}
            else ("VIEW_REVIEW_DECISION",)
        )
        return OwnerRequestDetail(
            request_id=request_id,
            actor_type=ActorType(row["actor_type"]),
            customer_id=row["customer_id"],
            user_tier=UserTier(row["user_tier"]),
            capability_id=row["capability_id"],
            status=CustomerRequestStatus(row["status"]),
            created_at=_datetime(row["created_at"]),
            started_at=_datetime_optional(row["started_at"]),
            completed_at=_datetime_optional(row["completed_at"]),
            updated_at=_datetime(row["updated_at"]),
            input_type=RequestInputType(row["input_type"]),
            input_summary=row["input_summary"],
            source_url=row["source_url"],
            input_ref=row["input_ref"],
            invocations=invocations,
            invocation_count=_int(invocation_total),
            invocations_truncated=_int(invocation_total) > len(invocations),
            cost_summary=self._request_cost_summary(request_id),
            result_status=RequestResultStatus(row["result_status"]),
            result_summary=row["result_summary"],
            result_ref=row["result_ref"],
            markdown_ref=row["markdown_ref"],
            artifact_refs=artifacts,
            artifact_refs_truncated=len(artifact_rows) > 500,
            knowledge_review=OwnerKnowledgeReviewProjection(
                state, row["knowledge_destination_ref"], actions, False
            ),
        )

    def list_knowledge_review_queue(
        self, *, limit: int, offset: int
    ) -> OwnerKnowledgeReviewPage:
        limit, offset = validate_page(limit, offset)
        rows = self._connection.execute(
            """SELECT * FROM customer_requests
            WHERE actor_type='CUSTOMER'
              AND knowledge_review_state IN ('NOT_REVIEWED','PENDING_REVIEW')
            ORDER BY created_at DESC, request_id LIMIT ? OFFSET ?""",
            (limit + 1, offset),
        ).fetchall()
        selected = rows[:limit]
        request_ids = tuple(row["request_id"] for row in selected)
        models, _ = self._request_model_summaries(request_ids)
        items = tuple(
            OwnerKnowledgeReviewQueueItem(
                request_id=row["request_id"],
                customer_id=row["customer_id"],
                user_tier=UserTier(row["user_tier"]),
                input_summary=row["input_summary"],
                result_summary=row["result_summary"],
                resolved_models=models.get(row["request_id"], ()),
                created_at=_datetime(row["created_at"]),
                result_ref=row["result_ref"],
                markdown_ref=row["markdown_ref"],
                review_state=KnowledgeReviewState(row["knowledge_review_state"]),
            )
            for row in selected
        )
        return OwnerKnowledgeReviewPage(items, page_info(limit, offset, len(rows)))

    def get_model_usage(
        self,
        *,
        window: OwnerTimeWindow | None,
        user_tier: UserTier | None,
        limit: int,
    ) -> tuple[OwnerModelUsageItem, ...]:
        limit, _ = validate_page(limit, 0)
        predicates = ["1=1"]
        args: list[Any] = []
        if window is not None:
            predicates.append("i.created_at>=? AND i.created_at<?")
            args.extend((_iso(window.from_at), _iso(window.to_at)))
        if user_tier is not None:
            predicates.append("r.user_tier=?")
            args.append(user_tier.value)
        where = " AND ".join(predicates)
        rows = self._connection.execute(
            f"""SELECT i.resolved_provider, i.resolved_model,
                COUNT(DISTINCT i.request_id) AS request_count,
                COUNT(*) AS invocation_count,
                COALESCE(SUM(i.total_tokens),0) AS known_tokens,
                COUNT(i.cost_amount) AS known_cost_count,
                COUNT(*)-COUNT(i.cost_amount) AS unknown_cost_count,
                SUM(CASE WHEN i.invocation_status='ERROR' THEN 1 ELSE 0 END) AS failure_count,
                AVG(i.latency_ms) AS average_latency_ms,
                COUNT(i.latency_ms) AS latency_sample_count,
                MAX(i.created_at) AS last_used_at
            FROM request_invocations i JOIN customer_requests r ON r.request_id=i.request_id
            WHERE {where}
            GROUP BY i.resolved_provider, i.resolved_model
            ORDER BY invocation_count DESC, last_used_at DESC,
                     i.resolved_provider, i.resolved_model LIMIT ?""",
            tuple(args) + (limit,),
        ).fetchall()
        currency_map = self._model_currency_subtotals(where, tuple(args))
        return tuple(
            OwnerModelUsageItem(
                provider=row["resolved_provider"],
                model=row["resolved_model"],
                request_count=_int(row["request_count"]),
                invocation_count=_int(row["invocation_count"]),
                known_tokens=_int(row["known_tokens"]),
                cost_summary=_cost_summary(
                    _int(row["known_cost_count"]),
                    _int(row["unknown_cost_count"]),
                    currency_map.get((row["resolved_provider"], row["resolved_model"]), ()),
                ),
                failure_count=_int(row["failure_count"]),
                average_latency_ms=(
                    float(row["average_latency_ms"])
                    if row["average_latency_ms"] is not None
                    else None
                ),
                latency_sample_count=_int(row["latency_sample_count"]),
                last_used_at=_datetime(row["last_used_at"]),
            )
            for row in rows
        )

    def get_tier_usage(
        self, *, window: OwnerTimeWindow | None
    ) -> tuple[OwnerTierUsageItem, ...]:
        request_where, request_args = "1=1", []
        invocation_where, invocation_args = "1=1", []
        if window is not None:
            request_where = "created_at>=? AND created_at<?"
            request_args = [_iso(window.from_at), _iso(window.to_at)]
            invocation_where = "i.created_at>=? AND i.created_at<?"
            invocation_args = [_iso(window.from_at), _iso(window.to_at)]
        request_rows = self._connection.execute(
            f"""SELECT user_tier, COUNT(*) AS requests,
                COUNT(DISTINCT customer_id) AS unique_users,
                SUM(CASE WHEN status='SUCCEEDED' THEN 1 ELSE 0 END) AS succeeded,
                SUM(CASE WHEN status IN ('SUCCEEDED','PARTIAL_SUCCESS','FAILED','REJECTED','CANCELLED')
                    THEN 1 ELSE 0 END) AS concluded,
                SUM(CASE WHEN knowledge_review_state IN ('NOT_REVIEWED','PENDING_REVIEW')
                    THEN 1 ELSE 0 END) AS pending_review
            FROM customer_requests WHERE {request_where} GROUP BY user_tier""",
            tuple(request_args),
        ).fetchall()
        invocation_rows = self._connection.execute(
            f"""SELECT r.user_tier, COUNT(*) AS invocations,
                COALESCE(SUM(i.total_tokens),0) AS known_tokens,
                COUNT(i.cost_amount) AS known_cost_count,
                COUNT(*)-COUNT(i.cost_amount) AS unknown_cost_count
            FROM request_invocations i JOIN customer_requests r ON r.request_id=i.request_id
            WHERE {invocation_where} GROUP BY r.user_tier""",
            tuple(invocation_args),
        ).fetchall()
        request_map = {row["user_tier"]: row for row in request_rows}
        invocation_map = {row["user_tier"]: row for row in invocation_rows}
        currency_map = self._tier_currency_subtotals(invocation_where, tuple(invocation_args))
        items: list[OwnerTierUsageItem] = []
        for tier in UserTier:
            request = request_map.get(tier.value)
            invocation = invocation_map.get(tier.value)
            concluded = _int(request["concluded"]) if request is not None else 0
            succeeded = _int(request["succeeded"]) if request is not None else 0
            items.append(
                OwnerTierUsageItem(
                    user_tier=tier,
                    unique_users=_int(request["unique_users"]) if request is not None else 0,
                    requests=_int(request["requests"]) if request is not None else 0,
                    invocations=_int(invocation["invocations"]) if invocation is not None else 0,
                    known_tokens=_int(invocation["known_tokens"]) if invocation is not None else 0,
                    cost_summary=_cost_summary(
                        _int(invocation["known_cost_count"]) if invocation is not None else 0,
                        _int(invocation["unknown_cost_count"]) if invocation is not None else 0,
                        currency_map.get(tier.value, ()),
                    ),
                    success_rate=(succeeded / concluded if concluded else None),
                    pending_review=_int(request["pending_review"]) if request is not None else 0,
                )
            )
        return tuple(items)

    def list_recent_activity(
        self, *, window: OwnerTimeWindow, limit: int
    ) -> tuple[OwnerRecentActivity, ...]:
        limit, _ = validate_page(limit, 0)
        start, end = _iso(window.from_at), _iso(window.to_at)
        rows = self._connection.execute(
            """SELECT * FROM (
                SELECT CASE
                    WHEN actor_type='OWNER' THEN 'OWNER_REQUEST'
                    WHEN status='SUCCEEDED' THEN 'REQUEST_SUCCEEDED'
                    WHEN status='FAILED' THEN 'REQUEST_FAILED'
                    ELSE 'CUSTOMER_REQUEST' END AS kind,
                    created_at AS occurred_at, request_id, actor_type, customer_id,
                    user_tier, status,
                    CASE
                    WHEN actor_type='OWNER' THEN 'OWNER request observed'
                    WHEN status='SUCCEEDED' THEN 'Customer request succeeded'
                    WHEN status='FAILED' THEN 'Customer request failed'
                    ELSE 'Customer request observed' END AS summary
                FROM customer_requests WHERE created_at>=? AND created_at<?
                UNION ALL
                SELECT 'INVOCATION_FAILED', i.created_at, r.request_id, r.actor_type,
                    r.customer_id, r.user_tier, i.invocation_status,
                    'AI invocation failed'
                FROM request_invocations i JOIN customer_requests r ON r.request_id=i.request_id
                WHERE i.invocation_status='ERROR' AND i.created_at>=? AND i.created_at<?
                UNION ALL
                SELECT 'KNOWLEDGE_REVIEW_CANDIDATE', r.created_at, r.request_id,
                    r.actor_type, r.customer_id, r.user_tier, r.knowledge_review_state,
                    'Knowledge review candidate observed'
                FROM customer_requests r WHERE r.actor_type='CUSTOMER'
                    AND r.knowledge_review_state IN ('NOT_REVIEWED','PENDING_REVIEW')
                    AND r.created_at>=? AND r.created_at<?
            ) ORDER BY occurred_at DESC, request_id, kind LIMIT ?""",
            (start, end, start, end, start, end, limit),
        ).fetchall()
        return tuple(
            OwnerRecentActivity(
                kind=OwnerActivityKind(row["kind"]),
                occurred_at=_datetime(row["occurred_at"]),
                request_id=row["request_id"],
                actor_type=ActorType(row["actor_type"]),
                customer_id=row["customer_id"],
                user_tier=UserTier(row["user_tier"]),
                status=row["status"],
                summary=row["summary"],
            )
            for row in rows
        )

    @staticmethod
    def _customer_rollup_cte() -> str:
        return """WITH request_rollup AS (
            SELECT r.customer_id,
                MIN(r.created_at) AS first_seen_at,
                MAX(r.created_at) AS last_seen_at,
                COUNT(*) AS request_count,
                SUM(CASE WHEN r.status='SUCCEEDED' THEN 1 ELSE 0 END) AS success_count,
                SUM(CASE WHEN r.status='FAILED' THEN 1 ELSE 0 END) AS failed_count,
                SUM(CASE WHEN r.knowledge_review_state IN ('NOT_REVIEWED','PENDING_REVIEW')
                    THEN 1 ELSE 0 END) AS pending_review_count,
                (SELECT r2.user_tier FROM customer_requests r2
                 WHERE r2.customer_id=r.customer_id AND r2.actor_type='CUSTOMER'
                 ORDER BY r2.created_at DESC, r2.request_id DESC LIMIT 1) AS current_tier
            FROM customer_requests r WHERE r.actor_type='CUSTOMER' GROUP BY r.customer_id
        ), invocation_rollup AS (
            SELECT r.customer_id,
                COUNT(i.invocation_id) AS invocation_count,
                COALESCE(SUM(i.input_tokens),0) AS input_tokens_known,
                COALESCE(SUM(i.output_tokens),0) AS output_tokens_known,
                COALESCE(SUM(i.total_tokens),0) AS known_token_total,
                SUM(CASE WHEN i.invocation_id IS NOT NULL AND
                    (i.input_tokens IS NULL OR i.output_tokens IS NULL
                    OR i.total_tokens IS NULL) THEN 1 ELSE 0 END) AS token_unknown_count,
                COUNT(i.cost_amount) AS known_cost_count,
                COUNT(i.invocation_id)-COUNT(i.cost_amount) AS unknown_cost_count
            FROM customer_requests r LEFT JOIN request_invocations i ON i.request_id=r.request_id
            WHERE r.actor_type='CUSTOMER' GROUP BY r.customer_id
        ), customer_rollup AS (
            SELECT q.*, COALESCE(i.invocation_count,0) AS invocation_count,
                COALESCE(i.input_tokens_known,0) AS input_tokens_known,
                COALESCE(i.output_tokens_known,0) AS output_tokens_known,
                COALESCE(i.known_token_total,0) AS known_token_total,
                COALESCE(i.token_unknown_count,0) AS token_unknown_count,
                COALESCE(i.known_cost_count,0) AS known_cost_count,
                COALESCE(i.unknown_cost_count,0) AS unknown_cost_count
            FROM request_rollup q LEFT JOIN invocation_rollup i ON i.customer_id=q.customer_id
        )"""

    @staticmethod
    def _request_predicates(filters: OwnerRequestFilters) -> tuple[list[str], list[Any]]:
        predicates = ["1=1"]
        args: list[Any] = []
        direct = (
            ("r.actor_type", filters.actor_type),
            ("r.customer_id", filters.customer_id),
            ("r.user_tier", filters.user_tier),
            ("r.status", filters.request_status),
            ("r.capability_id", filters.capability_id),
            ("r.knowledge_review_state", filters.knowledge_review_state),
        )
        for column, value in direct:
            if value is not None:
                predicates.append(f"{column}=?")
                args.append(value.value if isinstance(value, (ActorType, UserTier, CustomerRequestStatus, KnowledgeReviewState)) else value)
        if filters.resolved_provider is not None:
            predicates.append(
                "EXISTS (SELECT 1 FROM request_invocations fp WHERE fp.request_id=r.request_id AND fp.resolved_provider=?)"
            )
            args.append(filters.resolved_provider)
        if filters.resolved_model is not None:
            predicates.append(
                "EXISTS (SELECT 1 FROM request_invocations fm WHERE fm.request_id=r.request_id AND fm.resolved_model=?)"
            )
            args.append(filters.resolved_model)
        if filters.window is not None:
            predicates.append("r.created_at>=? AND r.created_at<?")
            args.extend((_iso(filters.window.from_at), _iso(filters.window.to_at)))
        return predicates, args

    def _request_list_item(
        self,
        row: sqlite3.Row,
        models: tuple[str, ...],
        providers: tuple[str, ...],
        subtotals: tuple[CurrencySubtotal, ...],
    ) -> OwnerRequestListItem:
        return OwnerRequestListItem(
            request_id=row["request_id"],
            actor_type=ActorType(row["actor_type"]),
            customer_id=row["customer_id"],
            user_tier=UserTier(row["user_tier"]),
            capability_id=row["capability_id"],
            status=CustomerRequestStatus(row["status"]),
            created_at=_datetime(row["created_at"]),
            completed_at=_datetime_optional(row["completed_at"]),
            invocation_count=_int(row["invocation_count"]),
            token_summary=OwnerTokenSummary(
                _int(row["input_tokens_known"]),
                _int(row["output_tokens_known"]),
                _int(row["total_tokens_known"]),
                _int(row["token_unknown_count"]),
            ),
            resolved_models_summary=models,
            resolved_providers_summary=providers,
            cost_summary=_cost_summary(
                _int(row["known_cost_count"]), _int(row["unknown_cost_count"]), subtotals
            ),
            result_status=RequestResultStatus(row["result_status"]),
            result_summary=row["result_summary"],
            result_ref=row["result_ref"],
            markdown_ref=row["markdown_ref"],
            knowledge_review_state=KnowledgeReviewState(row["knowledge_review_state"]),
        )

    @staticmethod
    def _customer_item(
        row: sqlite3.Row,
        subtotals: tuple[CurrencySubtotal, ...],
        active_since: datetime,
    ) -> OwnerCustomerListItem:
        return OwnerCustomerListItem(
            customer_id=row["customer_id"],
            user_tier=UserTier(row["current_tier"]),
            first_seen_at=_datetime(row["first_seen_at"]),
            last_seen_at=_datetime(row["last_seen_at"]),
            request_count=_int(row["request_count"]),
            success_count=_int(row["success_count"]),
            failed_count=_int(row["failed_count"]),
            invocation_count=_int(row["invocation_count"]),
            known_token_total=_int(row["known_token_total"]),
            cost_summary=_cost_summary(
                _int(row["known_cost_count"]), _int(row["unknown_cost_count"]), subtotals
            ),
            pending_review_count=_int(row["pending_review_count"]),
            is_active=_datetime(row["last_seen_at"]) >= active_since.astimezone(timezone.utc),
        )

    def _invocation_item(self, row: sqlite3.Row) -> OwnerInvocationReadItem:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
        return OwnerInvocationReadItem(
            invocation_id=row["invocation_id"],
            model_profile=row["model_profile"],
            provider=row["resolved_provider"],
            model=row["resolved_model"],
            status=InvocationStatus(row["invocation_status"]),
            input_tokens=_fallback(row["input_tokens"], payload.get("input_tokens")),
            output_tokens=_fallback(row["output_tokens"], payload.get("output_tokens")),
            total_tokens=_fallback(row["total_tokens"], payload.get("total_tokens")),
            cost_amount=row["cost_amount"],
            cost_currency=row["cost_currency"],
            cost_source=CostSource(row["cost_source"]),
            latency_ms=_fallback(row["latency_ms"], payload.get("latency_ms")),
            safe_error=row["safe_error"],
            occurred_at=_datetime(row["created_at"]),
        )

    def _request_model_summaries(
        self, request_ids: tuple[str, ...]
    ) -> tuple[dict[str, tuple[str, ...]], dict[str, tuple[str, ...]]]:
        if not request_ids:
            return {}, {}
        placeholders = ",".join("?" for _ in request_ids)
        rows = self._connection.execute(
            f"""SELECT request_id, resolved_model, resolved_provider FROM (
                SELECT request_id, resolved_model, resolved_provider,
                    ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY created_at DESC, invocation_id) AS n
                FROM request_invocations WHERE request_id IN ({placeholders})
            ) WHERE n<=10 ORDER BY request_id, n""",
            request_ids,
        ).fetchall()
        models: dict[str, list[str]] = {}
        providers: dict[str, list[str]] = {}
        for row in rows:
            models.setdefault(row["request_id"], [])
            providers.setdefault(row["request_id"], [])
            if row["resolved_model"] not in models[row["request_id"]]:
                models[row["request_id"]].append(row["resolved_model"])
            if row["resolved_provider"] not in providers[row["request_id"]]:
                providers[row["request_id"]].append(row["resolved_provider"])
        return (
            {key: tuple(value) for key, value in models.items()},
            {key: tuple(value) for key, value in providers.items()},
        )

    def _request_cost_summary(self, request_id: str) -> OwnerCostSummary:
        row = self._connection.execute(
            """SELECT COUNT(cost_amount) AS known_cost_count,
                COUNT(*)-COUNT(cost_amount) AS unknown_cost_count
            FROM request_invocations WHERE request_id=?""",
            (request_id,),
        ).fetchone()
        subtotals = self._request_currency_subtotals((request_id,)).get(request_id, ())
        return _cost_summary(
            _int(row["known_cost_count"]), _int(row["unknown_cost_count"]), subtotals
        )

    def _currency_subtotals(
        self, table: str, where: str, args: tuple[Any, ...]
    ) -> tuple[CurrencySubtotal, ...]:
        rows = self._connection.execute(
            f"""SELECT cost_currency, SUM(cost_amount) AS amount, COUNT(*) AS amount_count
            FROM {table} WHERE {where} AND cost_amount IS NOT NULL
            GROUP BY cost_currency ORDER BY cost_currency""",
            args,
        ).fetchall()
        return tuple(
            CurrencySubtotal(row["cost_currency"], _amount(row["amount"]), _int(row["amount_count"]))
            for row in rows
        )

    def _request_currency_subtotals(
        self, request_ids: tuple[str, ...]
    ) -> dict[str, tuple[CurrencySubtotal, ...]]:
        if not request_ids:
            return {}
        placeholders = ",".join("?" for _ in request_ids)
        rows = self._connection.execute(
            f"""SELECT request_id, cost_currency, SUM(cost_amount) AS amount, COUNT(*) AS amount_count
            FROM request_invocations WHERE request_id IN ({placeholders}) AND cost_amount IS NOT NULL
            GROUP BY request_id, cost_currency ORDER BY request_id, cost_currency""",
            request_ids,
        ).fetchall()
        return _group_currency(rows, "request_id")

    def _customer_currency_subtotals(
        self, customer_ids: tuple[str, ...]
    ) -> dict[str, tuple[CurrencySubtotal, ...]]:
        if not customer_ids:
            return {}
        placeholders = ",".join("?" for _ in customer_ids)
        rows = self._connection.execute(
            f"""SELECT r.customer_id, i.cost_currency, SUM(i.cost_amount) AS amount,
                COUNT(*) AS amount_count
            FROM request_invocations i JOIN customer_requests r ON r.request_id=i.request_id
            WHERE r.customer_id IN ({placeholders}) AND i.cost_amount IS NOT NULL
            GROUP BY r.customer_id, i.cost_currency ORDER BY r.customer_id, i.cost_currency""",
            customer_ids,
        ).fetchall()
        return _group_currency(rows, "customer_id")

    def _model_currency_subtotals(
        self, where: str, args: tuple[Any, ...]
    ) -> dict[tuple[str, str], tuple[CurrencySubtotal, ...]]:
        rows = self._connection.execute(
            f"""SELECT i.resolved_provider, i.resolved_model, i.cost_currency,
                SUM(i.cost_amount) AS amount, COUNT(*) AS amount_count
            FROM request_invocations i JOIN customer_requests r ON r.request_id=i.request_id
            WHERE {where} AND i.cost_amount IS NOT NULL
            GROUP BY i.resolved_provider, i.resolved_model, i.cost_currency
            ORDER BY i.resolved_provider, i.resolved_model, i.cost_currency""",
            args,
        ).fetchall()
        grouped: dict[tuple[str, str], list[CurrencySubtotal]] = {}
        for row in rows:
            key = (row["resolved_provider"], row["resolved_model"])
            grouped.setdefault(key, []).append(
                CurrencySubtotal(row["cost_currency"], _amount(row["amount"]), _int(row["amount_count"]))
            )
        return {key: tuple(value) for key, value in grouped.items()}

    def _tier_currency_subtotals(
        self, where: str, args: tuple[Any, ...]
    ) -> dict[str, tuple[CurrencySubtotal, ...]]:
        rows = self._connection.execute(
            f"""SELECT r.user_tier, i.cost_currency, SUM(i.cost_amount) AS amount,
                COUNT(*) AS amount_count
            FROM request_invocations i JOIN customer_requests r ON r.request_id=i.request_id
            WHERE {where} AND i.cost_amount IS NOT NULL
            GROUP BY r.user_tier, i.cost_currency ORDER BY r.user_tier, i.cost_currency""",
            args,
        ).fetchall()
        return _group_currency(rows, "user_tier")


def _cost_summary(
    known_count: int,
    unknown_count: int,
    subtotals: Iterable[CurrencySubtotal],
) -> OwnerCostSummary:
    values = tuple(subtotals)
    if known_count == 0:
        return OwnerCostSummary(None, None, CostCompleteness.UNAVAILABLE, unknown_count, False, ())
    if len(values) != 1:
        return OwnerCostSummary(
            None, None, CostCompleteness.MIXED_CURRENCY, unknown_count, True, values
        )
    value = values[0]
    completeness = CostCompleteness.PARTIAL if unknown_count else CostCompleteness.COMPLETE
    return OwnerCostSummary(
        value.amount, value.currency, completeness, unknown_count, False, values
    )


def _group_currency(
    rows: Iterable[Mapping[str, Any]], key_name: str
) -> dict[str, tuple[CurrencySubtotal, ...]]:
    grouped: dict[str, list[CurrencySubtotal]] = {}
    for row in rows:
        grouped.setdefault(row[key_name], []).append(
            CurrencySubtotal(row["cost_currency"], _amount(row["amount"]), _int(row["amount_count"]))
        )
    return {key: tuple(value) for key, value in grouped.items()}


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def _datetime_optional(value: str | None) -> datetime | None:
    return None if value is None else _datetime(value)


def _int(value: Any) -> int:
    return 0 if value is None else int(value)


def _amount(value: Any) -> float:
    return round(float(value), 12)


def _fallback(primary: Any, fallback: Any) -> Any:
    return primary if primary is not None else fallback
