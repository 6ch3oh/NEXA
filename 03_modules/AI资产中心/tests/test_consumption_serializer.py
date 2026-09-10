from __future__ import annotations

import json
import unittest
from datetime import datetime
from decimal import Decimal

from src.consumption import (
    ConsumptionCompleteness,
    WarningCode,
    build_provider_view,
    to_canonical_json,
    to_json_safe,
)
from src.contracts import SourceTag, SourceType
from tests.fixtures.analytics_fixtures import FEB_1, PROVIDER_A
from tests.fixtures.consumption_fixtures import (
    AS_OF,
    GENERATED_AT,
    PERIOD,
    STALE_AFTER,
    complete_query,
)


class TestConsumptionSerializer(unittest.TestCase):
    def test_scalar_and_collection_types_are_json_safe(self) -> None:
        source = SourceTag(SourceType.MANUAL, "synthetic:serializer", FEB_1)
        result = to_json_safe(
            (Decimal("0.123456789"), FEB_1, WarningCode.BALANCE_MISSING, source)
        )
        self.assertIsInstance(result, list)
        self.assertEqual(result[0], "0.123456789")
        self.assertEqual(result[1], FEB_1.isoformat())
        self.assertEqual(result[2], "BALANCE_MISSING")
        self.assertEqual(result[3]["source_type"], "manual")
        self.assertEqual(result[3]["captured_at"], FEB_1.isoformat())

    def test_nested_view_serializes_without_decimal_float_loss(self) -> None:
        view = build_provider_view(
            complete_query(), PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        payload = to_json_safe(view)
        self.assertEqual(payload["schema_version"], "0.1")
        self.assertEqual(payload["generated_at"], GENERATED_AT.isoformat())
        self.assertEqual(payload["completeness"], "COMPLETE")
        self.assertEqual(payload["data"]["actual_cost_by_currency"][0]["amount"], "0.100000001")
        self.assertIsInstance(payload["data"]["tokens"], list)
        json.dumps(payload)

    def test_canonical_json_is_deterministic(self) -> None:
        first = build_provider_view(
            complete_query(), PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        second = build_provider_view(
            complete_query(reverse=True), PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        self.assertEqual(to_canonical_json(first), to_canonical_json(second))
        self.assertNotIn(": ", to_canonical_json(first))
        self.assertNotIn(", ", to_canonical_json(first))

    def test_naive_datetime_float_and_non_finite_decimal_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            to_json_safe(datetime(2026, 1, 1))
        with self.assertRaises(TypeError):
            to_json_safe(0.1)
        with self.assertRaises(ValueError):
            to_json_safe(Decimal("NaN"))


if __name__ == "__main__":
    unittest.main()
