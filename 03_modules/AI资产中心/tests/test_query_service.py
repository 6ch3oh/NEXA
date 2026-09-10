from __future__ import annotations

import pathlib
import unittest
from datetime import datetime, timezone
from decimal import Decimal

from src.contracts import CostKind, PriceDimension, SourceType
from src.query import LookupStatus, QueryService

from tests.fixtures.query_fixtures import (
    MODEL_A,
    MODEL_B,
    OTHER_PROVIDER_ID,
    PROVIDER_ID,
    T0,
    T1,
    T2,
    T3,
    balance,
    cost,
    price,
    provider,
    source,
    token,
    usage,
)


class TestProviderQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.service = QueryService(providers=[provider()])

    def test_get_provider_found(self) -> None:
        self.assertEqual(self.service.get_provider(PROVIDER_ID).id, PROVIDER_ID)

    def test_get_provider_missing_returns_none(self) -> None:
        self.assertIsNone(self.service.get_provider("prov-unknown"))

    def test_lookup_provider_distinguishes_found_and_missing(self) -> None:
        found = self.service.lookup_provider(PROVIDER_ID)
        self.assertEqual(found.status, LookupStatus.FOUND)
        self.assertEqual(found.record.id, PROVIDER_ID)
        missing = self.service.lookup_provider("prov-unknown")
        self.assertEqual(missing.status, LookupStatus.MISSING)
        self.assertIsNone(missing.record)

    def test_duplicate_provider_id_is_not_guessed(self) -> None:
        service = QueryService(providers=[provider(), provider(PROVIDER_ID, display_name="Copy")])
        self.assertIsNone(service.get_provider(PROVIDER_ID))
        explicit = service.lookup_provider(PROVIDER_ID)
        self.assertEqual(explicit.status, LookupStatus.AMBIGUOUS)
        self.assertEqual(len(explicit.candidates), 2)


class TestTokenQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.service = QueryService(
            providers=[provider(), provider(OTHER_PROVIDER_ID)],
            tokens=[
                token("tok-b", provider_id=OTHER_PROVIDER_ID),
                token("tok-a"),
                token("tok-c"),
            ],
        )

    def test_all_tokens_supported(self) -> None:
        result = self.service.list_tokens()
        self.assertEqual([t.id for t in result], ["tok-a", "tok-b", "tok-c"])

    def test_provider_filtered_tokens(self) -> None:
        result = self.service.list_tokens(provider_id=PROVIDER_ID)
        self.assertEqual([t.id for t in result], ["tok-a", "tok-c"])

    def test_stable_ordering(self) -> None:
        result = self.service.list_tokens(provider_id=OTHER_PROVIDER_ID)
        self.assertEqual([t.id for t in result], ["tok-b"])

    def test_no_raw_secret_field(self) -> None:
        for item in self.service.list_tokens():
            self.assertFalse(hasattr(item, "secret"))
            self.assertNotIn("sk-", item.masked_identifier)
            self.assertTrue(item.masked_identifier.startswith("fp:") or "*" in item.masked_identifier)


class TestBalanceQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.service = QueryService(
            providers=[provider()],
            tokens=[token("tok-1"), token("tok-2")],
            balances=[
                balance(PROVIDER_ID, "10.00", observed_at=T1),
                balance(PROVIDER_ID, "5.00", observed_at=T2),
                balance(PROVIDER_ID, "3.00", token_id="tok-1", observed_at=T2),
            ],
        )

    def test_latest_balance(self) -> None:
        result = self.service.latest_balance(PROVIDER_ID)
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.value, Decimal("5.00"))
        self.assertEqual(result.record.observed_at, T2)

    def test_latest_balance_token_specific(self) -> None:
        result = self.service.latest_balance(PROVIDER_ID, token_id="tok-1")
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.value, Decimal("3.00"))

    def test_latest_balance_as_of_excludes_later_records(self) -> None:
        result = self.service.latest_balance(PROVIDER_ID, as_of=T1)
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.value, Decimal("10.00"))

    def test_latest_balance_missing_is_explicit(self) -> None:
        result = self.service.latest_balance(PROVIDER_ID, token_id="tok-999")
        self.assertEqual(result.status, LookupStatus.MISSING)
        self.assertIsNone(result.record)

    def test_same_time_conflicting_content_is_ambiguous(self) -> None:
        service = QueryService(
            balances=[
                balance(PROVIDER_ID, "5.00", observed_at=T2),
                balance(PROVIDER_ID, "6.00", observed_at=T2),
            ],
        )
        result = service.latest_balance(PROVIDER_ID)
        self.assertEqual(result.status, LookupStatus.AMBIGUOUS)
        self.assertIsNone(result.record)
        self.assertEqual(len(result.candidates), 2)

    def test_same_time_identical_content_is_found(self) -> None:
        service = QueryService(
            balances=[
                balance(
                    PROVIDER_ID,
                    "5.00",
                    observed_at=T2,
                    source=source(SourceType.MANUAL, "dup-a"),
                ),
                balance(
                    PROVIDER_ID,
                    "5.00",
                    observed_at=T2,
                    source=source(SourceType.REMOTE_PROVIDER_API, "dup-b"),
                ),
            ],
        )
        result = service.latest_balance(PROVIDER_ID)
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.value, Decimal("5.00"))


class TestUsageQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.service = QueryService(
            usages=[
                usage("u-1", observed_at=T1, model=MODEL_A),
                usage("u-2", observed_at=T2, model=MODEL_A, token_id="tok-1"),
                usage("u-3", observed_at=T3, model=MODEL_B),
                usage("u-4", observed_at=T2, provider_id=OTHER_PROVIDER_ID),
            ],
        )

    def test_provider_filter(self) -> None:
        self.assertEqual(len(self.service.list_usage(provider_id=PROVIDER_ID)), 3)

    def test_token_filter(self) -> None:
        result = self.service.list_usage(provider_id=PROVIDER_ID, token_id="tok-1")
        self.assertEqual([u.usage_id for u in result], ["u-2"])

    def test_model_filter(self) -> None:
        result = self.service.list_usage(provider_id=PROVIDER_ID, model=MODEL_B)
        self.assertEqual([u.usage_id for u in result], ["u-3"])

    def test_time_range_filter(self) -> None:
        result = self.service.list_usage(provider_id=PROVIDER_ID, start=T2, end=T2)
        self.assertEqual({u.usage_id for u in result}, {"u-2"})

    def test_stable_ordering(self) -> None:
        result = self.service.list_usage(provider_id=PROVIDER_ID)
        times = [u.observed_at for u in result]
        self.assertEqual(times, sorted(times))

    def test_usage_never_carries_cost(self) -> None:
        for record in self.service.list_usage(provider_id=PROVIDER_ID):
            self.assertFalse(hasattr(record, "amount"))


class TestPricingQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.service = QueryService(
            pricing=[
                price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.4", effective_at=T0),
                price(PROVIDER_ID, MODEL_A, PriceDimension.OUTPUT, "0.8", effective_at=T0),
                price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.5", effective_at=T2),
                price(PROVIDER_ID, MODEL_B, PriceDimension.INPUT, "0.2", effective_at=T0),
            ],
        )

    def test_unique_resolution_uses_latest_effective(self) -> None:
        result = self.service.resolve_pricing(PROVIDER_ID, MODEL_A, PriceDimension.INPUT)
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.price_per_unit, Decimal("0.5"))

    def test_dimension_specific(self) -> None:
        result = self.service.resolve_pricing(PROVIDER_ID, MODEL_A, PriceDimension.OUTPUT)
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.price_per_unit, Decimal("0.8"))

    def test_missing_is_explicit(self) -> None:
        result = self.service.resolve_pricing(PROVIDER_ID, MODEL_A, PriceDimension.CACHE_READ)
        self.assertEqual(result.status, LookupStatus.MISSING)
        self.assertIsNone(result.record)

    def test_effective_time_excludes_later_prices(self) -> None:
        result = self.service.resolve_pricing(
            PROVIDER_ID, MODEL_A, PriceDimension.INPUT, effective_at=T1
        )
        self.assertEqual(result.status, LookupStatus.FOUND)
        self.assertEqual(result.record.price_per_unit, Decimal("0.4"))

    def test_ambiguous_is_never_guessed(self) -> None:
        service = QueryService(
            pricing=[
                price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.4", effective_at=T2),
                price(PROVIDER_ID, MODEL_A, PriceDimension.INPUT, "0.6", effective_at=T2),
            ],
        )
        result = service.resolve_pricing(PROVIDER_ID, MODEL_A, PriceDimension.INPUT)
        self.assertEqual(result.status, LookupStatus.AMBIGUOUS)
        self.assertIsNone(result.record)
        self.assertEqual(len(result.candidates), 2)

    def test_different_token_scopes_are_ambiguous(self) -> None:
        service = QueryService(
            pricing=[
                price(
                    PROVIDER_ID,
                    MODEL_A,
                    PriceDimension.INPUT,
                    "0.4",
                    effective_at=T2,
                    token_id="tok-a",
                ),
                price(
                    PROVIDER_ID,
                    MODEL_A,
                    PriceDimension.INPUT,
                    "0.4",
                    effective_at=T2,
                    token_id="tok-b",
                ),
            ]
        )
        result = service.resolve_pricing(PROVIDER_ID, MODEL_A, PriceDimension.INPUT)
        self.assertEqual(result.status, LookupStatus.AMBIGUOUS)


class TestCostQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.service = QueryService(
            costs=[
                cost(
                    PROVIDER_ID,
                    "0.12",
                    occurred_at=T1,
                    kind=CostKind.ACTUAL,
                    cost_basis="legacy:costUsd",
                    model=None,
                ),
                cost(
                    PROVIDER_ID,
                    "0.0008",
                    occurred_at=T2,
                    kind=CostKind.ESTIMATED,
                    cost_basis="usage_pricing_calculation",
                    model=MODEL_A,
                ),
                cost(
                    PROVIDER_ID,
                    "0.05",
                    occurred_at=T2,
                    kind=CostKind.ACTUAL,
                    token_id="tok-1",
                    model=None,
                ),
                cost(OTHER_PROVIDER_ID, "9.99", occurred_at=T3, kind=CostKind.ACTUAL),
            ],
        )

    def test_explicit_and_derived_remain_separate(self) -> None:
        result = self.service.list_costs(provider_id=PROVIDER_ID)
        actual = [c for c in result if c.kind is CostKind.ACTUAL]
        estimated = [c for c in result if c.kind is CostKind.ESTIMATED]
        self.assertEqual(len(actual), 2)
        self.assertEqual(len(estimated), 1)
        self.assertTrue(all(c.cost_basis != "usage_pricing_calculation" for c in actual))
        self.assertTrue(all(c.cost_basis == "usage_pricing_calculation" for c in estimated))

    def test_kind_filter(self) -> None:
        result = self.service.list_costs(provider_id=PROVIDER_ID, kind=CostKind.ESTIMATED)
        self.assertEqual([c.cost_basis for c in result], ["usage_pricing_calculation"])

    def test_provider_token_model_filters(self) -> None:
        result = self.service.list_costs(provider_id=PROVIDER_ID, token_id="tok-1")
        self.assertEqual([c.amount for c in result], [Decimal("0.05")])
        result = self.service.list_costs(provider_id=PROVIDER_ID, model=MODEL_A)
        self.assertEqual([c.cost_basis for c in result], ["usage_pricing_calculation"])

    def test_time_range_filter(self) -> None:
        result = self.service.list_costs(provider_id=PROVIDER_ID, start=T1, end=T1)
        self.assertEqual([c.amount for c in result], [Decimal("0.12")])

    def test_stable_ordering(self) -> None:
        result = self.service.list_costs(provider_id=PROVIDER_ID)
        times = [c.occurred_at for c in result]
        self.assertEqual(times, sorted(times))


class TestQueryServiceBoundaries(unittest.TestCase):
    def test_read_only_never_mutates_inputs(self) -> None:
        records = [balance(PROVIDER_ID, "5.00", observed_at=T1)]
        service = QueryService(balances=records)
        before = (records[0].value, records[0].observed_at)
        service.latest_balance(PROVIDER_ID)
        service.list_usage()
        service.list_costs()
        service.list_tokens()
        service.resolve_pricing(PROVIDER_ID, MODEL_A, PriceDimension.INPUT)
        self.assertEqual((records[0].value, records[0].observed_at), before)

    def test_inputs_normalized_to_immutable_tuples(self) -> None:
        service = QueryService(balances=[balance(PROVIDER_ID, "5.00", observed_at=T1)])
        self.assertIsInstance(service.balances, tuple)

    def test_rejects_wrong_element_types(self) -> None:
        with self.assertRaises(ValueError):
            QueryService(balances=["not-a-balance"])  # type: ignore[list-item]

    def test_no_network_environment_credentials_persistence_or_legacy_access(self) -> None:
        root = pathlib.Path(__file__).resolve().parents[1]
        query_dir = root / "src" / "query"
        source_text = "\n".join(
            path.read_text(encoding="utf-8") for path in query_dir.glob("*.py")
        )
        forbidden = (
            "import os",
            "from os",
            "import sys",
            "import socket",
            "import sqlite",
            "sqlalchemy",
            "import json",
            "open(",
            "requests.",
            "httpx",
            "urllib",
            "getenv(",
            "os.environ",
            "credential_store",
            "keyring",
            "subprocess",
            "pathlib",
            "from src.adapters",
            "from src.evidence",
            "from src.domain",
        )
        for fragment in forbidden:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, source_text)


if __name__ == "__main__":
    unittest.main()
