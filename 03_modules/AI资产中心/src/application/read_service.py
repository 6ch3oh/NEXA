from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from src.analytics import Period, build_resource_intelligence
from src.authority import model_to_attribution, task_to_models, to_public_attribution
from src.budget import SQLiteBudgetPolicyStore, evaluate_budget_from_query
from src.consumption import (
    BudgetConsumptionView,
    PortfolioConsumptionView,
    ProviderConsumptionView,
    TokenConsumptionView,
    build_budget_consumption_view,
    build_portfolio_view,
    build_provider_view,
    build_token_view,
    ResourceOverviewView,
    build_resource_overview,
)
from src.query import QueryService
from src.contracts import BillingMode, CostKind
from src.store import SQLiteCanonicalStore


class ApplicationReadError(RuntimeError):
    """The requested local read cannot be assembled without guessing."""


class AIAssetReadService:
    """Storage-backed, read-only orchestration over existing NEXA components.

    The caller supplies an existing local V3 database. Each public read loads
    canonical collections once, builds one immutable QueryService, and delegates
    selection, analytics, budget evaluation, and consumer-model construction to
    their already established layers.
    """

    def __init__(self, database_path: str | Path):
        if not isinstance(database_path, (str, Path)) or not str(database_path):
            raise ValueError("database_path must be explicitly provided")
        path = Path(database_path)
        if not path.exists():
            raise FileNotFoundError("application read database does not exist")
        if not path.is_file():
            raise IsADirectoryError("application read database path must be a file")
        if path.stat().st_size == 0:
            raise ApplicationReadError("application read database has no schema")
        self.database_path = path

    def get_provider_view(
        self,
        provider_id: str,
        period: Period,
        *,
        generated_at: datetime,
        as_of: datetime,
        stale_after: timedelta | None = None,
    ) -> ProviderConsumptionView:
        _require_identity(provider_id, "provider_id")
        query = self._load_query()
        return build_provider_view(
            query,
            provider_id,
            period,
            generated_at=generated_at,
            as_of=as_of,
            stale_after=stale_after,
        )

    def get_token_view(
        self,
        token_id: str,
        period: Period,
        *,
        generated_at: datetime,
        as_of: datetime,
        stale_after: timedelta | None = None,
    ) -> TokenConsumptionView | None:
        _require_identity(token_id, "token_id")
        query = self._load_query()
        matches = tuple(token for token in query.list_tokens() if token.id == token_id)
        if not matches:
            return None
        if len(matches) != 1:
            raise ApplicationReadError("token identity is ambiguous")
        token = matches[0]
        return build_token_view(
            query,
            token.provider_id,
            token.id,
            period,
            generated_at=generated_at,
            as_of=as_of,
            stale_after=stale_after,
        )

    def get_portfolio_view(
        self,
        period: Period,
        *,
        generated_at: datetime,
        as_of: datetime,
        stale_after: timedelta | None = None,
    ) -> PortfolioConsumptionView:
        query = self._load_query()
        return build_portfolio_view(
            query,
            period,
            generated_at=generated_at,
            as_of=as_of,
            stale_after=stale_after,
        )

    def evaluate_budgets(
        self, *, evaluated_at: datetime
    ) -> tuple[BudgetConsumptionView, ...]:
        query = self._load_query()
        with SQLiteBudgetPolicyStore(self.database_path) as policy_store:
            policies = policy_store.list_enabled_budget_policies()
        return tuple(
            build_budget_consumption_view(
                evaluate_budget_from_query(
                    query,
                    policy,
                    evaluated_at=evaluated_at,
                )
            )
            for policy in policies
        )

    def get_resource_overview(
        self, period: Period, *, generated_at: datetime, as_of: datetime,
        stale_after: timedelta | None = None,
    ) -> ResourceOverviewView:
        query = self._load_query()
        portfolio = build_portfolio_view(
            query, period, generated_at=generated_at, as_of=as_of,
            stale_after=stale_after,
        )
        intelligence = build_resource_intelligence(query, period)
        with SQLiteBudgetPolicyStore(self.database_path) as policy_store:
            policies = policy_store.list_enabled_budget_policies()
        budgets = tuple(build_budget_consumption_view(evaluate_budget_from_query(
            query, policy, evaluated_at=generated_at
        )) for policy in policies)
        return build_resource_overview(
            portfolio, intelligence, budgets, generated_at=generated_at
        )

    def _load_query(self) -> QueryService:
        with SQLiteCanonicalStore(self.database_path) as canonical_store:
            collections = canonical_store.load_collections()
        return QueryService(**collections.as_query_kwargs())

    def get_model_attribution_authority(
        self, provider_id: str, model: str, period: Period, *,
        billing_mode: BillingMode, cost_kind: CostKind = CostKind.ACTUAL,
    ):
        _require_identity(provider_id, "provider_id")
        _require_identity(model, "model")
        query = self._load_query()
        return to_public_attribution(model_to_attribution(
            query.usages, query.costs, provider_id=provider_id, model=model,
            start=period.start, end=period.end, billing_mode=billing_mode,
            cost_kind=cost_kind,
        ))

    def get_task_model_authority(
        self, project_id: str, task_id: str, period: Period, *,
        billing_mode: BillingMode, cost_kind: CostKind = CostKind.ACTUAL,
    ):
        _require_identity(project_id, "project_id")
        _require_identity(task_id, "task_id")
        query = self._load_query()
        return to_public_attribution(task_to_models(
            query.usages, query.costs, project_id=project_id, task_id=task_id,
            start=period.start, end=period.end, billing_mode=billing_mode,
            cost_kind=cost_kind,
        ))

def _require_identity(value: str, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must not be empty")
