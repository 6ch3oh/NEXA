from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
STORAGE_FIXTURES = MODULE_ROOT / "tests" / "storage_fixtures"

from nexa_market.adapters import AdapterError  # noqa: E402
from nexa_market.domain import PositionStatus, WatchlistPriority  # noqa: E402
from nexa_market.fixtures import (  # noqa: E402
    SAME_SYMBOL_XNAS,
    SAME_SYMBOL_XNYS,
    US_QUOTE,
    US_SHARE,
)
from nexa_market.repositories import (  # noqa: E402
    FORMAT_VERSION,
    SCHEMA_VERSION,
    InMemoryObservationRepository,
    InMemoryPositionRepository,
    InMemoryWatchlistRepository,
    LocalObservationRepository,
    LocalPositionRepository,
    LocalStateStore,
    LocalWatchlistRepository,
    ObservationRepository,
    PositionRepository,
    RepositoryDiagnosticCode,
    RepositoryError,
    RepositoryFailureCode,
    RepositoryLoadStatus,
    WatchlistRepository,
)
from nexa_market.repositories.serialization import (  # noqa: E402
    serialize_observation,
    serialize_position,
    serialize_watchlist,
)
from nexa_market.services.errors import ServiceError  # noqa: E402
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
    MULTI_CURRENCY_POSITIONS,
    MULTI_CURRENCY_QUOTES,
    NOW,
    OBSERVATION_HISTORY,
    PROFIT_POSITION,
    WATCHLIST_NORMAL,
)


def empty_payload() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "format_version": FORMAT_VERSION,
        "watchlist": [],
        "positions": [],
        "observations": [],
    }


class LocalRepositoryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / "market-state.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def copy_fixture(self, name: str) -> None:
        shutil.copyfile(STORAGE_FIXTURES / name, self.path)

    def write_payload(self, payload: dict) -> None:
        self.path.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


class FileLevelContractTests(LocalRepositoryTestCase):
    def test_missing_file_is_new_store_not_corruption(self) -> None:
        result = LocalStateStore(self.path).load()
        self.assertEqual(RepositoryLoadStatus.NEW_STORE, result.status)
        self.assertEqual(0, result.loaded_count)
        self.assertFalse(self.path.exists())

    def test_initialize_creates_valid_empty_store(self) -> None:
        result = LocalWatchlistRepository(self.path).initialize()
        self.assertEqual(RepositoryLoadStatus.LOADED, result.status)
        self.assertTrue(self.path.exists())
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(SCHEMA_VERSION, raw["schema_version"])
        self.assertEqual(FORMAT_VERSION, raw["format_version"])
        self.assertEqual([], raw["watchlist"])

    def test_static_valid_empty_store_loads(self) -> None:
        self.copy_fixture("valid_empty.json")
        result = LocalStateStore(self.path).load()
        self.assertEqual(RepositoryLoadStatus.LOADED, result.status)
        self.assertEqual(0, result.rejected_count)

    def test_malformed_truncated_and_duplicate_keys_fail_closed(self) -> None:
        for name in ("malformed_json.json", "truncated.json", "duplicate_object_key.json"):
            with self.subTest(name=name):
                self.copy_fixture(name)
                with self.assertRaises(RepositoryError) as context:
                    LocalStateStore(self.path).load()
                self.assertEqual(RepositoryFailureCode.MALFORMED_STORE, context.exception.failure.code)

    def test_missing_schema_is_malformed(self) -> None:
        self.copy_fixture("missing_schema.json")
        with self.assertRaises(RepositoryError) as context:
            LocalStateStore(self.path).load()
        self.assertEqual(RepositoryFailureCode.MALFORMED_STORE, context.exception.failure.code)

    def test_future_schema_fails_closed(self) -> None:
        self.copy_fixture("future_schema.json")
        with self.assertRaises(RepositoryError) as context:
            LocalStateStore(self.path).load()
        self.assertEqual(RepositoryFailureCode.UNSUPPORTED_VERSION, context.exception.failure.code)

    def test_unknown_format_fails_closed(self) -> None:
        payload = empty_payload()
        payload["format_version"] = "future-format-v999"
        self.write_payload(payload)
        with self.assertRaises(RepositoryError) as context:
            LocalStateStore(self.path).load()
        self.assertEqual(RepositoryFailureCode.UNSUPPORTED_VERSION, context.exception.failure.code)

    def test_relative_path_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            LocalStateStore(Path("relative-state.json"))


