from __future__ import annotations

import unittest
from datetime import datetime, timezone
from decimal import Decimal

from src.adapters import (
    balance_from_legacy,
    cost_from_legacy,
    legacy_source_tag,
    legacy_usage_tokens,
    pricing_from_legacy,
    provider_from_legacy,
    token_from_legacy,
)
from src.contracts import (
    BalanceUnit,
    CostKind,
    PriceDimension,
    PricingUnit,
    ProviderCategory,
    ProviderStatus,
    SourceType,
    TokenStatus,
)
from tests.fixtures.legacy_token_monitor_fixtures import (
    FAKE_SHA256,
    credential_metadata_configured,
    credential_metadata_unconfigured,
    custom_pricing_rows,
    deepseek_provider_not_configured,
    deepseek_provider_ok,
    plaintext_secret_value_record,
    provider_credits_window_only,
    raw_secret_field_record,
    usage_only_row,
    usage_token_components_row,
    usage_with_cost_row,
)


class TestLegacyProviderAdapter(unittest.TestCase):
    def test_deepseek_ok_maps_to_provider(self) -> None:
        provider = provider_from_legacy(deepseek_provider_ok())
        self.assertEqual(provider.key, "deepseek")
        self.assertEqual(provider.display_name, "Pay-as-you-go")
        self.assertEqual(provider.status, ProviderStatus.ACTIVE)
        self.assertEqual(provider.category, ProviderCategory.OTHER)
        self.assertTrue(provider.id.startswith("legacy:deepseek:sha256:"))
        self.assertEqual(provider.source.source_type, SourceType.LEGACY_IMPORT)

    def test_status_mapping(self) -> None:
        cases = {
            "ok": ProviderStatus.ACTIVE,
            "rateLimited": ProviderStatus.ACTIVE,
            "sourceRateLimited": ProviderStatus.ACTIVE,
            "disabled": ProviderStatus.DISABLED,
            "notConfigured": ProviderStatus.INACTIVE,
            "unauthorized": ProviderStatus.INACTIVE,
            "unavailable": ProviderStatus.INACTIVE,
            "error": ProviderStatus.INACTIVE,
        }
        for legacy_status, expected in cases.items():
            with self.subTest(status=legacy_status):
                provider = provider_from_legacy({
                    "provider": "deepseek",
                    "status": legacy_status,
                    "source": "api",
                    "updatedAt": "2026-06-07T10:00:00Z",
                    "windows": [],
                })
                self.assertEqual(provider.status, expected)

    def test_rejects_invalid_status(self) -> None:
        with self.assertRaises(ValueError):
            provider_from_legacy({
                "provider": "deepseek",
                "status": "unknown-status",
                "windows": [],
            })

    def test_rejects_unknown_provider(self) -> None:
        with self.assertRaises(ValueError):
            provider_from_legacy({"provider": "not-a-provider", "status": "ok", "windows": []})

    def test_normalizes_sha256_account_fingerprint_to_lowercase(self) -> None:
        record = deepseek_provider_ok()
        record["accountKey"] = FAKE_SHA256.upper()
        provider = provider_from_legacy(record)
        self.assertTrue(provider.id.endswith(FAKE_SHA256))


class TestLegacyTokenAdapter(unittest.TestCase):
    def test_configured_metadata_maps_to_token(self) -> None:
        token = token_from_legacy(credential_metadata_configured())
        self.assertIsNotNone(token)
        self.assertEqual(token.provider_id, provider_from_legacy(deepseek_provider_ok()).id)
        self.assertEqual(token.label, "Pay-as-you-go")
        self.assertEqual(token.status, TokenStatus.ACTIVE)
        self.assertTrue(token.masked_identifier.startswith("fp:sha256:"))
        self.assertEqual(token.secret_ref, None)

    def test_unconfigured_metadata_has_no_token(self) -> None:
        self.assertIsNone(token_from_legacy(credential_metadata_unconfigured()))

    def test_derives_configured_from_status(self) -> None:
        ok_token = token_from_legacy(deepseek_provider_ok())
        self.assertIsNotNone(ok_token)
        not_configured = token_from_legacy(deepseek_provider_not_configured())
        self.assertIsNone(not_configured)

    def test_token_rejects_raw_secret_field(self) -> None:
        with self.assertRaises(ValueError):
            token_from_legacy(raw_secret_field_record())

    def test_token_rejects_plaintext_account_key(self) -> None:
        with self.assertRaises(ValueError):
            token_from_legacy(plaintext_secret_value_record())

    def test_token_accepts_normalized_sha256_account_fingerprint(self) -> None:
        record = credential_metadata_configured()
        record["accountKey"] = FAKE_SHA256.upper()
        token = token_from_legacy(record)
        self.assertIsNotNone(token)
        self.assertEqual(token.masked_identifier, "fp:" + FAKE_SHA256)


