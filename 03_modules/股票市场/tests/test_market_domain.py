from __future__ import annotations

from dataclasses import fields
from decimal import Decimal
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.adapters import MarketDataAdapter  # noqa: E402
from nexa_market.domain import (  # noqa: E402
    AIResearchResult,
    AssetType,
    MarketQuote,
    Position,
    QuoteAvailability,
    RiskAlert,
    WatchlistItem,
    WatchlistPriority,
)
from nexa_market.fixtures import (  # noqa: E402
    AI_RESEARCH_RESULT,
    A_SHARE,
    CURRENCY_MISMATCH_QUOTE,
    DELAYED_HK_QUOTE,
    ETF,
    FUNDAMENTAL_SUMMARY,
    HISTORICAL_OBSERVATION,
    HK_SHARE,
    INDEX,
    LOSS_POSITION,
    MARKET_EVENT,
    NEWS_RELATION,
    NOW,
    PROFIT_POSITION,
    RISK_ALERT,
    SAME_SYMBOL_XNAS,
    SAME_SYMBOL_XNYS,
    UNAVAILABLE_QUOTE,
    US_QUOTE,
    US_SHARE,
    ZERO_COST_POSITION,
    ZERO_POSITION,
)
from nexa_market.pnl import PnLReason, PnLStatus, calculate_unrealized_pnl  # noqa: E402


class IdentityTests(unittest.TestCase):
    def test_supported_asset_classes_exist(self) -> None:
        self.assertEqual({AssetType.STOCK, AssetType.ETF, AssetType.INDEX}, set(AssetType))
        self.assertEqual(AssetType.STOCK, A_SHARE.asset_type)
        self.assertEqual(AssetType.STOCK, HK_SHARE.asset_type)
        self.assertEqual(AssetType.ETF, ETF.asset_type)
        self.assertEqual(AssetType.INDEX, INDEX.asset_type)

    def test_same_symbol_different_exchange_remains_distinct(self) -> None:
        self.assertEqual(SAME_SYMBOL_XNAS.symbol, SAME_SYMBOL_XNYS.symbol)
        self.assertNotEqual(SAME_SYMBOL_XNAS.exchange, SAME_SYMBOL_XNYS.exchange)
        self.assertNotEqual(SAME_SYMBOL_XNAS.instrument_id, SAME_SYMBOL_XNYS.instrument_id)
        self.assertNotEqual(SAME_SYMBOL_XNAS.listing_key, SAME_SYMBOL_XNYS.listing_key)

    def test_instrument_id_is_explicit_and_stable(self) -> None:
        self.assertEqual("US.XNAS.NEXA", US_SHARE.instrument_id)
        self.assertNotEqual(US_SHARE.symbol, US_SHARE.instrument_id)

    def test_watchlist_and_position_are_decoupled(self) -> None:
        item = WatchlistItem(US_SHARE, NOW, ("review",), priority=WatchlistPriority.HIGH)
        self.assertIsInstance(item.instrument, type(US_SHARE))
        self.assertNotIn("quantity", {item.name for item in fields(WatchlistItem)})
        self.assertNotIn("instrument", {item.name for item in fields(Position)})
        self.assertEqual(US_SHARE.instrument_id, PROFIT_POSITION.instrument_id)


class QuoteTests(unittest.TestCase):
    def test_missing_values_are_none_not_zero(self) -> None:
        self.assertIsNone(UNAVAILABLE_QUOTE.price)
        self.assertIsNone(UNAVAILABLE_QUOTE.volume)
        self.assertEqual(QuoteAvailability.UNAVAILABLE, UNAVAILABLE_QUOTE.availability)
        self.assertIn("price", UNAVAILABLE_QUOTE.missing_fields)

    def test_quote_trace_and_timestamp_are_explicit(self) -> None:
        self.assertEqual(US_QUOTE.source, US_QUOTE.provenance.source)
        self.assertIsNotNone(US_QUOTE.timestamp.utcoffset())
        self.assertEqual("USD", US_QUOTE.currency)
        self.assertEqual("REAL_TIME", US_QUOTE.data_delay.kind.value)

    def test_delayed_quote_has_positive_delay(self) -> None:
        self.assertEqual("DELAYED", DELAYED_HK_QUOTE.data_delay.kind.value)
        self.assertEqual(900, DELAYED_HK_QUOTE.data_delay.seconds)
        self.assertEqual("DELAYED", DELAYED_HK_QUOTE.provenance.freshness.value)

    def test_unavailable_quote_cannot_smuggle_price(self) -> None:
        values = {field.name: getattr(UNAVAILABLE_QUOTE, field.name) for field in fields(MarketQuote)}
        values["price"] = Decimal("1")
        with self.assertRaises(ValueError):
            MarketQuote(**values)


