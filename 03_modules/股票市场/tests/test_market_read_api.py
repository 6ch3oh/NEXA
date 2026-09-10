from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
import json
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.application import MarketReadAPI  # noqa: E402
from nexa_market.application.models import READ_API_VERSION, ObservationQuery, ReadInputs  # noqa: E402
from nexa_market.domain import AuthorType  # noqa: E402
from nexa_market.fixtures import (  # noqa: E402
    AI_RESEARCH_RESULT,
    FUNDAMENTAL_SUMMARY,
    MARKET_EVENT,
    NOW,
    RISK_ALERT,
    US_QUOTE,
    US_SHARE,
)
from nexa_market.repositories import (  # noqa: E402
    InMemoryObservationRepository,
    InMemoryPositionRepository,
    InMemoryWatchlistRepository,
)
from nexa_market.state_fixtures import KNOWN_INSTRUMENTS, OBSERVATION_HISTORY, PROFIT_POSITION, WATCHLIST_NORMAL  # noqa: E402
from tests.test_beginner_research import valid_research  # noqa: E402


class MarketReadAPITestCase(unittest.TestCase):
    def api(self, *, watchlist=(), positions=(), observations=()):
        watch_repo = InMemoryWatchlistRepository()
        position_repo = InMemoryPositionRepository()
        observation_repo = InMemoryObservationRepository()
        for item in watchlist:
            self.assertTrue(watch_repo.add(item))
        for item in positions:
            self.assertTrue(position_repo.add(item))
        for item in observations:
            self.assertTrue(observation_repo.add(item))
        return MarketReadAPI(watch_repo, position_repo, observation_repo, KNOWN_INSTRUMENTS)

    @staticmethod
    def inputs(**changes):
        defaults = dict(
            generated_at=NOW,
            quotes=(US_QUOTE,),
            risks=(RISK_ALERT,),
            fundamentals=(FUNDAMENTAL_SUMMARY,),
            research_results=(AI_RESEARCH_RESULT,),
            events=(MARKET_EVENT,),
            beginner_research=(valid_research(),),
        )
        defaults.update(changes)
        return ReadInputs(**defaults)


class EnvelopeAndHomeTests(MarketReadAPITestCase):
    def test_market_home_is_versioned_json_safe_and_reuses_overview(self) -> None:
        payload = self.api(watchlist=(WATCHLIST_NORMAL,), positions=(PROFIT_POSITION,), observations=OBSERVATION_HISTORY).market_home(self.inputs())
        self.assertTrue(payload["ok"])
        self.assertEqual(READ_API_VERSION, payload["api_version"])
        self.assertEqual("MARKET_HOME", payload["operation"])
        self.assertEqual(1, payload["data"]["watchlist"]["total_count"])
        self.assertEqual("200.00", payload["data"]["portfolio"]["positions"][0]["pnl"]["unrealized_pnl"])
        json.dumps(payload, ensure_ascii=False, sort_keys=True)

    def test_invalid_input_returns_stable_error_without_exception_leak(self) -> None:
        payload = self.api().market_home(None)
        self.assertFalse(payload["ok"])
        self.assertEqual("INVALID_ARGUMENT", payload["error"]["code"])
        self.assertEqual(set(("ok", "api_version", "operation", "generated_at", "error")), set(payload))

    def test_store_health_is_read_only_projection(self) -> None:
        payload = self.api().store_health(ReadInputs(NOW))
        self.assertTrue(payload["ok"])
        self.assertEqual("NEW_EMPTY", payload["data"]["status"])
        self.assertFalse(payload["data"]["recovery_needed"])


