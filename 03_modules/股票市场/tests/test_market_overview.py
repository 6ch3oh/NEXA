from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
import json
from pathlib import Path
import sys
import tempfile
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.domain import (  # noqa: E402
    AlertStatus,
    DataDelay,
    DelayKind,
    Freshness,
    PositionStatus,
    Severity,
    WatchlistPriority,
)
from nexa_market.fixtures import (  # noqa: E402
    AI_RESEARCH_RESULT,
    FUNDAMENTAL_SUMMARY,
    INSTRUMENTS,
    LOSS_POSITION,
    NOW,
    RISK_ALERT,
    SAME_SYMBOL_XNAS,
    SAME_SYMBOL_XNYS,
    US_QUOTE,
    US_SHARE,
    quote,
)
from nexa_market.recovery import RecoveryService  # noqa: E402
from nexa_market.repositories import (  # noqa: E402
    FORMAT_VERSION,
    SCHEMA_VERSION,
    InMemoryObservationRepository,
    InMemoryPositionRepository,
    InMemoryWatchlistRepository,
    LocalObservationRepository,
    LocalPositionRepository,
    LocalWatchlistRepository,
)
from nexa_market.repositories.serialization import serialize_position, serialize_watchlist  # noqa: E402
from nexa_market.state_fixtures import (  # noqa: E402
    CNY_POSITION,
    DELAYED_HK_QUOTE,
    HKD_POSITION,
    KNOWN_INSTRUMENTS,
    MULTI_CURRENCY_POSITIONS,
    MULTI_CURRENCY_QUOTES,
    OBSERVATION_HISTORY,
    POSITION_ONLY,
    PROFIT_POSITION,
    WATCHLIST_NORMAL,
)
from nexa_market.viewmodels import MarketOverviewService, serialize_market_overview  # noqa: E402
from nexa_market.viewmodels.models import (  # noqa: E402
    ComponentStatus,
    DataCompleteness,
    FreshnessPresentation,
    OverallStatus,
    OverviewError,
    OverviewErrorCode,
    QuoteHealth,
    QuotePresentationStatus,
    StoreHealth,
    VIEWMODEL_VERSION,
)


class MarketOverviewTestCase(unittest.TestCase):
    def memory_service(self, *, watchlist=(), positions=(), observations=(), instruments=KNOWN_INSTRUMENTS):
        watch_repo = InMemoryWatchlistRepository()
        position_repo = InMemoryPositionRepository()
        observation_repo = InMemoryObservationRepository()
        for item in watchlist:
            self.assertTrue(watch_repo.add(item))
        for item in positions:
            self.assertTrue(position_repo.add(item))
        for item in observations:
            self.assertTrue(observation_repo.add(item))
        return MarketOverviewService(
            watch_repo,
            position_repo,
            observation_repo,
            instruments,
        )

    @staticmethod
    def build(service, **kwargs):
        return service.build(generated_at=NOW, **kwargs)