class RecordRecoveryTests(LocalRepositoryTestCase):
    def test_one_invalid_watchlist_recovers_valid_record_with_diagnostic(self) -> None:
        invalid = serialize_watchlist(WATCHLIST_NORMAL)
        invalid["priority"] = "IMPOSSIBLE"
        valid = serialize_watchlist(replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS))
        payload = empty_payload()
        payload["watchlist"] = [invalid, valid]
        self.write_payload(payload)
        result = LocalWatchlistRepository(self.path).load_result()
        self.assertEqual(RepositoryLoadStatus.PARTIALLY_INVALID, result.status)
        self.assertEqual(1, result.loaded_count)
        self.assertEqual(1, result.rejected_count)
        self.assertEqual(US_SHARE.instrument_id, result.diagnostics[0].identity)
        self.assertEqual(0, result.diagnostics[0].index)
        self.assertEqual((SAME_SYMBOL_XNAS.instrument_id,), tuple(item.instrument.instrument_id for item in result.state.watchlist))

    def test_invalid_position_and_illegal_origin_are_rejected(self) -> None:
        negative = serialize_position(PROFIT_POSITION)
        negative["quantity"] = "-1"
        illegal_origin = serialize_position(replace(PROFIT_POSITION, position_id="position.illegal-origin"))
        illegal_origin["origin"] = "BROKER"
        valid = serialize_position(CNY_POSITION)
        payload = empty_payload()
        payload["positions"] = [negative, illegal_origin, valid]
        self.write_payload(payload)
        result = LocalPositionRepository(self.path).load_result()
        self.assertEqual(RepositoryLoadStatus.PARTIALLY_INVALID, result.status)
        self.assertEqual((CNY_POSITION,), result.state.positions)
        self.assertEqual(2, result.rejected_count)
        self.assertEqual(
            {RepositoryDiagnosticCode.RECORD_INVALID},
            {diagnostic.code for diagnostic in result.diagnostics},
        )

    def test_invalid_observation_recovers_other_history(self) -> None:
        invalid = serialize_observation(OBSERVATION_HISTORY[0])
        invalid["author_type"] = "AI"
        valid = serialize_observation(OBSERVATION_HISTORY[1])
        payload = empty_payload()
        payload["observations"] = [invalid, valid]
        self.write_payload(payload)
        result = LocalObservationRepository(self.path).load_result()
        self.assertEqual((OBSERVATION_HISTORY[1],), result.state.observations)
        self.assertEqual(1, result.rejected_count)

    def test_mixed_valid_and_invalid_sections_recover_independently(self) -> None:
        invalid_position = serialize_position(PROFIT_POSITION)
        invalid_position["currency"] = "usd"
        payload = empty_payload()
        payload["watchlist"] = [serialize_watchlist(WATCHLIST_NORMAL)]
        payload["positions"] = [invalid_position]
        payload["observations"] = [serialize_observation(OBSERVATION_HISTORY[0])]
        self.write_payload(payload)
        result = LocalStateStore(self.path).load()
        self.assertEqual(RepositoryLoadStatus.PARTIALLY_INVALID, result.status)
        self.assertEqual(2, result.loaded_count)
        self.assertEqual(1, result.rejected_count)

    def test_unknown_extra_record_field_is_not_silently_ignored(self) -> None:
        record = serialize_position(PROFIT_POSITION)
        record["api_key"] = "must-not-be-accepted"
        payload = empty_payload()
        payload["positions"] = [record]
        self.write_payload(payload)
        result = LocalStateStore(self.path).load()
        self.assertEqual(RepositoryLoadStatus.PARTIALLY_INVALID, result.status)
        self.assertEqual(0, result.loaded_count)
        self.assertEqual(1, result.rejected_count)

    def test_partial_store_is_readable_but_writes_fail_closed(self) -> None:
        invalid = serialize_position(PROFIT_POSITION)
        invalid["quantity"] = "invalid"
        payload = empty_payload()
        payload["positions"] = [invalid]
        self.write_payload(payload)
        before = self.path.read_bytes()
        repository = LocalWatchlistRepository(self.path)
        self.assertEqual((), repository.list_all())
        self.assertEqual(RepositoryLoadStatus.PARTIALLY_INVALID, repository.last_load_result.status)
        with self.assertRaises(RepositoryError) as context:
            repository.add(WATCHLIST_NORMAL)
        self.assertEqual(RepositoryFailureCode.RECORD_INVALID, context.exception.failure.code)
        self.assertEqual(before, self.path.read_bytes())