class TestLegacyBalanceAdapter(unittest.TestCase):
    def test_deepseek_balance_block(self) -> None:
        snapshot = balance_from_legacy(deepseek_provider_ok())
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot.provider_id, provider_from_legacy(deepseek_provider_ok()).id)
        self.assertEqual(snapshot.value, Decimal("4.61"))
        self.assertEqual(snapshot.unit, BalanceUnit.CNY)
        self.assertEqual(
            snapshot.observed_at,
            datetime(2026, 6, 7, 10, 0, tzinfo=timezone.utc),
        )

    def test_credits_window_fallback(self) -> None:
        snapshot = balance_from_legacy(provider_credits_window_only())
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot.value, Decimal("12.5"))
        self.assertEqual(snapshot.unit, BalanceUnit.USD)

    def test_no_balance_yields_none(self) -> None:
        self.assertIsNone(balance_from_legacy(deepseek_provider_not_configured()))

    def test_balance_without_timestamp_is_rejected(self) -> None:
        record = {
            "provider": "deepseek",
            "status": "ok",
            "windows": [],
            "balance": {"amount": 4.61, "currency": "CNY"},
        }
        with self.assertRaises(ValueError):
            balance_from_legacy(record)


class TestLegacyPricingAdapter(unittest.TestCase):
    def test_custom_pricing_rows_map_to_snapshots(self) -> None:
        snapshots = pricing_from_legacy(
            custom_pricing_rows(),
            provider_id="legacy:deepseek",
            currency="USD",
            effective_at=datetime(2026, 8, 9, tzinfo=timezone.utc),
        )
        by_model = {}
        for snap in snapshots:
            by_model.setdefault(snap.model, []).append(snap)

        chat = {s.price_dimension: s for s in by_model["deepseek-chat"]}
        self.assertEqual(chat[PriceDimension.INPUT].price_per_unit, Decimal("0.4"))
        self.assertEqual(chat[PriceDimension.OUTPUT].price_per_unit, Decimal("0.8"))
        self.assertEqual(chat[PriceDimension.CACHE_READ].price_per_unit, Decimal("0.003"))
        self.assertEqual(
            {snapshot.unit for snapshot in by_model["deepseek-chat"]},
            {PricingUnit.PER_1M_TOKENS},
        )
        self.assertEqual(len(by_model["deepseek-chat"]), 3)
        self.assertEqual(len(by_model["deepseek-reasoner"]), 1)
        self.assertEqual(by_model["free-input"][0].price_per_unit, Decimal("0"))
        self.assertNotIn("invalid-row", by_model)
        self.assertNotIn("", by_model)

    def test_pricing_uses_per_million_unit(self) -> None:
        snapshots = pricing_from_legacy(
            [{"modelId": "m", "outputPerM": 0.8}],
            provider_id="legacy:deepseek",
        )
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].unit, PricingUnit.PER_1M_TOKENS)
        self.assertEqual(snapshots[0].currency, "USD")
        self.assertEqual(snapshots[0].provider_id, "legacy:deepseek")


