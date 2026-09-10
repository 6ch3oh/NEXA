from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
import sys
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.adapters import AdapterError  # noqa: E402
from nexa_market.domain import (  # noqa: E402
    AssetType,
    AuthorType,
    Freshness,
    Instrument,
    Position,
    PositionOrigin,
    PositionStatus,
    WatchlistPriority,
    WatchlistStatus,
)
from nexa_market.fixtures import (  # noqa: E402
    CURRENCY_MISMATCH_QUOTE,
    LOSS_POSITION,
    NOW,
    PROFIT_POSITION,
    SAME_SYMBOL_XNAS,
    SAME_SYMBOL_XNYS,
    US_QUOTE,
    US_SHARE,
)
from nexa_market.pnl import PnLReason, PnLStatus, calculate_unrealized_pnl  # noqa: E402
from nexa_market.repositories import (  # noqa: E402
    InMemoryObservationRepository,
    InMemoryPositionRepository,
    InMemoryWatchlistRepository,
    ObservationRepository,
    PositionRepository,
    WatchlistRepository,
)
from nexa_market.services.errors import ServiceError, ServiceFailureCode  # noqa: E402
from nexa_market.services.observations import ObservationService  # noqa: E402
from nexa_market.services.portfolio import PortfolioSnapshotService, SnapshotCompleteness  # noqa: E402
from nexa_market.services.positions import PositionService  # noqa: E402
from nexa_market.services.watchlist import WatchlistService  # noqa: E402
from nexa_market.state_fixtures import (  # noqa: E402
    CNY_POSITION,
    CNY_QUOTE,
    DELAYED_HK_QUOTE,
    HKD_POSITION,
    KNOWN_INSTRUMENTS,
    MISSING_QUOTE_POSITIONS,
    MULTI_CURRENCY_POSITIONS,
    MULTI_CURRENCY_QUOTES,
    OBSERVATION_HISTORY,
    POSITION_ONLY,
    WATCHLIST_NORMAL,
    ZERO_QUANTITY_POSITION,
)


class WatchlistServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = InMemoryWatchlistRepository()
        self.service = WatchlistService(self.repository)

    def test_add_get_list_and_duplicate_is_idempotent(self) -> None:
        first = self.service.add(US_SHARE, NOW, tags=("research",))
        second = self.service.add(US_SHARE, NOW + timedelta(days=1), tags=("different",))
        self.assertTrue(first.created)
        self.assertFalse(second.created)
        self.assertIs(first.item, second.item)
        self.assertEqual((first.item,), self.service.list_items())
        self.assertEqual(first.item, self.service.get(US_SHARE.instrument_id))

    def test_identity_uses_instrument_id_not_symbol(self) -> None:
        self.assertEqual(SAME_SYMBOL_XNAS.symbol, SAME_SYMBOL_XNYS.symbol)
        self.service.add(SAME_SYMBOL_XNAS, NOW)
        self.service.add(SAME_SYMBOL_XNYS, NOW)
        self.assertEqual(2, len(self.service.list_items()))

    def test_update_all_mutable_watchlist_fields(self) -> None:
        self.service.add(US_SHARE, NOW)
        self.service.update_note(US_SHARE.instrument_id, "Updated note")
        self.service.update_tags(US_SHARE.instrument_id, ("alpha", "review"))
        self.service.update_priority(US_SHARE.instrument_id, WatchlistPriority.HIGH)
        updated = self.service.update_status(US_SHARE.instrument_id, WatchlistStatus.ARCHIVED)
        self.assertEqual("Updated note", updated.note)
        self.assertEqual(("alpha", "review"), updated.tags)
        self.assertEqual(WatchlistPriority.HIGH, updated.priority)
        self.assertEqual(WatchlistStatus.ARCHIVED, updated.status)

    def test_remove_and_missing_are_explicit(self) -> None:
        self.service.add(US_SHARE, NOW)
        removed = self.service.remove(US_SHARE.instrument_id)
        self.assertEqual(US_SHARE.instrument_id, removed.instrument.instrument_id)
        with self.assertRaises(ServiceError) as context:
            self.service.get(US_SHARE.instrument_id)
        self.assertEqual(ServiceFailureCode.NOT_FOUND, context.exception.failure.code)

    def test_invalid_instrument_is_application_error(self) -> None:
        with self.assertRaises(ServiceError) as context:
            self.service.add("AAPL", NOW)  # type: ignore[arg-type]
        self.assertEqual(ServiceFailureCode.INVALID_ARGUMENT, context.exception.failure.code)

    def test_watchlist_and_position_repositories_are_decoupled(self) -> None:
        position_repository = InMemoryPositionRepository()
        positions = PositionService(position_repository, KNOWN_INSTRUMENTS)
        self.service.add(US_SHARE, NOW)
        positions.create(PROFIT_POSITION)
        self.service.remove(US_SHARE.instrument_id)
        self.assertEqual(PROFIT_POSITION, positions.get(PROFIT_POSITION.position_id))
        self.service.add(US_SHARE, NOW)
        positions.close(PROFIT_POSITION.position_id)
        self.assertEqual(US_SHARE.instrument_id, self.service.get(US_SHARE.instrument_id).instrument.instrument_id)


class PositionServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = InMemoryPositionRepository()
        self.service = PositionService(self.repository, KNOWN_INSTRUMENTS)

    def test_create_is_explicitly_manual(self) -> None:
        created = self.service.create(PROFIT_POSITION)
        self.assertEqual(PositionOrigin.MANUAL, created.origin)
        self.assertEqual(created, self.service.get(created.position_id))

    def test_create_manual_validates_negative_quantity_and_cost(self) -> None:
        cases = ((Decimal("-1"), Decimal("10")), (Decimal("1"), Decimal("-10")))
        for index, (quantity, cost) in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(ServiceError) as context:
                self.service.create_manual(
                    position_id=f"position.invalid-{index}",
                    instrument_id=US_SHARE.instrument_id,
                    quantity=quantity,
                    average_cost=cost,
                    currency="USD",
                    recorded_at=NOW,
                )
            self.assertEqual(ServiceFailureCode.INVALID_ARGUMENT, context.exception.failure.code)

    def test_create_manual_validates_currency(self) -> None:
        with self.assertRaises(ServiceError) as context:
            self.service.create_manual(
                position_id="position.bad-currency",
                instrument_id=US_SHARE.instrument_id,
                quantity=Decimal("1"),
                average_cost=Decimal("10"),
                currency="usd",
                recorded_at=NOW,
            )
        self.assertEqual(ServiceFailureCode.INVALID_ARGUMENT, context.exception.failure.code)

    def test_missing_instrument_is_not_found(self) -> None:
        unknown = replace(PROFIT_POSITION, position_id="position.unknown", instrument_id="US.NMS.UNKNOWN")
        with self.assertRaises(ServiceError) as context:
            self.service.create(unknown)
        self.assertEqual(ServiceFailureCode.NOT_FOUND, context.exception.failure.code)

    def test_duplicate_active_position_is_rejected(self) -> None:
        self.service.create(PROFIT_POSITION)
        duplicate = replace(PROFIT_POSITION, position_id="position.duplicate")
        with self.assertRaises(ServiceError) as context:
            self.service.create(duplicate)
        self.assertEqual(ServiceFailureCode.ALREADY_EXISTS, context.exception.failure.code)

    def test_update_quantity_cost_and_note(self) -> None:
        self.service.create(PROFIT_POSITION)
        self.service.update_quantity(PROFIT_POSITION.position_id, Decimal("12"))
        self.service.update_average_cost(PROFIT_POSITION.position_id, Decimal("101"))
        updated = self.service.update_note(PROFIT_POSITION.position_id, "Reviewed")
        self.assertEqual(Decimal("12"), updated.quantity)
        self.assertEqual(Decimal("101"), updated.average_cost)
        self.assertEqual("Reviewed", updated.note)

    def test_zero_quantity_remains_open_until_explicit_close(self) -> None:
        self.service.create(PROFIT_POSITION)
        updated = self.service.update_quantity(PROFIT_POSITION.position_id, Decimal("0"))
        self.assertEqual(Decimal("0"), updated.quantity)
        self.assertEqual(PositionStatus.OPEN, updated.status)

    def test_close_and_archive_are_explicit(self) -> None:
        self.service.create(PROFIT_POSITION)
        closed = self.service.close(PROFIT_POSITION.position_id)
        self.assertEqual(PositionStatus.CLOSED, closed.status)
        second = replace(PROFIT_POSITION, position_id="position.reopened")
        self.service.create(second)
        archived = self.service.close(second.position_id, archive=True)
        self.assertEqual(PositionStatus.ARCHIVED, archived.status)

    def test_closed_position_cannot_be_updated(self) -> None:
        self.service.create(PROFIT_POSITION)
        self.service.close(PROFIT_POSITION.position_id)
        with self.assertRaises(ServiceError) as context:
            self.service.update_quantity(PROFIT_POSITION.position_id, Decimal("2"))
        self.assertEqual(ServiceFailureCode.INVALID_STATE, context.exception.failure.code)

    def test_missing_position_is_not_found(self) -> None:
        with self.assertRaises(ServiceError) as context:
            self.service.get("position.missing")
        self.assertEqual(ServiceFailureCode.NOT_FOUND, context.exception.failure.code)


class ObservationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = InMemoryObservationRepository()
        self.service = ObservationService(self.repository, KNOWN_INSTRUMENTS)

    def test_create_get_and_queries_preserve_history(self) -> None:
        for observation in OBSERVATION_HISTORY:
            self.service.create(observation)
        self.assertEqual(OBSERVATION_HISTORY[0], self.service.get(OBSERVATION_HISTORY[0].observation_id))
        self.assertEqual(2, len(self.service.list_by_instrument(US_SHARE.instrument_id)))
        first_day = self.service.list_by_time(NOW - timedelta(minutes=1), NOW + timedelta(hours=1))
        self.assertEqual((OBSERVATION_HISTORY[0],), first_day)
        self.assertEqual(2, len(self.service.list_by_author(AuthorType.USER)))
        self.assertNotEqual(OBSERVATION_HISTORY[0].content, OBSERVATION_HISTORY[1].content)

    def test_duplicate_observation_does_not_overwrite(self) -> None:
        original = self.service.create(OBSERVATION_HISTORY[0])
        replacement = replace(original, content="Attempted overwrite")
        with self.assertRaises(ServiceError) as context:
            self.service.create(replacement)
        self.assertEqual(ServiceFailureCode.ALREADY_EXISTS, context.exception.failure.code)
        self.assertEqual(original.content, self.service.get(original.observation_id).content)

    def test_append_tags_is_metadata_only(self) -> None:
        original = self.service.create(OBSERVATION_HISTORY[0])
        updated = self.service.append_tags(original.observation_id, ("follow-up", "review"))
        self.assertIn("follow-up", updated.tags)
        self.assertEqual(original.content, updated.content)
        self.assertEqual(original.observed_at, updated.observed_at)
        self.assertEqual(original.event_refs, updated.event_refs)
        self.assertEqual(original.research_refs, updated.research_refs)
        self.assertFalse(hasattr(self.service, "update_content"))

    def test_unknown_instrument_is_not_found(self) -> None:
        unknown = replace(OBSERVATION_HISTORY[0], observation_id="observation.unknown", instrument_id="US.NMS.UNKNOWN")
        with self.assertRaises(ServiceError) as context:
            self.service.create(unknown)
        self.assertEqual(ServiceFailureCode.NOT_FOUND, context.exception.failure.code)