class EmptyAndPartialStateTests(MarketOverviewTestCase):
    def test_completely_empty_overview_is_not_an_error(self) -> None:
        overview = self.build(self.memory_service())
        self.assertEqual(VIEWMODEL_VERSION, overview.viewmodel_version)
        self.assertEqual(OverallStatus.EMPTY, overview.overall_status)
        self.assertEqual(DataCompleteness.EMPTY, overview.data_completeness)
        self.assertEqual(StoreHealth.NEW_EMPTY, overview.store_health)
        self.assertEqual(QuoteHealth.EMPTY, overview.quote_health)
        self.assertEqual((), overview.instruments)

    def test_watchlist_only_exposes_missing_quote_without_zero(self) -> None:
        overview = self.build(self.memory_service(watchlist=(WATCHLIST_NORMAL,)))
        self.assertEqual(1, overview.watchlist.total_count)
        self.assertEqual(1, overview.watchlist.unavailable_quote_count)
        self.assertEqual(QuotePresentationStatus.UNAVAILABLE, overview.instruments[0].quote_availability)
        self.assertIsNone(overview.instruments[0].quote.price)
        self.assertEqual(OverallStatus.PARTIAL, overview.overall_status)

    def test_portfolio_only_builds_card_and_pnl(self) -> None:
        overview = self.build(self.memory_service(positions=(PROFIT_POSITION,)), quotes=(US_QUOTE,))
        self.assertFalse(overview.instruments[0].watchlist.present)
        self.assertEqual(1, overview.portfolio.active_position_count)
        self.assertEqual("200.00", overview.portfolio.positions[0].pnl.unrealized_pnl)

    def test_watchlist_and_portfolio_aggregate_once(self) -> None:
        overview = self.build(
            self.memory_service(watchlist=(WATCHLIST_NORMAL,), positions=(PROFIT_POSITION,)),
            quotes=(US_QUOTE,),
        )
        self.assertEqual(1, len(overview.instruments))
        card = overview.instruments[0]
        self.assertTrue(card.watchlist.present)
        self.assertIsNotNone(card.active_position)

    def test_observation_without_position_has_timeline(self) -> None:
        overview = self.build(self.memory_service(observations=OBSERVATION_HISTORY))
        self.assertEqual(2, overview.observations.observation_count)
        self.assertIsNone(overview.instruments[0].active_position)
        self.assertEqual(2, len(overview.instruments[0].observation_timeline))

    def test_quote_without_position_creates_read_only_instrument_card(self) -> None:
        overview = self.build(self.memory_service(), quotes=(US_QUOTE,))
        self.assertEqual(1, len(overview.instruments))
        self.assertEqual(0, overview.portfolio.active_position_count)
        self.assertEqual(QuotePresentationStatus.AVAILABLE, overview.instruments[0].quote_availability)

    def test_unavailable_research_component_does_not_remove_portfolio(self) -> None:
        overview = self.build(
            self.memory_service(positions=(PROFIT_POSITION,)),
            quotes=(US_QUOTE,),
            research_results=None,
        )
        self.assertEqual(1, overview.portfolio.active_position_count)
        research_component = next(item for item in overview.component_statuses if item.component == "research")
        self.assertEqual(ComponentStatus.UNAVAILABLE, research_component.status)
        self.assertEqual("COMPONENT_UNAVAILABLE", overview.diagnostics[0].code)


class QuoteAndPortfolioTests(MarketOverviewTestCase):
    def test_profitable_position_reuses_existing_snapshot_pnl(self) -> None:
        overview = self.build(self.memory_service(positions=(PROFIT_POSITION,)), quotes=(US_QUOTE,))
        line = overview.portfolio.positions[0]
        self.assertEqual("AVAILABLE", line.pnl.status)
        self.assertEqual("1200.00", line.pnl.market_value)
        self.assertEqual("1000.00", line.pnl.cost_basis)
        self.assertEqual("20.00", line.pnl.unrealized_pnl_percent)

    def test_losing_position_preserves_negative_pnl(self) -> None:
        overview = self.build(self.memory_service(positions=(LOSS_POSITION,)), quotes=(US_QUOTE,))
        self.assertEqual("-200.00", overview.portfolio.positions[0].pnl.unrealized_pnl)

    def test_missing_quote_is_unavailable(self) -> None:
        overview = self.build(self.memory_service(positions=(PROFIT_POSITION,)))
        self.assertEqual(1, overview.portfolio.unavailable_position_count)
        self.assertEqual("UNAVAILABLE", overview.portfolio.positions[0].pnl.status)
        self.assertEqual(QuotePresentationStatus.UNAVAILABLE, overview.instruments[0].quote_availability)

    def test_delayed_quote_is_never_presented_as_available(self) -> None:
        overview = self.build(self.memory_service(positions=(HKD_POSITION,)), quotes=(DELAYED_HK_QUOTE,))
        card = overview.instruments[0]
        self.assertEqual(QuotePresentationStatus.DELAYED, card.quote_availability)
        self.assertEqual(FreshnessPresentation.DELAYED, card.quote_freshness)
        self.assertEqual(1, overview.portfolio.partial_position_count)

    def test_stale_quote_takes_precedence_over_realtime_delay(self) -> None:
        stale = replace(US_QUOTE, provenance=replace(US_QUOTE.provenance, freshness=Freshness.STALE))
        overview = self.build(self.memory_service(watchlist=(WATCHLIST_NORMAL,)), quotes=(stale,))
        self.assertEqual(QuotePresentationStatus.STALE, overview.instruments[0].quote_availability)
        self.assertEqual(1, overview.watchlist.stale_quote_count)

    def test_unknown_quote_evidence_stays_unknown(self) -> None:
        unknown = replace(
            US_QUOTE,
            data_delay=DataDelay(DelayKind.UNKNOWN),
            provenance=replace(US_QUOTE.provenance, freshness=Freshness.UNKNOWN),
        )
        overview = self.build(self.memory_service(watchlist=(WATCHLIST_NORMAL,)), quotes=(unknown,))
        self.assertEqual(QuotePresentationStatus.UNKNOWN, overview.instruments[0].quote_availability)
        self.assertEqual(FreshnessPresentation.UNKNOWN, overview.instruments[0].quote_freshness)

    def test_multi_currency_never_creates_global_total(self) -> None:
        overview = self.build(
            self.memory_service(positions=MULTI_CURRENCY_POSITIONS),
            quotes=MULTI_CURRENCY_QUOTES,
        )
        self.assertEqual(("CNY", "HKD", "USD"), tuple(item.currency for item in overview.portfolio.currency_buckets))
        self.assertIsNone(overview.portfolio.global_currency)
        self.assertIsNone(overview.portfolio.global_cost_basis)
        self.assertIsNone(overview.portfolio.global_market_value)
        self.assertIsNone(overview.portfolio.global_unrealized_pnl)
        self.assertEqual("PARTIAL", overview.portfolio.overall_completeness)


