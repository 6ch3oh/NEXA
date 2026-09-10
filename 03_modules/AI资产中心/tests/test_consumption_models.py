from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError, replace
from datetime import datetime

from src.consumption import (
    AI_ASSET_CONSUMPTION_SCHEMA_VERSION,
    ConsumptionCompleteness,
    WarningCode,
    build_provider_view,
)
from tests.fixtures.analytics_fixtures import PROVIDER_A
from tests.fixtures.consumption_fixtures import (
    AS_OF,
    GENERATED_AT,
    PERIOD,
    STALE_AFTER,
    complete_query,
)


class TestConsumptionModels(unittest.TestCase):
    def test_schema_version_is_explicit_and_stable(self) -> None:
        self.assertEqual(AI_ASSET_CONSUMPTION_SCHEMA_VERSION, "0.1")
        view = build_provider_view(
            complete_query(), PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        self.assertEqual(view.schema_version, "0.1")
        self.assertEqual(view.generated_at, GENERATED_AT)

    def test_read_models_are_frozen(self) -> None:
        view = build_provider_view(
            complete_query(), PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        with self.assertRaises(FrozenInstanceError):
            view.schema_version = "changed"  # type: ignore[misc]

    def test_warning_codes_and_completeness_are_stable_enums(self) -> None:
        self.assertEqual(WarningCode.BALANCE_MISSING.value, "BALANCE_MISSING")
        self.assertEqual(WarningCode.AMBIGUOUS_DATA.value, "AMBIGUOUS_DATA")
        self.assertEqual(ConsumptionCompleteness.COMPLETE.value, "COMPLETE")
        self.assertEqual(ConsumptionCompleteness.UNKNOWN.value, "UNKNOWN")

    def test_invalid_version_naive_time_and_duplicate_warnings_fail_closed(self) -> None:
        view = build_provider_view(
            complete_query(), PROVIDER_A, PERIOD, generated_at=GENERATED_AT,
            as_of=AS_OF, stale_after=STALE_AFTER,
        )
        with self.assertRaises(ValueError):
            replace(view, schema_version="0.2")
        with self.assertRaises(ValueError):
            replace(view, generated_at=datetime(2026, 3, 2))
        with self.assertRaises(ValueError):
            replace(view, warnings=(WarningCode.USAGE_MISSING, WarningCode.USAGE_MISSING))


if __name__ == "__main__":
    unittest.main()