class TestLegacyUsageCostAdapter(unittest.TestCase):
    def test_usage_only_input_has_no_cost(self) -> None:
        self.assertIsNone(cost_from_legacy(usage_only_row(), provider_id="legacy:codex"))

    def test_explicit_cost_converts_to_cost_record(self) -> None:
        cost = cost_from_legacy(usage_with_cost_row(), provider_id="legacy:codex")
        self.assertIsNotNone(cost)
        self.assertEqual(cost.amount, Decimal("0.12"))
        self.assertEqual(cost.currency, "USD")
        self.assertEqual(cost.cost_basis, "legacy:costUsd")
        self.assertEqual(cost.kind, CostKind.ACTUAL)
        self.assertEqual(cost.model, "gpt-5")
        self.assertEqual(
            cost.occurred_at,
            datetime(2026, 8, 9, 10, 0, tzinfo=timezone.utc),
        )

    def test_token_count_stays_separate(self) -> None:
        self.assertEqual(legacy_usage_tokens(usage_with_cost_row()), 1500)
        self.assertEqual(legacy_usage_tokens(usage_token_components_row()), 1750)
        self.assertEqual(legacy_usage_tokens(usage_only_row()), 1500)

    def test_cost_requires_a_timestamp(self) -> None:
        row = {"client": "codex", "costUsd": 0.12}
        with self.assertRaises(ValueError):
            cost_from_legacy(row, provider_id="legacy:codex")

    def test_generic_cost_and_total_cost_fail_closed(self) -> None:
        for key in ("cost", "totalCost", "total_cost"):
            with self.subTest(key=key):
                row = {
                    "client": "codex",
                    "model": "gpt-5",
                    "lastUsedAt": "2026-08-09T10:00:00Z",
                    key: 0.12,
                }
                self.assertIsNone(cost_from_legacy(row, provider_id="legacy:codex"))


class TestLegacySourceTag(unittest.TestCase):
    def test_marks_legacy_import_and_keeps_provenance(self) -> None:
        tag = legacy_source_tag(
            deepseek_provider_ok(),
            location="src/shared/limits.js:normalizeLimitProvider",
        )
        self.assertEqual(tag.source_type, SourceType.LEGACY_IMPORT)
        self.assertIn("legacy:token-monitor", tag.source_reference)
        self.assertIn("provider=deepseek", tag.source_reference)
        self.assertIn("source=api", tag.source_reference)
        self.assertIn("sourceDetail=app", tag.source_reference)
        self.assertEqual(tag.captured_at, datetime(2026, 6, 7, 10, 0, tzinfo=timezone.utc))

    def test_source_tag_is_attached_to_mapped_contracts(self) -> None:
        provider = provider_from_legacy(deepseek_provider_ok())
        snapshot = balance_from_legacy(deepseek_provider_ok())
        self.assertEqual(provider.source.source_type, SourceType.LEGACY_IMPORT)
        self.assertEqual(snapshot.source.source_type, SourceType.LEGACY_IMPORT)


class TestLegacySecurity(unittest.TestCase):
    def test_raw_secret_fields_never_enter_output(self) -> None:
        for fn in (provider_from_legacy, token_from_legacy, balance_from_legacy):
            with self.assertRaises(ValueError):
                fn(raw_secret_field_record())

    def test_plaintext_secret_values_rejected(self) -> None:
        with self.assertRaises(ValueError):
            provider_from_legacy(plaintext_secret_value_record())


class TestLegacyInvalidInputs(unittest.TestCase):
    def test_non_dict_record_rejected(self) -> None:
        for fn in (provider_from_legacy, token_from_legacy, balance_from_legacy):
            with self.assertRaises(ValueError):
                fn("not-a-dict")  # type: ignore[arg-type]

    def test_unknown_legacy_status_rejected(self) -> None:
        record = {
            "provider": "deepseek",
            "status": "mystery",
            "source": "api",
            "windows": [],
        }
        with self.assertRaises(ValueError):
            provider_from_legacy(record)
        with self.assertRaises(ValueError):
            token_from_legacy(record)

    def test_missing_provider_rejected(self) -> None:
        with self.assertRaises(ValueError):
            provider_from_legacy({"status": "ok", "windows": []})


if __name__ == "__main__":
    unittest.main()
