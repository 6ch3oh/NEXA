from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest
from urllib.parse import unquote, urlsplit


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
RAW_ROOT = MODULE_ROOT / "tests" / "raw_fixtures" / "yahoo_chart"

from nexa_market.adapters import (  # noqa: E402
    AdapterError,
    AdapterFailureCode,
    AdapterOperation,
    InstrumentQuery,
    MarketDataAdapter,
)
from nexa_market.domain import (  # noqa: E402
    AssetType,
    DelayKind,
    MarketStatus,
    QuoteAvailability,
)
from nexa_market.providers.yahoo_chart import (  # noqa: E402
    YahooChartAdapter,
    YahooChartBinding,
)


NOW = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)


def raw_fixture(name: str) -> dict:
    return json.loads((RAW_ROOT / f"{name}.json").read_text(encoding="utf-8"))


def binding(
    provider_symbol: str,
    *,
    exchange: str = "NMS",
    asset_type: AssetType = AssetType.STOCK,
    instrument_id: str | None = None,
    symbol: str | None = None,
    instrument_currency: str = "USD",
) -> YahooChartBinding:
    return YahooChartBinding(
        instrument_id=instrument_id or f"US.{exchange}.{provider_symbol}",
        provider_symbol=provider_symbol,
        symbol=symbol or provider_symbol,
        exchange=exchange,
        market="US",
        asset_type=asset_type,
        display_name=f"{provider_symbol} fixture",
        instrument_currency=instrument_currency,
    )


class SingleResponseTransport:
    def __init__(self, response=None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[tuple[str, float]] = []

    def get_json(self, url: str, timeout_seconds: float):
        self.calls.append((url, timeout_seconds))
        if self.error is not None:
            raise self.error
        return deepcopy(self.response)


class SymbolResponseTransport:
    def __init__(self, responses: dict[str, dict]) -> None:
        self.responses = responses

    def get_json(self, url: str, timeout_seconds: float):
        provider_symbol = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
        return deepcopy(self.responses[provider_symbol])


def adapter_for(raw: dict, item: YahooChartBinding) -> YahooChartAdapter:
    return YahooChartAdapter((item,), transport=SingleResponseTransport(raw), clock=lambda: NOW)


class NormalizationTests(unittest.TestCase):
    def test_normal_stock_quote_maps_real_schema(self) -> None:
        item = binding("AAPL")
        quote = adapter_for(raw_fixture("normal_stock_quote"), item).get_quote(item.instrument_id)
        self.assertEqual(item.instrument_id, quote.instrument_id)
        self.assertEqual(Decimal("313.33"), quote.price)
        self.assertEqual(Decimal("311.45"), quote.open)
        self.assertEqual(Decimal("314.81"), quote.high)
        self.assertEqual(Decimal("310.74"), quote.low)
        self.assertEqual(Decimal("310.71"), quote.previous_close)
        self.assertEqual(Decimal("34407100"), quote.volume)
        self.assertIsNone(quote.change)
        self.assertIsNone(quote.change_percent)
        self.assertIsNone(quote.amount)
        self.assertEqual(QuoteAvailability.PARTIAL, quote.availability)

    def test_non_stock_etf_mapping(self) -> None:
        item = binding("SPY", exchange="PCX", asset_type=AssetType.ETF)
        adapter = adapter_for(raw_fixture("non_stock_quote"), item)
        instrument = adapter.resolve_instrument(InstrumentQuery("SPY", exchange="PCX"))[0]
        quote = adapter.get_quote(item.instrument_id)
        self.assertEqual(AssetType.ETF, instrument.asset_type)
        self.assertEqual(item.instrument_id, quote.instrument_id)

    def test_missing_fields_stay_none_and_are_named(self) -> None:
        item = binding("MISS")
        quote = adapter_for(raw_fixture("missing_fields"), item).get_quote(item.instrument_id)
        self.assertEqual(Decimal("42.50"), quote.price)
        for field_name in ("open", "high", "low", "previous_close", "volume", "amount"):
            self.assertIsNone(getattr(quote, field_name))
            self.assertIn(field_name, quote.missing_fields)
        self.assertNotEqual(Decimal("0"), quote.price)

    def test_unknown_currency_is_explicit_failure(self) -> None:
        item = binding("NOCUR")
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture("unknown_currency"), item).get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.UNKNOWN_CURRENCY, context.exception.failure.code)

    def test_quote_currency_can_explicitly_differ_from_instrument(self) -> None:
        raw = raw_fixture("normal_stock_quote")
        raw["chart"]["result"][0]["meta"]["currency"] = "EUR"
        item = binding("AAPL", instrument_currency="USD")
        adapter = adapter_for(raw, item)
        instrument = adapter.resolve_instrument(InstrumentQuery("AAPL"))[0]
        quote = adapter.get_quote(item.instrument_id)
        self.assertEqual("USD", instrument.currency)
        self.assertEqual("EUR", quote.currency)
        self.assertNotEqual(instrument.currency, quote.currency)

    def test_delayed_quote_never_becomes_realtime(self) -> None:
        item = binding("DELAY", exchange="NYQ")
        quote = adapter_for(raw_fixture("delayed_quote"), item).get_quote(item.instrument_id)
        self.assertEqual(DelayKind.DELAYED, quote.data_delay.kind)
        self.assertEqual(900, quote.data_delay.seconds)
        self.assertEqual(MarketStatus.CLOSED, quote.market_status)

    def test_absent_delay_and_market_state_remain_unknown(self) -> None:
        item = binding("AAPL")
        quote = adapter_for(raw_fixture("normal_stock_quote"), item).get_quote(item.instrument_id)
        self.assertEqual(DelayKind.UNKNOWN, quote.data_delay.kind)
        self.assertIsNone(quote.data_delay.seconds)
        self.assertEqual(MarketStatus.UNKNOWN, quote.market_status)

    def test_timestamp_is_utc_instant_and_retrieval_is_distinct(self) -> None:
        item = binding("AAPL")
        quote = adapter_for(raw_fixture("normal_stock_quote"), item).get_quote(item.instrument_id)
        expected = datetime.fromtimestamp(1786132801, tz=timezone.utc)
        self.assertEqual(expected, quote.timestamp)
        self.assertEqual(expected, quote.provenance.source_timestamp)
        self.assertEqual(NOW, quote.provenance.retrieved_at)
        self.assertNotEqual(quote.provenance.retrieved_at, quote.provenance.source_timestamp)

    def test_dst_edge_uses_epoch_not_ambiguous_local_text(self) -> None:
        item = binding("DST")
        quote = adapter_for(raw_fixture("timestamp_edge_case"), item).get_quote(item.instrument_id)
        self.assertEqual(datetime(2024, 11, 3, 5, 30, tzinfo=timezone.utc), quote.timestamp)
        self.assertIsNotNone(quote.timestamp.utcoffset())

    def test_provenance_retains_provider_reference_and_transform(self) -> None:
        item = binding("AAPL")
        quote = adapter_for(raw_fixture("normal_stock_quote"), item).get_quote(item.instrument_id)
        self.assertEqual("yahoo-finance-chart", quote.source)
        self.assertEqual(quote.source, quote.provenance.source)
        self.assertEqual("yahoo-chart-v1", quote.provenance.transform_version)
        self.assertIn("/AAPL?", quote.provenance.raw_reference)

    def test_historical_prices_use_timestamped_close_contract(self) -> None:
        item = binding("AAPL")
        points = adapter_for(raw_fixture("normal_stock_quote"), item).get_historical_prices(
            item.instrument_id,
            datetime(2026, 8, 7, tzinfo=timezone.utc),
            datetime(2026, 8, 8, tzinfo=timezone.utc),
        )
        self.assertEqual(1, len(points))
        self.assertEqual(Decimal("313.33"), points[0].close)
        self.assertEqual("USD", points[0].currency)
        self.assertIsNotNone(points[0].timestamp.utcoffset())


