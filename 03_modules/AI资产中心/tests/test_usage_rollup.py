from __future__ import annotations

import unittest
from datetime import datetime

from src.analytics import Period, daily_period, monthly_period, rollup_usage
from src.contracts import SourceType
from src.query import QueryService
from tests.fixtures.analytics_fixtures import (
    FEB_1, FEB_2, FEB_15, JAN_31, MAR_1, PROVIDER_A, TOKEN_A1, TOKEN_A2,
    TOKEN_A3, analytics_query, usage,
)


class TestUsageRollup(unittest.TestCase):
    def test_single_record_and_all_components(self) -> None:
        result = rollup_usage(QueryService(usages=[usage("single", FEB_1)]),
                              PROVIDER_A, Period(FEB_1, FEB_2))
        self.assertEqual(result.record_count, 1)
        self.assertEqual((result.input_tokens, result.output_tokens,
                          result.cache_read_tokens, result.cache_write_tokens), (10, 5, 2, 1))
        self.assertEqual(result.total_tokens, 18)

    def test_multiple_records_accumulate_exactly(self) -> None:
        result = rollup_usage(analytics_query(), PROVIDER_A, Period(FEB_1, MAR_1))
        self.assertEqual(result.record_count, 3)
        self.assertEqual((result.input_tokens, result.output_tokens,
                          result.cache_read_tokens, result.cache_write_tokens,
                          result.total_tokens), (30, 15, 9, 4, 58))

    def test_start_inclusive_end_exclusive(self) -> None:
        query = QueryService(usages=[usage("at-start", FEB_1), usage("inside", FEB_15),
                                     usage("at-end", MAR_1)])
        result = rollup_usage(query, PROVIDER_A, Period(FEB_1, MAR_1))
        self.assertEqual(result.record_count, 2)
        refs = {item.source_reference for item in result.provenance.underlying_sources}
        self.assertIn("synthetic:usage:at-start", refs)
        self.assertNotIn("synthetic:usage:at-end", refs)

    def test_daily_period_is_half_open(self) -> None:
        period = daily_period(FEB_1.replace(hour=12))
        query = QueryService(usages=[usage("day", FEB_1), usage("next-day", FEB_2)])
        self.assertEqual((period.start, period.end), (FEB_1, FEB_2))
        self.assertEqual(rollup_usage(query, PROVIDER_A, period).record_count, 1)

    def test_monthly_period_handles_boundary(self) -> None:
        january, february = monthly_period(JAN_31), monthly_period(FEB_15)
        self.assertEqual(rollup_usage(analytics_query(), PROVIDER_A, january).record_count, 1)
        self.assertEqual(rollup_usage(analytics_query(), PROVIDER_A, february).record_count, 3)
        self.assertEqual((january.end, february.end), (FEB_1, MAR_1))

    def test_zero_usage_is_distinct_from_missing(self) -> None:
        period = Period(FEB_1, MAR_1)
        zero = rollup_usage(analytics_query(), PROVIDER_A, period, token_id=TOKEN_A2)
        missing = rollup_usage(analytics_query(), PROVIDER_A, period, token_id=TOKEN_A3)
        self.assertEqual((zero.record_count, zero.total_tokens), (1, 0))
        self.assertIsNone(missing)

    def test_provenance_is_derived_and_preserved(self) -> None:
        result = rollup_usage(analytics_query(), PROVIDER_A, Period(FEB_1, MAR_1),
                              token_id=TOKEN_A1)
        self.assertIs(result.provenance.derivation_type, SourceType.DERIVED_CALCULATED)
        self.assertEqual(len(result.provenance.underlying_sources), 2)

    def test_period_requires_aware_ordered_datetimes(self) -> None:
        with self.assertRaises(ValueError):
            Period(datetime(2026, 1, 1), FEB_1)
        with self.assertRaises(ValueError):
            Period(FEB_1, FEB_1)


if __name__ == "__main__":
    unittest.main()
