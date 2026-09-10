from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from src.budget import BudgetCostBasis, SQLiteBudgetPolicyStore
from src.store import SQLiteCanonicalStore
from tests.fixtures.analytics_fixtures import (
    FEB_15,
    PROVIDER_B,
    analytics_collections,
    balance,
)
from tests.fixtures.budget_fixtures import policy

ENABLED_POLICY_ID = "application-enabled-budget"
DISABLED_POLICY_ID = "application-disabled-budget"


def populate_application_database(database_path: str | Path, *, reverse: bool = False) -> None:
    collections = analytics_collections()
    collections["balances"].append(
        balance("0", FEB_15, provider_id=PROVIDER_B, token_id=None)
    )
    if reverse:
        collections = {
            name: list(reversed(records)) for name, records in collections.items()
        }

    with SQLiteCanonicalStore(database_path) as store:
        for record in collections["providers"]:
            store.put_provider(record)
        for record in collections["tokens"]:
            store.put_token(record)
        for record in collections["balances"]:
            store.append_balance(record)
        for record in collections["usages"]:
            store.append_usage(record)
        for record in collections["pricing"]:
            store.append_pricing(record)
        for record in collections["costs"]:
            store.append_cost(record)

    enabled = policy(
        policy_id=ENABLED_POLICY_ID,
        cost_basis=BudgetCostBasis.ACTUAL_PLUS_ESTIMATED,
    )
    disabled = replace(
        policy(), policy_id=DISABLED_POLICY_ID, enabled=False
    )
    policies = (disabled, enabled) if reverse else (enabled, disabled)
    with SQLiteBudgetPolicyStore(database_path) as store:
        for record in policies:
            store.put_budget_policy(record)