class ListAndDetailTests(MarketReadAPITestCase):
    def test_instrument_list_is_ui_ready_and_deterministic(self) -> None:
        api = self.api(watchlist=(WATCHLIST_NORMAL,), positions=(PROFIT_POSITION,), observations=OBSERVATION_HISTORY)
        first = api.instrument_list(self.inputs())
        second = api.instrument_list(self.inputs())
        self.assertEqual(first, second)
        self.assertEqual(len(KNOWN_INSTRUMENTS), first["data"]["total_count"])
        item = first["data"]["items"][0]
        self.assertEqual(US_SHARE.instrument_id, item["instrument"]["instrument_id"])
        self.assertEqual("OPEN", item["position_state"])
        self.assertEqual(2, item["observation_count"])

    def test_duplicate_event_and_research_identities_fail_explicitly(self) -> None:
        api = self.api(watchlist=(WATCHLIST_NORMAL,))
        event_failure = api.instrument_detail(US_SHARE.instrument_id, self.inputs(events=(MARKET_EVENT, MARKET_EVENT)))
        self.assertFalse(event_failure["ok"])
        self.assertEqual("IDENTITY_CONFLICT", event_failure["error"]["code"])
        research = valid_research()
        research_failure = api.instrument_detail(US_SHARE.instrument_id, self.inputs(beginner_research=(research, research)))
        self.assertFalse(research_failure["ok"])
        self.assertEqual("IDENTITY_CONFLICT", research_failure["error"]["code"])

    def test_instrument_detail_combines_all_local_inputs_and_beginner_research(self) -> None:
        payload = self.api(watchlist=(WATCHLIST_NORMAL,), positions=(PROFIT_POSITION,), observations=OBSERVATION_HISTORY).instrument_detail(US_SHARE.instrument_id, self.inputs())
        self.assertTrue(payload["ok"])
        data = payload["data"]
        self.assertEqual("nexa.market.instrument-detail.v0.1", data["projection_version"])
        self.assertEqual("200.00", data["pnl"]["unrealized_pnl"])
        self.assertEqual(2, len(data["observations"]))
        self.assertEqual(1, len(data["events"]))
        self.assertEqual(1, len(data["beginner_research"]))
        self.assertEqual("PASS_WITH_WARNINGS", data["beginner_research"][0]["quality"]["outcome"])
        self.assertEqual("AVAILABLE", data["availability"]["research"])

    def test_missing_optional_components_are_explicit(self) -> None:
        payload = self.api(watchlist=(WATCHLIST_NORMAL,)).instrument_detail(
            US_SHARE.instrument_id,
            self.inputs(quotes=(), risks=None, fundamentals=None, research_results=None, events=None, beginner_research=None),
        )
        self.assertTrue(payload["ok"])
        availability = payload["data"]["availability"]
        self.assertEqual("UNAVAILABLE", availability["quote"])
        self.assertEqual("UNAVAILABLE", availability["events"])
        self.assertEqual("UNAVAILABLE", availability["fundamentals"])
        self.assertEqual("UNAVAILABLE", availability["risks"])
        self.assertEqual("UNAVAILABLE", availability["research"])

    def test_unknown_instrument_returns_not_found_envelope(self) -> None:
        payload = self.api().instrument_detail("US.XNAS.UNKNOWN", ReadInputs(NOW))
        self.assertFalse(payload["ok"])
        self.assertEqual("NOT_FOUND", payload["error"]["code"])
        self.assertEqual("US.XNAS.UNKNOWN", payload["error"]["reference"])

    def test_known_instrument_without_any_state_returns_empty_detail(self) -> None:
        payload = self.api().instrument_detail(US_SHARE.instrument_id, ReadInputs(NOW))
        self.assertTrue(payload["ok"])
        data = payload["data"]
        self.assertEqual(US_SHARE.instrument_id, data["instrument"]["instrument_id"])
        self.assertFalse(data["watchlist"]["present"])
        self.assertEqual("UNAVAILABLE", data["availability"]["quote"])
        self.assertEqual("EMPTY", data["availability"]["position"])
        self.assertEqual("EMPTY", data["availability"]["observations"])

    def test_provider_and_storage_details_do_not_leak(self) -> None:
        payload = self.api(watchlist=(WATCHLIST_NORMAL,)).instrument_detail(US_SHARE.instrument_id, self.inputs())
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        for forbidden in ("regularMarketPrice", "chart.result", "query1.finance.yahoo.com", "LocalMarketState", "RepositoryLoadResult"):
            self.assertNotIn(forbidden, encoded)


class ObservationQueryTests(MarketReadAPITestCase):
    def test_query_supports_filters_stable_order_and_pagination(self) -> None:
        api = self.api(observations=OBSERVATION_HISTORY)
        first = api.query_observations(ObservationQuery(instrument_id=US_SHARE.instrument_id, author_type=AuthorType.USER, limit=1), generated_at=NOW)
        self.assertTrue(first["ok"])
        self.assertEqual(2, first["data"]["total_count"])
        self.assertEqual(1, first["data"]["next_offset"])
        second = api.query_observations(ObservationQuery(offset=1, limit=1), generated_at=NOW)
        self.assertEqual(OBSERVATION_HISTORY[1].observation_id, second["data"]["items"][0]["observation_id"])

    def test_time_range_is_half_open(self) -> None:
        payload = self.api(observations=OBSERVATION_HISTORY).query_observations(
            ObservationQuery(start=NOW, end=NOW + timedelta(days=1)), generated_at=NOW
        )
        self.assertEqual(1, payload["data"]["total_count"])

    def test_invalid_pagination_returns_stable_error(self) -> None:
        payload = self.api().query_observations(ObservationQuery(limit=0), generated_at=NOW)
        self.assertFalse(payload["ok"])
        self.assertEqual("INVALID_ARGUMENT", payload["error"]["code"])

    def test_observation_projection_does_not_expose_provenance_internals(self) -> None:
        payload = self.api(observations=OBSERVATION_HISTORY).query_observations(ObservationQuery(), generated_at=NOW)
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        self.assertNotIn('"provenance"', encoded)
        self.assertNotIn("fixture.user", encoded)


if __name__ == "__main__":
    unittest.main()