class IdentityTests(unittest.TestCase):
    def test_same_symbol_different_exchange_is_not_merged(self) -> None:
        first_raw = raw_fixture("normal_stock_quote")
        first_raw["chart"]["result"][0]["meta"].update({"symbol": "DUP-NMS", "exchangeName": "NMS"})
        second_raw = raw_fixture("normal_stock_quote")
        second_raw["chart"]["result"][0]["meta"].update({"symbol": "DUP-NYQ", "exchangeName": "NYQ"})
        first = binding("DUP-NMS", instrument_id="US.NMS.DUP", symbol="DUP", exchange="NMS")
        second = binding("DUP-NYQ", instrument_id="US.NYQ.DUP", symbol="DUP", exchange="NYQ")
        adapter = YahooChartAdapter(
            (first, second),
            transport=SymbolResponseTransport({"DUP-NMS": first_raw, "DUP-NYQ": second_raw}),
            clock=lambda: NOW,
        )
        both = adapter.resolve_instrument(InstrumentQuery("DUP"))
        self.assertEqual(2, len(both))
        self.assertEqual({"US.NMS.DUP", "US.NYQ.DUP"}, {item.instrument_id for item in both})
        self.assertNotEqual(both[0].listing_key, both[1].listing_key)
        only_nyq = adapter.resolve_instrument(InstrumentQuery("DUP", exchange="NYQ"))
        self.assertEqual(("NYQ", "DUP"), only_nyq[0].listing_key)

    def test_wrong_raw_identity_fails_explicitly(self) -> None:
        item = binding("SPY", exchange="PCX", asset_type=AssetType.ETF)
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture("normal_stock_quote"), item).get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.INVALID_DATA, context.exception.failure.code)