class RepositoryContractTests(unittest.TestCase):
    def test_memory_repositories_satisfy_protocols(self) -> None:
        self.assertIsInstance(InMemoryWatchlistRepository(), WatchlistRepository)
        self.assertIsInstance(InMemoryPositionRepository(), PositionRepository)
        self.assertIsInstance(InMemoryObservationRepository(), ObservationRepository)

    def test_crud_and_deterministic_order(self) -> None:
        watch = InMemoryWatchlistRepository()
        later = replace(WATCHLIST_NORMAL, added_at=NOW + timedelta(days=1))
        earlier = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS)
        self.assertTrue(watch.add(later))
        self.assertTrue(watch.add(earlier))
        self.assertEqual(earlier, watch.list_all()[0])
        changed = replace(later, note="changed")
        self.assertTrue(watch.replace(changed))
        self.assertEqual(changed, watch.get(changed.instrument.instrument_id))
        self.assertTrue(watch.delete(earlier.instrument.instrument_id))
        self.assertFalse(watch.delete("missing.instrument"))

    def test_repositories_are_isolated(self) -> None:
        watch = InMemoryWatchlistRepository()
        positions = InMemoryPositionRepository()
        observations = InMemoryObservationRepository()
        watch.add(WATCHLIST_NORMAL)
        positions.add(PROFIT_POSITION)
        observations.add(OBSERVATION_HISTORY[0])
        watch.delete(US_SHARE.instrument_id)
        self.assertEqual((PROFIT_POSITION,), positions.list_all())
        self.assertEqual((OBSERVATION_HISTORY[0],), observations.list_all())


class PortfolioSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = PortfolioSnapshotService()

    def test_single_currency_profit_reuses_pnl_result(self) -> None:
        snapshot = self.service.build((PROFIT_POSITION,), (US_QUOTE,), as_of=NOW)
        expected = calculate_unrealized_pnl(PROFIT_POSITION, US_QUOTE)
        self.assertEqual(PnLStatus.AVAILABLE, snapshot.per_position_pnl[0].pnl.status)
        self.assertEqual(expected, snapshot.per_position_pnl[0].pnl)
        self.assertEqual(Decimal("1000.00"), snapshot.total_cost_basis)
        self.assertEqual(Decimal("1200.00"), snapshot.total_market_value)
        self.assertEqual(Decimal("200.00"), snapshot.total_unrealized_pnl)
        self.assertEqual(Decimal("20.00"), snapshot.total_unrealized_pnl_percent)
        self.assertEqual("USD", snapshot.global_currency)
        self.assertEqual(SnapshotCompleteness.COMPLETE, snapshot.completeness)

    def test_single_currency_loss(self) -> None:
        snapshot = self.service.build((LOSS_POSITION,), (US_QUOTE,), as_of=NOW)
        self.assertEqual(Decimal("-200.00"), snapshot.total_unrealized_pnl)
        self.assertEqual(Decimal("-14.29"), snapshot.total_unrealized_pnl_percent)

    def test_zero_quantity_is_partial_not_guessed(self) -> None:
        snapshot = self.service.build((ZERO_QUANTITY_POSITION,), (US_QUOTE,), as_of=NOW)
        line = snapshot.per_position_pnl[0]
        self.assertEqual(PnLStatus.INCOMPLETE, line.pnl.status)
        self.assertEqual(PnLReason.ZERO_QUANTITY, line.pnl.reason)
        self.assertEqual(Decimal("0.00"), snapshot.total_market_value)
        self.assertIsNone(snapshot.total_unrealized_pnl_percent)
        self.assertEqual(SnapshotCompleteness.PARTIAL, snapshot.completeness)

    def test_missing_quote_is_explicitly_unavailable(self) -> None:
        snapshot = self.service.build(MISSING_QUOTE_POSITIONS, (), as_of=NOW)
        self.assertEqual(1, snapshot.unavailable_quote_count)
        self.assertEqual(Decimal("250.00"), snapshot.total_cost_basis)
        self.assertIsNone(snapshot.total_market_value)
        self.assertIsNone(snapshot.total_unrealized_pnl)
        self.assertEqual(SnapshotCompleteness.UNAVAILABLE, snapshot.completeness)

    def test_delayed_quote_marks_snapshot_partial(self) -> None:
        snapshot = self.service.build((HKD_POSITION,), (DELAYED_HK_QUOTE,), as_of=NOW)
        self.assertEqual(1, snapshot.delayed_or_stale_quote_count)
        self.assertEqual(Decimal("7600.00"), snapshot.total_market_value)
        self.assertEqual(SnapshotCompleteness.PARTIAL, snapshot.completeness)

    def test_stale_quote_marks_snapshot_partial(self) -> None:
        stale = replace(US_QUOTE, provenance=replace(US_QUOTE.provenance, freshness=Freshness.STALE))
        snapshot = self.service.build((PROFIT_POSITION,), (stale,), as_of=NOW)
        self.assertEqual(1, snapshot.delayed_or_stale_quote_count)
        self.assertEqual(SnapshotCompleteness.PARTIAL, snapshot.completeness)

    def test_currency_mismatch_is_not_converted(self) -> None:
        snapshot = self.service.build((PROFIT_POSITION,), (CURRENCY_MISMATCH_QUOTE,), as_of=NOW)
        self.assertEqual(PnLStatus.ERROR, snapshot.per_position_pnl[0].pnl.status)
        self.assertIsNone(snapshot.total_market_value)
        self.assertEqual(SnapshotCompleteness.UNAVAILABLE, snapshot.completeness)

    def test_multi_currency_never_has_global_totals(self) -> None:
        snapshot = self.service.build(MULTI_CURRENCY_POSITIONS, MULTI_CURRENCY_QUOTES, as_of=NOW)
        self.assertEqual(3, snapshot.position_count)
        self.assertEqual({"USD", "CNY", "HKD"}, {bucket.currency for bucket in snapshot.currency_groups})
        self.assertIsNone(snapshot.total_cost_basis)
        self.assertIsNone(snapshot.total_market_value)
        self.assertIsNone(snapshot.total_unrealized_pnl)
        self.assertIsNone(snapshot.total_unrealized_pnl_percent)
        self.assertIsNone(snapshot.global_currency)
        self.assertEqual(SnapshotCompleteness.PARTIAL, snapshot.completeness)
        buckets = {bucket.currency: bucket for bucket in snapshot.currency_groups}
        self.assertEqual(Decimal("1200.00"), buckets["USD"].total_market_value)
        self.assertEqual(Decimal("1100.00"), buckets["CNY"].total_market_value)
        self.assertEqual(Decimal("7600.00"), buckets["HKD"].total_market_value)

    def test_closed_positions_are_excluded(self) -> None:
        closed = replace(PROFIT_POSITION, status=PositionStatus.CLOSED)
        snapshot = self.service.build((closed, CNY_POSITION), (US_QUOTE, CNY_QUOTE), as_of=NOW)
        self.assertEqual(1, snapshot.position_count)
        self.assertEqual("CNY", snapshot.global_currency)