class IdentityConflictTests(LocalRepositoryTestCase):
    def test_duplicate_watchlist_identity_rejects_every_conflicting_record(self) -> None:
        record = serialize_watchlist(WATCHLIST_NORMAL)
        payload = empty_payload()
        payload["watchlist"] = [record, replace_dict(record, note="conflict")]
        self.write_payload(payload)
        result = LocalStateStore(self.path).load()
        self.assertEqual((), result.state.watchlist)
        self.assertEqual(2, result.rejected_count)
        self.assertEqual(
            {RepositoryDiagnosticCode.IDENTITY_CONFLICT},
            {item.code for item in result.diagnostics},
        )

    def test_duplicate_observation_identity_never_overwrites_history(self) -> None:
        first = serialize_observation(OBSERVATION_HISTORY[0])
        second = dict(first)
        second["content"] = "Conflicting content"
        payload = empty_payload()
        payload["observations"] = [first, second]
        self.write_payload(payload)
        result = LocalStateStore(self.path).load()
        self.assertEqual((), result.state.observations)
        self.assertEqual(2, result.rejected_count)

    def test_duplicate_active_positions_for_instrument_are_all_rejected(self) -> None:
        first = serialize_position(PROFIT_POSITION)
        second = serialize_position(replace(PROFIT_POSITION, position_id="position.second-active"))
        payload = empty_payload()
        payload["positions"] = [first, second]
        self.write_payload(payload)
        result = LocalStateStore(self.path).load()
        self.assertEqual((), result.state.positions)
        self.assertEqual(2, result.rejected_count)
        self.assertTrue(all(item.code is RepositoryDiagnosticCode.IDENTITY_CONFLICT for item in result.diagnostics))

    def test_same_symbol_different_instrument_id_round_trips_independently(self) -> None:
        repository = LocalWatchlistRepository(self.path)
        first = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS)
        second = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNYS)
        self.assertTrue(repository.add(first))
        self.assertTrue(repository.add(second))
        loaded = LocalWatchlistRepository(self.path).list_all()
        self.assertEqual({SAME_SYMBOL_XNAS.instrument_id, SAME_SYMBOL_XNYS.instrument_id}, {item.instrument.instrument_id for item in loaded})


def replace_dict(record: dict, **changes) -> dict:
    copied = json.loads(json.dumps(record))
    copied.update(changes)
    return copied