class PnLTests(unittest.TestCase):
    def test_profit(self) -> None:
        result = calculate_unrealized_pnl(PROFIT_POSITION, US_QUOTE)
        self.assertEqual(PnLStatus.AVAILABLE, result.status)
        self.assertEqual(Decimal("1200.00"), result.market_value)
        self.assertEqual(Decimal("1000.00"), result.cost_basis)
        self.assertEqual(Decimal("200.00"), result.unrealized_pnl)
        self.assertEqual(Decimal("20.00"), result.unrealized_pnl_percent)

    def test_loss(self) -> None:
        result = calculate_unrealized_pnl(LOSS_POSITION, US_QUOTE)
        self.assertEqual(Decimal("-200.00"), result.unrealized_pnl)
        self.assertEqual(Decimal("-14.29"), result.unrealized_pnl_percent)

    def test_zero_quantity_is_explicitly_incomplete(self) -> None:
        result = calculate_unrealized_pnl(ZERO_POSITION, US_QUOTE)
        self.assertEqual(PnLStatus.INCOMPLETE, result.status)
        self.assertEqual(PnLReason.ZERO_QUANTITY, result.reason)
        self.assertEqual(Decimal("0.00"), result.market_value)
        self.assertIsNone(result.unrealized_pnl_percent)

    def test_zero_cost_is_explicitly_incomplete(self) -> None:
        result = calculate_unrealized_pnl(ZERO_COST_POSITION, US_QUOTE)
        self.assertEqual(PnLStatus.INCOMPLETE, result.status)
        self.assertEqual(PnLReason.ZERO_COST_BASIS, result.reason)
        self.assertIsNone(result.unrealized_pnl_percent)

    def test_missing_quote_is_unavailable(self) -> None:
        for missing in (None, UNAVAILABLE_QUOTE):
            result = calculate_unrealized_pnl(PROFIT_POSITION, missing)
            self.assertEqual(PnLStatus.UNAVAILABLE, result.status)
            self.assertEqual(PnLReason.QUOTE_MISSING, result.reason)
            self.assertIsNone(result.market_value)

    def test_currency_mismatch_is_error(self) -> None:
        result = calculate_unrealized_pnl(PROFIT_POSITION, CURRENCY_MISMATCH_QUOTE)
        self.assertEqual(PnLStatus.ERROR, result.status)
        self.assertEqual(PnLReason.CURRENCY_MISMATCH, result.reason)
        self.assertIsNone(result.unrealized_pnl)

    def test_instrument_mismatch_is_error(self) -> None:
        mismatched_position = Position(
            position_id="position.other",
            instrument_id=ETF.instrument_id,
            quantity=Decimal("1"),
            average_cost=Decimal("100"),
            currency="USD",
            recorded_at=NOW,
        )
        result = calculate_unrealized_pnl(mismatched_position, US_QUOTE)
        self.assertEqual(PnLStatus.ERROR, result.status)
        self.assertEqual(PnLReason.INSTRUMENT_MISMATCH, result.reason)

    def test_negative_position_values_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Position(
                position_id="position.invalid",
                instrument_id=US_SHARE.instrument_id,
                quantity=Decimal("-1"),
                average_cost=Decimal("100"),
                currency="USD",
                recorded_at=NOW,
            )


class ResearchAndSafetyTests(unittest.TestCase):
    def test_structured_fixtures_are_traceable(self) -> None:
        objects = (
            MARKET_EVENT,
            FUNDAMENTAL_SUMMARY,
            RISK_ALERT,
            AI_RESEARCH_RESULT,
            HISTORICAL_OBSERVATION,
        )
        for item in objects:
            self.assertTrue(item.provenance.source)
            self.assertTrue(item.provenance.transform_version)
        self.assertEqual(MARKET_EVENT.event_id, NEWS_RELATION.event_id)

    def test_research_requires_evidence(self) -> None:
        values = {field.name: getattr(AI_RESEARCH_RESULT, field.name) for field in fields(AIResearchResult)}
        values["evidence_refs"] = ()
        with self.assertRaises(ValueError):
            AIResearchResult(**values)

    def test_risk_and_research_have_no_execution_contract(self) -> None:
        forbidden = {"buy", "sell", "execute", "order", "broker", "account", "token", "payment", "transfer"}
        risk_fields = {field.name.casefold() for field in fields(RiskAlert)}
        research_fields = {field.name.casefold() for field in fields(AIResearchResult)}
        self.assertFalse(forbidden & risk_fields)
        self.assertFalse(forbidden & research_fields)

    def test_adapter_port_is_read_only_and_provider_neutral(self) -> None:
        expected = {
            "resolve_instrument",
            "get_quote",
            "get_quotes",
            "get_historical_prices",
            "get_fundamentals",
        }
        methods = {name for name in MarketDataAdapter.__dict__ if not name.startswith("_")}
        self.assertEqual(expected, methods)

    def test_core_has_no_provider_sdk_import_or_trading_vocabulary(self) -> None:
        source_files = [
            MODULE_ROOT / "nexa_market" / "domain.py",
            MODULE_ROOT / "nexa_market" / "pnl.py",
            MODULE_ROOT / "nexa_market" / "adapters.py",
        ]
        forbidden_import_markers = ("import requests", "import httpx", "import yfinance", "from yfinance")
        forbidden_contract_markers = ("submit_order", "broker_login", "api_token", "fund_transfer")
        combined = "\n".join(path.read_text(encoding="utf-8").casefold() for path in source_files)
        self.assertFalse(any(marker in combined for marker in forbidden_import_markers))
        self.assertFalse(any(marker in combined for marker in forbidden_contract_markers))


if __name__ == "__main__":
    unittest.main()

