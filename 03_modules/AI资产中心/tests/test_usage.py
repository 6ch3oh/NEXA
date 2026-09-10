from __future__ import annotations

import unittest
from datetime import datetime, timezone

from src.contracts import SourceTag, SourceType, UsageRecord


def fake_source(source_type: SourceType = SourceType.MANUAL) -> SourceTag:
    return SourceTag(source_type=source_type, source_reference="test-fixture")


def valid_usage(**overrides) -> UsageRecord:
    base = dict(
        usage_id="usage-0001",
        provider_id="legacy:codex",
        input_tokens=1000,
        output_tokens=500,
        cache_read_tokens=250,
        cache_write_tokens=0,
        observed_at=datetime(2026, 8, 9, 10, 0, tzinfo=timezone.utc),
        source=fake_source(),
        model="gpt-5",
    )
    base.update(overrides)
    return UsageRecord(**base)


class TestUsageRecordContract(unittest.TestCase):
    def test_valid_usage_record_constructs(self) -> None:
        usage = valid_usage()
        self.assertEqual(usage.usage_id, "usage-0001")
        self.assertEqual(usage.provider_id, "legacy:codex")
        self.assertEqual(usage.token_id, None)
        self.assertEqual(usage.model, "gpt-5")
        self.assertEqual(usage.input_tokens, 1000)
        self.assertEqual(usage.output_tokens, 500)
        self.assertEqual(usage.cache_read_tokens, 250)
        self.assertEqual(usage.cache_write_tokens, 0)
        self.assertEqual(usage.total_tokens, 1750)
        self.assertEqual(usage.observed_at, datetime(2026, 8, 9, 10, 0, tzinfo=timezone.utc))
        self.assertEqual(usage.source.source_type, SourceType.MANUAL)

    def test_canonical_total_is_component_sum(self) -> None:
        usage = valid_usage(input_tokens=3, output_tokens=4, cache_read_tokens=5, cache_write_tokens=6)
        self.assertEqual(usage.total_tokens, 18)

    def test_supplied_matching_total_is_accepted(self) -> None:
        usage = valid_usage(total_tokens=1750)
        self.assertEqual(usage.total_tokens, 1750)

    def test_supplied_wrong_total_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            valid_usage(total_tokens=9999)

    def test_negative_token_rejected(self) -> None:
        for field in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    valid_usage(**{field: -1})

    def test_non_integer_token_rejected(self) -> None:
        with self.assertRaises(ValueError):
            valid_usage(input_tokens=100.5)  # type: ignore[arg-type]

    def test_required_source_time_provider_identity(self) -> None:
        with self.assertRaises(ValueError):
            valid_usage(provider_id="")
        with self.assertRaises(ValueError):
            valid_usage(usage_id="")
        with self.assertRaises(ValueError):
            valid_usage(observed_at="2026-08-09T10:00:00Z")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            valid_usage(source="not-a-source-tag")  # type: ignore[arg-type]

    def test_rejects_missing_source(self) -> None:
        with self.assertRaises(ValueError):
            valid_usage(source=None)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