class BoundaryTests(unittest.TestCase):
    def test_application_error_is_distinct_from_adapter_error(self) -> None:
        error = ServiceError
        self.assertFalse(issubclass(error, AdapterError))
        self.assertEqual(
            {"NOT_FOUND", "ALREADY_EXISTS", "INVALID_ARGUMENT", "INVALID_STATE", "INCOMPLETE_DATA"},
            {item.value for item in ServiceFailureCode},
        )

    def test_state_layer_is_provider_and_storage_neutral(self) -> None:
        state_files = [
            *Path(MODULE_ROOT / "nexa_market" / "services").glob("*.py"),
            *Path(MODULE_ROOT / "nexa_market" / "repositories").glob("*.py"),
        ]
        source = "\n".join(path.read_text(encoding="utf-8").casefold() for path in state_files)
        for forbidden in ("yahoo", "query1.finance", "sqlite", "postgres", "redis", "notion"):
            self.assertNotIn(forbidden, source)

    def test_no_trading_or_account_capability(self) -> None:
        state_files = [
            *Path(MODULE_ROOT / "nexa_market" / "services").glob("*.py"),
            *Path(MODULE_ROOT / "nexa_market" / "repositories").glob("*.py"),
        ]
        source = "\n".join(path.read_text(encoding="utf-8").casefold() for path in state_files)
        for forbidden in ("submit_order", "buy_command", "sell_command", "broker_sync", "account_balance", "fund_transfer"):
            self.assertNotIn(forbidden, source)

    def test_yahoo_adapter_does_not_import_state_layer(self) -> None:
        source = (MODULE_ROOT / "nexa_market" / "providers" / "yahoo_chart.py").read_text(encoding="utf-8")
        self.assertNotIn("services", source)
        self.assertNotIn("repositories", source)


if __name__ == "__main__":
    unittest.main()