class InvalidDataTests(unittest.TestCase):
    def test_negative_price_is_invalid_data(self) -> None:
        item = binding("BADNUM")
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture("invalid_numeric"), item).get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.INVALID_DATA, context.exception.failure.code)

    def test_non_epoch_timestamp_is_invalid_data(self) -> None:
        item = binding("BADTIME")
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture("invalid_timestamp"), item).get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.INVALID_DATA, context.exception.failure.code)

    def test_malformed_payload_has_stable_failure(self) -> None:
        item = binding("MALFORM")
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture("malformed_payload"), item).get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.MALFORMED_RESPONSE, context.exception.failure.code)


class FailureNormalizationTests(unittest.TestCase):
    def assert_failure(self, fixture_name: str, symbol: str, expected: AdapterFailureCode) -> None:
        item = binding(symbol)
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture(fixture_name), item).get_quote(item.instrument_id)
        self.assertEqual(expected, context.exception.failure.code)
        self.assertEqual(AdapterOperation.GET_QUOTE, context.exception.failure.operation)
        self.assertEqual("yahoo-finance-chart", context.exception.failure.provider)

    def test_symbol_not_found(self) -> None:
        self.assert_failure("symbol_not_found", "NOTFOUND", AdapterFailureCode.SYMBOL_NOT_FOUND)

    def test_provider_error(self) -> None:
        self.assert_failure("provider_error", "ERR", AdapterFailureCode.PROVIDER_ERROR)

    def test_empty_result(self) -> None:
        self.assert_failure("empty_result", "EMPTY", AdapterFailureCode.EMPTY_RESULT)

    def test_timeout_is_retryable_and_raw_exception_does_not_leak(self) -> None:
        item = binding("AAPL")
        adapter = YahooChartAdapter(
            (item,),
            transport=SingleResponseTransport(error=TimeoutError("raw timeout detail")),
            clock=lambda: NOW,
        )
        with self.assertRaises(AdapterError) as context:
            adapter.get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.TIMEOUT, context.exception.failure.code)
        self.assertTrue(context.exception.failure.retryable)
        self.assertNotIn("raw timeout detail", str(context.exception))

    def test_transport_failure_is_normalized(self) -> None:
        item = binding("AAPL")
        adapter = YahooChartAdapter(
            (item,),
            transport=SingleResponseTransport(error=OSError("socket internals")),
            clock=lambda: NOW,
        )
        with self.assertRaises(AdapterError) as context:
            adapter.get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.TRANSPORT, context.exception.failure.code)
        self.assertNotIn("socket internals", str(context.exception))

    def test_json_decode_failure_is_normalized(self) -> None:
        item = binding("AAPL")
        adapter = YahooChartAdapter(
            (item,),
            transport=SingleResponseTransport(error=json.JSONDecodeError("bad", "{", 1)),
            clock=lambda: NOW,
        )
        with self.assertRaises(AdapterError) as context:
            adapter.get_quote(item.instrument_id)
        self.assertEqual(AdapterFailureCode.MALFORMED_RESPONSE, context.exception.failure.code)

    def test_unsupported_fundamentals_is_stable(self) -> None:
        item = binding("AAPL")
        with self.assertRaises(AdapterError) as context:
            adapter_for(raw_fixture("normal_stock_quote"), item).get_fundamentals(item.instrument_id)
        self.assertEqual(AdapterFailureCode.UNSUPPORTED_CAPABILITY, context.exception.failure.code)


class BoundaryTests(unittest.TestCase):
    def test_adapter_satisfies_provider_neutral_protocol(self) -> None:
        item = binding("AAPL")
        adapter = adapter_for(raw_fixture("normal_stock_quote"), item)
        self.assertIsInstance(adapter, MarketDataAdapter)

    def test_required_raw_fixtures_exist_and_parse(self) -> None:
        required = {
            "normal_stock_quote",
            "non_stock_quote",
            "missing_fields",
            "delayed_quote",
            "malformed_payload",
            "symbol_not_found",
            "unknown_currency",
            "timestamp_edge_case",
        }
        available = {path.stem for path in RAW_ROOT.glob("*.json")}
        self.assertTrue(required <= available)
        for name in available:
            self.assertIsInstance(raw_fixture(name), dict)

    def test_core_domain_does_not_depend_on_temporary_provider(self) -> None:
        core = "\n".join(
            (MODULE_ROOT / "nexa_market" / name).read_text(encoding="utf-8").casefold()
            for name in ("domain.py", "pnl.py", "adapters.py")
        )
        self.assertNotIn("yahoo", core)
        self.assertNotIn("query1.finance", core)

    def test_provider_transport_is_get_only_and_has_no_credentials(self) -> None:
        source = (MODULE_ROOT / "nexa_market" / "providers" / "yahoo_chart.py").read_text(encoding="utf-8").casefold()
        self.assertIn('method="get"', source)
        for forbidden in ("apikey", "api_key", "authorization", "cookie", "submit_order", "broker_login", "fund_transfer"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