class AtomicityAndSerializationTests(LocalRepositoryTestCase):
    def test_atomic_replace_failure_preserves_existing_valid_file(self) -> None:
        stable = LocalPositionRepository(self.path)
        self.assertTrue(stable.add(PROFIT_POSITION))
        before = self.path.read_bytes()

        def fail_replace(source, destination):
            raise OSError("simulated replace failure")

        failing = LocalPositionRepository(self.path, replace_function=fail_replace)
        with self.assertRaises(RepositoryError) as context:
            failing.add(CNY_POSITION)
        self.assertEqual(RepositoryFailureCode.IO_FAILURE, context.exception.failure.code)
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual((PROFIT_POSITION,), LocalPositionRepository(self.path).list_all())
        self.assertEqual([], list(self.root.glob(".*.tmp")))

    def test_round_trip_all_types_and_unicode(self) -> None:
        watch = replace(WATCHLIST_NORMAL, note="关注：估值与现金流", tags=("长期", "复盘"))
        position = replace(CNY_POSITION, note="手工记录：人民币持仓")
        observation = replace(
            OBSERVATION_HISTORY[0],
            observation_id="observation.unicode",
            content="当时关注它，因为产品周期出现变化。",
            tags=("观察", "历史"),
        )
        self.assertTrue(LocalWatchlistRepository(self.path).add(watch))
        self.assertTrue(LocalPositionRepository(self.path).add(position))
        self.assertTrue(LocalObservationRepository(self.path).add(observation))
        self.assertEqual((watch,), LocalWatchlistRepository(self.path).list_all())
        self.assertEqual((position,), LocalPositionRepository(self.path).list_all())
        self.assertEqual((observation,), LocalObservationRepository(self.path).list_all())
        text = self.path.read_text(encoding="utf-8")
        self.assertIn("关注：估值与现金流", text)
        self.assertIn("当时关注它", text)

    def test_deterministic_serialization_is_independent_of_add_order(self) -> None:
        path_a = self.root / "a.json"
        path_b = self.root / "b.json"
        first = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNAS)
        second = replace(WATCHLIST_NORMAL, instrument=SAME_SYMBOL_XNYS)
        repo_a = LocalWatchlistRepository(path_a)
        repo_a.add(first)
        repo_a.add(second)
        repo_b = LocalWatchlistRepository(path_b)
        repo_b.add(second)
        repo_b.add(first)
        self.assertEqual(path_a.read_bytes(), path_b.read_bytes())

    def test_clear_all_records_persists_valid_empty_state(self) -> None:
        watch = LocalWatchlistRepository(self.path)
        positions = LocalPositionRepository(self.path)
        observations = LocalObservationRepository(self.path)
        watch.add(WATCHLIST_NORMAL)
        positions.add(PROFIT_POSITION)
        observations.add(OBSERVATION_HISTORY[0])
        watch.delete(US_SHARE.instrument_id)
        positions.delete(PROFIT_POSITION.position_id)
        observations.delete(OBSERVATION_HISTORY[0].observation_id)
        result = LocalStateStore(self.path).load()
        self.assertEqual(RepositoryLoadStatus.LOADED, result.status)
        self.assertEqual(0, result.loaded_count)

    def test_file_contains_no_credential_fields(self) -> None:
        LocalWatchlistRepository(self.path).add(WATCHLIST_NORMAL)
        LocalPositionRepository(self.path).add(PROFIT_POSITION)
        text = self.path.read_text(encoding="utf-8").casefold()
        for forbidden in ("api_key", "password", "cookie", "account_token", "brokerage_account", "payment"):
            self.assertNotIn(forbidden, text)