class ObservationRiskResearchTests(MarketOverviewTestCase):
    def test_observation_timeline_is_chronological_and_latest_is_explicit(self) -> None:
        overview = self.build(self.memory_service(observations=tuple(reversed(OBSERVATION_HISTORY))))
        timeline = overview.instruments[0].observation_timeline
        self.assertLess(timeline[0].observed_at, timeline[1].observed_at)
        self.assertEqual(OBSERVATION_HISTORY[1].observation_id, overview.observations.latest_observations[0].observation_id)
        self.assertEqual(2, next(item.count for item in overview.observations.author_type_summary if item.author_type == "USER"))

    def test_risk_summary_is_severity_ordered_without_trade_command(self) -> None:
        critical = replace(
            RISK_ALERT,
            alert_id="alert.critical",
            severity=Severity.CRITICAL,
            detected_at=NOW + timedelta(minutes=1),
        )
        resolved = replace(RISK_ALERT, alert_id="alert.resolved", status=AlertStatus.RESOLVED)
        overview = self.build(self.memory_service(), risks=(RISK_ALERT, resolved, critical))
        self.assertEqual(2, overview.risks.active_risk_count)
        self.assertEqual("CRITICAL", overview.risks.prioritized_risks[0].severity)
        payload = serialize_market_overview(overview)
        keys = set()

        def collect_keys(value):
            if isinstance(value, dict):
                keys.update(value)
                for nested in value.values():
                    collect_keys(nested)
            elif isinstance(value, list):
                for nested in value:
                    collect_keys(nested)

        collect_keys(payload)
        for forbidden in ("trade_action", "execution_recommendation", "buy", "sell", "hold"):
            self.assertNotIn(forbidden, keys)

    def test_fundamental_summary_consumes_existing_evidence(self) -> None:
        overview = self.build(self.memory_service(), fundamentals=(FUNDAMENTAL_SUMMARY,))
        self.assertEqual(1, overview.fundamentals.available_count)
        card = overview.instruments[0]
        self.assertTrue(card.latest_fundamental.available)
        self.assertEqual("FY2025", card.latest_fundamental.reporting_period)
        self.assertEqual(FreshnessPresentation.DELAYED, card.latest_fundamental.freshness)

    def test_missing_fundamental_is_explicitly_unavailable(self) -> None:
        overview = self.build(self.memory_service(), research_results=(AI_RESEARCH_RESULT,))
        self.assertFalse(overview.instruments[0].latest_fundamental.available)
        self.assertEqual(FreshnessPresentation.UNAVAILABLE, overview.instruments[0].latest_fundamental.freshness)

    def test_ai_research_exposes_evidence_and_information_only_fields(self) -> None:
        overview = self.build(self.memory_service(), research_results=(AI_RESEARCH_RESULT,))
        view = overview.research.latest_research[0]
        self.assertTrue(view.evidence_available)
        self.assertEqual("0.72", view.confidence)
        self.assertEqual(FreshnessPresentation.FRESH, view.freshness)
        self.assertEqual(1, len(view.bullish_factors))
        self.assertEqual(1, len(view.bearish_factors))
        payload = serialize_market_overview(overview)
        self.assertNotIn("trade_action", json.dumps(payload))

    def test_risk_without_research_is_valid_partial_state(self) -> None:
        overview = self.build(self.memory_service(), risks=(RISK_ALERT,))
        self.assertEqual(1, overview.risks.active_risk_count)
        self.assertEqual(0, overview.research.research_count)


class StoreHealthTests(MarketOverviewTestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / "state.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write(self, payload) -> None:
        self.path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_partially_invalid_store_is_visible_and_attention_required(self) -> None:
        invalid = serialize_position(PROFIT_POSITION)
        invalid["origin"] = "BROKER"
        payload = {
            "schema_version": SCHEMA_VERSION,
            "format_version": FORMAT_VERSION,
            "watchlist": [serialize_watchlist(WATCHLIST_NORMAL)],
            "positions": [invalid],
            "observations": [],
        }
        self.write(payload)
        review = RecoveryService(self.path).inspect()
        service = MarketOverviewService(
            LocalWatchlistRepository(self.path),
            LocalPositionRepository(self.path),
            LocalObservationRepository(self.path),
            KNOWN_INSTRUMENTS,
        )
        overview = self.build(service, store_state=review)
        self.assertEqual(StoreHealth.PARTIALLY_INVALID, overview.store_health)
        self.assertEqual(OverallStatus.ATTENTION_REQUIRED, overview.overall_status)
        self.assertTrue(overview.recovery.recovery_required)
        self.assertTrue(overview.recovery.recovery_eligible)
        self.assertEqual(1, overview.recovery.rejected_record_count)
        self.assertEqual(1, overview.recovery.diagnostic_count)
        self.assertIn("INVALID_POSITION_ORIGIN", overview.recovery.diagnostic_summary[0])
        self.assertEqual(1, overview.watchlist.total_count)

    def test_fail_closed_store_health_is_explicit(self) -> None:
        self.path.write_text('{"schema_version":', encoding="utf-8")
        review = RecoveryService(self.path).inspect()
        overview = self.build(self.memory_service(), store_state=review)
        self.assertEqual(StoreHealth.FAIL_CLOSED, overview.store_health)
        self.assertEqual(OverallStatus.FAIL_CLOSED, overview.overall_status)
        self.assertEqual(DataCompleteness.UNAVAILABLE, overview.data_completeness)
        self.assertFalse(overview.recovery.recovery_eligible)
        self.assertEqual("MALFORMED_STORE", overview.diagnostics[0].code)


class DeterminismAndSerializationTests(MarketOverviewTestCase):
    def test_full_populated_overview_aggregates_every_component(self) -> None:
        overview = self.build(
            self.memory_service(
                watchlist=(WATCHLIST_NORMAL,),
                positions=(PROFIT_POSITION,),
                observations=OBSERVATION_HISTORY,
            ),
            quotes=(US_QUOTE,),
            risks=(RISK_ALERT,),
            fundamentals=(FUNDAMENTAL_SUMMARY,),
            research_results=(AI_RESEARCH_RESULT,),
        )
        self.assertEqual(OverallStatus.HEALTHY, overview.overall_status)
        self.assertEqual(1, overview.watchlist.total_count)
        self.assertEqual(1, overview.portfolio.active_position_count)
        self.assertEqual(2, overview.observations.observation_count)
        self.assertEqual(1, overview.risks.active_risk_count)
        self.assertEqual(1, overview.research.research_count)
        self.assertEqual(1, overview.fundamentals.available_count)

    def test_same_symbol_different_exchanges_remain_distinct(self) -> None:
        first = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS)
        second = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNYS)
        overview = self.build(
            self.memory_service(watchlist=(second, first)),
            quotes=(quote(SAME_SYMBOL_XNYS, Decimal("11")), quote(SAME_SYMBOL_XNAS, Decimal("10"))),
        )
        self.assertEqual(2, len(overview.instruments))
        self.assertEqual(
            {SAME_SYMBOL_XNAS.instrument_id, SAME_SYMBOL_XNYS.instrument_id},
            {item.identity.instrument_id for item in overview.instruments},
        )

    def test_watchlist_order_is_priority_then_display_identity(self) -> None:
        high = WATCHLIST_NORMAL
        normal = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNYS, priority=WatchlistPriority.NORMAL)
        low = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS, priority=WatchlistPriority.LOW)
        overview = self.build(self.memory_service(watchlist=(low, normal, high)))
        self.assertEqual(
            (US_SHARE.instrument_id, SAME_SYMBOL_XNYS.instrument_id, SAME_SYMBOL_XNAS.instrument_id),
            tuple(item.instrument_id for item in overview.watchlist.ordered_items),
        )

    def test_position_order_does_not_depend_on_quote_order_or_missing_quote(self) -> None:
        service = self.memory_service(positions=(HKD_POSITION, CNY_POSITION, PROFIT_POSITION))
        first = self.build(service, quotes=(US_QUOTE, DELAYED_HK_QUOTE))
        second = self.build(service, quotes=(DELAYED_HK_QUOTE, US_QUOTE))
        self.assertEqual(
            tuple(item.position_id for item in first.portfolio.positions),
            tuple(item.position_id for item in second.portfolio.positions),
        )

    def test_instrument_position_state_orders_active_before_closed(self) -> None:
        closed = replace(
            PROFIT_POSITION,
            position_id="position.closed",
            status=PositionStatus.CLOSED,
            recorded_at=NOW - timedelta(days=1),
        )
        overview = self.build(
            self.memory_service(positions=(closed, PROFIT_POSITION)),
            quotes=(US_QUOTE,),
        )
        card = overview.instruments[0]
        self.assertEqual(2, card.position_count)
        self.assertEqual(("OPEN", "CLOSED"), tuple(item.status for item in card.positions))

    def test_same_inputs_produce_identical_json_projection(self) -> None:
        service = self.memory_service(
            watchlist=(WATCHLIST_NORMAL,),
            positions=(PROFIT_POSITION,),
            observations=OBSERVATION_HISTORY,
        )
        first = self.build(
            service,
            quotes=(US_QUOTE,),
            risks=(RISK_ALERT,),
            fundamentals=(FUNDAMENTAL_SUMMARY,),
            research_results=(AI_RESEARCH_RESULT,),
        )
        second = self.build(
            service,
            quotes=tuple(reversed((US_QUOTE,))),
            risks=tuple(reversed((RISK_ALERT,))),
            fundamentals=tuple(reversed((FUNDAMENTAL_SUMMARY,))),
            research_results=tuple(reversed((AI_RESEARCH_RESULT,))),
        )
        self.assertEqual(serialize_market_overview(first), serialize_market_overview(second))

    def test_viewmodel_is_json_compatible_and_provider_neutral(self) -> None:
        overview = self.build(
            self.memory_service(watchlist=(WATCHLIST_NORMAL,), positions=(PROFIT_POSITION,)),
            quotes=(US_QUOTE,),
        )
        payload = serialize_market_overview(overview)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        self.assertIn('"viewmodel_version": "market.overview.v0.1"', encoded)
        for forbidden in (
            "chart.result",
            "regularMarketPrice",
            "exchangeTimezoneName",
            "query1.finance.yahoo.com",
        ):
            self.assertNotIn(forbidden, encoded)

    def test_duplicate_quote_identity_fails_explicitly(self) -> None:
        with self.assertRaises(OverviewError) as context:
            self.build(self.memory_service(), quotes=(US_QUOTE, US_QUOTE))
        self.assertEqual(OverviewErrorCode.IDENTITY_CONFLICT, context.exception.failure.code)

    def test_missing_instrument_registry_identity_fails_explicitly(self) -> None:
        service = self.memory_service(positions=(POSITION_ONLY,), instruments=(US_SHARE,))
        with self.assertRaises(OverviewError) as context:
            self.build(service)
        self.assertEqual(OverviewErrorCode.CORE_STATE_UNAVAILABLE, context.exception.failure.code)


if __name__ == "__main__":
    unittest.main()