class RepositoryParityTests(LocalRepositoryTestCase):
    def test_watchlist_core_behavior_matches_memory(self) -> None:
        self._watchlist_behavior(InMemoryWatchlistRepository())
        self._watchlist_behavior(LocalWatchlistRepository(self.path))

    def _watchlist_behavior(self, repository: WatchlistRepository) -> None:
        self.assertTrue(repository.add(WATCHLIST_NORMAL))
        self.assertFalse(repository.add(WATCHLIST_NORMAL))
        updated = replace(WATCHLIST_NORMAL, note="updated", priority=WatchlistPriority.HIGH)
        self.assertTrue(repository.replace(updated))
        self.assertEqual(updated, repository.get(US_SHARE.instrument_id))
        self.assertTrue(repository.delete(US_SHARE.instrument_id))
        self.assertFalse(repository.delete(US_SHARE.instrument_id))

    def test_position_core_behavior_matches_memory(self) -> None:
        self._position_behavior(InMemoryPositionRepository())
        self._position_behavior(LocalPositionRepository(self.path))

    def _position_behavior(self, repository: PositionRepository) -> None:
        self.assertTrue(repository.add(PROFIT_POSITION))
        self.assertFalse(repository.add(PROFIT_POSITION))
        updated = replace(PROFIT_POSITION, note="updated")
        self.assertTrue(repository.replace(updated))
        self.assertEqual(updated, repository.get(updated.position_id))
        self.assertTrue(repository.delete(updated.position_id))
        self.assertFalse(repository.delete(updated.position_id))

    def test_observation_core_behavior_matches_memory_and_protects_content(self) -> None:
        for repository in (InMemoryObservationRepository(), LocalObservationRepository(self.path)):
            self.assertIsInstance(repository, ObservationRepository)
            original = OBSERVATION_HISTORY[0]
            self.assertTrue(repository.add(original))
            self.assertFalse(repository.add(original))
            tagged = replace(original, tags=(*original.tags, "new"))
            self.assertTrue(repository.replace(tagged))
            self.assertFalse(repository.replace(replace(tagged, content="overwrite")))
            self.assertEqual(tagged.content, repository.get(tagged.observation_id).content)
            self.assertTrue(repository.delete(tagged.observation_id))

    def test_local_repositories_satisfy_existing_protocols(self) -> None:
        self.assertIsInstance(LocalWatchlistRepository(self.path), WatchlistRepository)
        self.assertIsInstance(LocalPositionRepository(self.path), PositionRepository)
        self.assertIsInstance(LocalObservationRepository(self.path), ObservationRepository)


class IntegrationTests(LocalRepositoryTestCase):
    def test_existing_services_work_after_fresh_repository_instances(self) -> None:
        watch_service = WatchlistService(LocalWatchlistRepository(self.path))
        position_service = PositionService(LocalPositionRepository(self.path), KNOWN_INSTRUMENTS)
        observation_service = ObservationService(LocalObservationRepository(self.path), KNOWN_INSTRUMENTS)
        watch_service.add(US_SHARE, NOW, note="durable")
        position_service.create(PROFIT_POSITION)
        observation_service.create(OBSERVATION_HISTORY[0])

        fresh_watch = WatchlistService(LocalWatchlistRepository(self.path))
        fresh_positions = PositionService(LocalPositionRepository(self.path), KNOWN_INSTRUMENTS)
        fresh_observations = ObservationService(LocalObservationRepository(self.path), KNOWN_INSTRUMENTS)
        self.assertEqual("durable", fresh_watch.get(US_SHARE.instrument_id).note)
        self.assertEqual(PROFIT_POSITION, fresh_positions.get(PROFIT_POSITION.position_id))
        self.assertEqual(OBSERVATION_HISTORY[0], fresh_observations.get(OBSERVATION_HISTORY[0].observation_id))

    def test_reloaded_positions_feed_existing_portfolio_snapshot(self) -> None:
        repository = LocalPositionRepository(self.path)
        for position in MULTI_CURRENCY_POSITIONS:
            self.assertTrue(repository.add(position))
        reloaded = LocalPositionRepository(self.path).list_all()
        snapshot = PortfolioSnapshotService().build(reloaded, MULTI_CURRENCY_QUOTES, as_of=NOW)
        self.assertEqual(3, snapshot.position_count)
        self.assertEqual({"USD", "CNY", "HKD"}, {bucket.currency for bucket in snapshot.currency_groups})
        self.assertIsNone(snapshot.total_market_value)
        self.assertEqual(SnapshotCompleteness.PARTIAL, snapshot.completeness)

    def test_repository_errors_are_distinct_from_adapter_and_service_errors(self) -> None:
        self.copy_fixture("malformed_json.json")
        with self.assertRaises(RepositoryError) as context:
            LocalStateStore(self.path).load()
        self.assertNotIsInstance(context.exception, AdapterError)
        self.assertNotIsInstance(context.exception, ServiceError)


if __name__ == "__main__":
    unittest.main()
