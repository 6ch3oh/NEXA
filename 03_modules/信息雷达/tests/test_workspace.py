from __future__ import annotations

import ast
from dataclasses import replace
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from unittest import TestCase

from nexa_radar.candidate_preparation import CandidatePreparationContext, CandidatePreparationPolicy
from nexa_radar.domain import ContentMetadata, ContentType, Provenance, RadarItem, Source, SourceKind, UserFeedback, UserState
from nexa_radar.fixtures import build_recommendation_fixture_entries
from nexa_radar.ingestion import IngestionContext, MultiSourceIngestion, SourceIngestionBatch
from nexa_radar.legacy_adapter import LegacyRadarAdapter
from nexa_radar.legacy_result import LegacyCollectorVersion, LegacyExecutionStatus, LegacyResultContext, LegacyResultValidator
from nexa_radar.rss_adapter import OfflineRssAdapter
from nexa_radar.workspace_models import (
    AIActionPersistence,
    AIActionStatus,
    AIExecutionEvidence,
    AISelectionDecision,
    AISelectionResult,
    BoardRule,
    BoardRuleKind,
    HOME_BOARD_KIND,
    ModuleRelationType,
    RadarAIActionRequest,
    RadarAIActionType,
    RetentionState,
    SourceCapabilityKind,
    SourceCapabilityMode,
    WatchCadence,
    WatchTargetStatus,
    WatchTargetType,
    WORKSPACE_SCHEMA_VERSION,
    board_matches,
    validate_ai_selection_result,
)
from nexa_radar.workspace_service import DEFAULT_HOME_BOARD_ID, RadarWorkspaceService, WorkspaceIngestionSink, create_default_workspace
from nexa_radar.workspace_store import RadarWorkspaceStore


NOW = datetime(2026, 8, 12, 8, 0, tzinfo=UTC)
OLD = NOW - timedelta(days=30)
ROOT = Path(__file__).parents[1]
RSS_XML = (Path(__file__).parent / "fixtures" / "rss_normal.xml").read_bytes()


def manual_item(item_id: str = "manual-workspace", title: str = "AI workflow for NEXA") -> RadarItem:
    source = Source(SourceKind.MANUAL, "manual:workspace", "Manual workspace", "manual:workspace")
    ref = f"https://workspace.invalid/{item_id}"
    return RadarItem(
        item_id, title,
        "A bounded, useful summary about AI workflows, creator operations, NEXA architecture, and personal productivity.",
        ref, source, ContentType.ARTICLE, NOW,
        Provenance(source.instance_id, "manual:v0.1", ref, NOW, item_id, True, f"evidence:{item_id}"),
        NOW,
    )


def preparation_context() -> CandidatePreparationContext:
    return CandidatePreparationContext(frozenset(), ("ai",), {}, {}, {}, NOW)


class WorkspaceCase(TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.db = Path(self.temp.name) / "workspace.sqlite3"
        self.store = RadarWorkspaceStore(self.db)
        self.service = RadarWorkspaceService(self.store)

    def tearDown(self) -> None:
        self.store.close()
        self.temp.cleanup()

    def board(self, board_id: str = "board-one", **changes: object):
        values = dict(board_id=board_id, name="Board", description="Editable", created_at=NOW)
        values.update(changes)
        return self.service.create_board(**values)

    def add(self, item: RadarItem | None = None, boards: tuple[str, ...] = ()) -> RadarItem:
        item = item or manual_item()
        self.service.add_item(item, observed_at=OLD, board_ids=boards)
        return item


class BoardTests(WorkspaceCase):
    def test_01_create_update_archive_list(self) -> None:
        board = self.board()
        self.assertTrue(board.enabled)
        updated = self.service.update_board(board.board_id, updated_at=NOW + timedelta(minutes=1), name="Changed")
        self.assertEqual(updated.name, "Changed")
        self.assertEqual(len(self.service.list_boards()), 1)
        self.service.archive_board(board.board_id, updated_at=NOW + timedelta(minutes=2))
        self.assertEqual(self.service.list_boards(), ())
        self.assertTrue(self.service.list_boards(include_archived=True)[0].archived)

    def test_02_default_home_is_same_board_system_and_target_five(self) -> None:
        create_default_workspace(self.store, created_at=NOW)
        home = self.store.get_board(DEFAULT_HOME_BOARD_ID)
        self.assertEqual(home.target_item_count, 5)
        self.assertEqual(home.board_kind, HOME_BOARD_KIND)

    def test_03_custom_board_and_deterministic_matching(self) -> None:
        board = self.board(include_rules=(BoardRule(BoardRuleKind.KEYWORD, "nexa"),))
        item = manual_item()
        self.assertTrue(board_matches(board, item))
        self.assertEqual(board_matches(board, item), board_matches(board, item))

    def test_04_include_kinds(self) -> None:
        item = manual_item()
        kinds = (
            BoardRule(BoardRuleKind.TOPIC, "workflow"),
            BoardRule(BoardRuleKind.CONTENT_TYPE, "article"),
            BoardRule(BoardRuleKind.SOURCE_KIND, "manual"),
            BoardRule(BoardRuleKind.SOURCE_INSTANCE, "manual:workspace"),
        )
        for index, rule in enumerate(kinds):
            with self.subTest(rule=rule.kind):
                board = self.board(f"kind-{index}", include_rules=(rule,))
                self.assertTrue(board_matches(board, item))

    def test_05_exclusion_wins(self) -> None:
        board = self.board(
            include_rules=(BoardRule(BoardRuleKind.KEYWORD, "nexa"),),
            exclude_rules=(BoardRule(BoardRuleKind.KEYWORD, "workflow"),),
        )
        self.assertFalse(board_matches(board, manual_item()))

    def test_06_seed_is_editable_idempotent_and_configured(self) -> None:
        create_default_workspace(self.store, created_at=NOW)
        create_default_workspace(self.store, created_at=NOW)
        self.assertEqual(len(self.store.list_boards()), 4)
        self.service.archive_board("ai", updated_at=NOW + timedelta(minutes=1))
        interests = json.loads(self.store.get_config("current_interests"))
        self.assertEqual(interests, ["AI", "自媒体", "NEXA 优化"])


class WatchTargetTests(WorkspaceCase):
    def test_07_all_six_types_and_cadence(self) -> None:
        self.board()
        for index, target_type in enumerate(WatchTargetType):
            cadence = tuple(WatchCadence)[index % len(WatchCadence)]
            target = self.service.create_watch_target(
                target_id=f"target-{index}", board_id="board-one", target_type=target_type,
                display_name=target_type.value, query="bounded query", created_at=NOW,
                reference="https://watch.invalid/ref", cadence=cadence,
            )
            self.assertEqual(target.cadence, cadence)
        self.assertEqual(len(self.service.list_watch_targets("board-one")), 6)

    def test_08_pause_resume_archive(self) -> None:
        self.board()
        self.service.create_watch_target(
            target_id="target-life", board_id="board-one", target_type=WatchTargetType.PERSON,
            display_name="Person", query="person", created_at=NOW,
        )
        self.assertEqual(self.service.pause_watch_target("target-life", updated_at=NOW).status, WatchTargetStatus.PAUSED)
        self.assertEqual(self.service.resume_watch_target("target-life", updated_at=NOW).status, WatchTargetStatus.ACTIVE)
        self.assertEqual(self.service.archive_watch_target("target-life", updated_at=NOW).status, WatchTargetStatus.ARCHIVED)
        self.assertEqual(self.service.list_watch_targets(), ())

    def test_09_archived_target_cannot_resume(self) -> None:
        self.board()
        self.service.create_watch_target(target_id="gone", board_id="board-one", target_type=WatchTargetType.TOPIC,
                                         display_name="Topic", query="topic", created_at=NOW)
        self.service.archive_watch_target("gone", updated_at=NOW)
        with self.assertRaises(ValueError):
            self.service.resume_watch_target("gone", updated_at=NOW)


class StoreTests(WorkspaceCase):
    def test_10_sqlite_create_schema_and_tables(self) -> None:
        self.assertTrue(self.db.exists())
        self.assertEqual(self.store.schema_version, WORKSPACE_SCHEMA_VERSION)
        self.assertEqual(set(self.store.table_names()), {
            "ai_actions", "ai_selection_evidence", "board_items", "boards", "module_links", "radar_items",
            "source_capabilities", "user_feedback", "watch_targets", "workspace_config", "workspace_meta",
        })

    def test_11_reopen_persistence(self) -> None:
        self.board()
        self.add()
        self.store.close()
        self.store = RadarWorkspaceStore(self.db)
        self.service = RadarWorkspaceService(self.store)
        self.assertIsNotNone(self.store.get_board("board-one"))
        self.assertIsNotNone(self.store.get_item("manual-workspace"))

    def test_12_transaction_rollback(self) -> None:
        with self.assertRaises(RuntimeError):
            with self.store.transaction() as connection:
                connection.execute("INSERT INTO workspace_config VALUES(?,?)", ("rollback", "value"))
                raise RuntimeError("rollback")
        self.assertIsNone(self.store.get_config("rollback"))

    def test_13_no_duplicate_item_and_multiple_board_membership(self) -> None:
        self.board("a"); self.board("b")
        item = self.add(boards=("a", "b"))
        self.service.add_item(item, observed_at=NOW, board_ids=("a",))
        self.assertEqual(len(self.store.list_items()), 1)
        self.assertEqual(len(self.store.list_board_items("a")), 1)
        self.assertEqual(len(self.store.list_board_items("b")), 1)

    def test_14_rejects_unsupported_schema(self) -> None:
        path = Path(self.temp.name) / "bad.sqlite3"
        connection = sqlite3.connect(path)
        connection.execute("CREATE TABLE workspace_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        connection.execute("INSERT INTO workspace_meta VALUES('workspace_schema_version','future')")
        connection.commit(); connection.close()
        with self.assertRaises(RuntimeError):
            RadarWorkspaceStore(path)

    def test_15_capability_registry_modes(self) -> None:
        create_default_workspace(self.store, created_at=NOW)
        values = {value.kind: value for value in self.store.list_capabilities()}
        self.assertEqual(values[SourceCapabilityKind.RSS].mode, SourceCapabilityMode.NATIVE_LOCAL)
        self.assertEqual(values[SourceCapabilityKind.LEGACY_N8N_RESULT].mode, SourceCapabilityMode.OPTIONAL_LOCAL_LEGACY)
        self.assertEqual(values[SourceCapabilityKind.MANUAL].mode, SourceCapabilityMode.NATIVE_LOCAL)

    def test_15b_versionless_existing_database_rejected(self) -> None:
        path = Path(self.temp.name) / "versionless.sqlite3"
        connection = sqlite3.connect(path)
        connection.execute("CREATE TABLE legacy_data(value TEXT)")
        connection.commit(); connection.close()
        with self.assertRaises(RuntimeError):
            RadarWorkspaceStore(path)


class RetentionAndLinkTests(WorkspaceCase):
    def test_16_default_save_pin_unsave(self) -> None:
        item = self.add()
        self.assertEqual(self.store.retention_state(item.item_id), RetentionState.EPHEMERAL)
        self.service.save_item(item.item_id, updated_at=NOW)
        self.assertEqual(self.store.retention_state(item.item_id), RetentionState.SAVED)
        self.service.pin_item(item.item_id, updated_at=NOW)
        self.assertEqual(self.store.retention_state(item.item_id), RetentionState.PINNED)
        self.service.unsave_item(item.item_id, updated_at=NOW)
        self.assertEqual(self.store.retention_state(item.item_id), RetentionState.EPHEMERAL)

    def test_17_cleanup_is_explicit_and_skips_saved_pinned(self) -> None:
        for state, suffix in ((RetentionState.EPHEMERAL, "e"), (RetentionState.SAVED, "s"), (RetentionState.PINNED, "p")):
            item = manual_item(f"retention-{suffix}")
            self.service.add_item(item, observed_at=OLD)
            self.store.set_retention(item.item_id, state)
        self.assertTrue(self.store.get_item("retention-e"))
        self.assertEqual(self.service.cleanup_expired_ephemeral(NOW), ("retention-e",))
        self.assertIsNotNone(self.store.get_item("retention-s"))
        self.assertIsNotNone(self.store.get_item("retention-p"))

    def test_18_module_link_protects_and_unlink_releases(self) -> None:
        item = self.add()
        link = self.service.link_item_to_module(item.item_id, "15", ModuleRelationType.SOURCE_MATERIAL,
                                                "Creator source", created_at=NOW)
        self.assertEqual(self.service.cleanup_expired_ephemeral(NOW), ())
        self.service.unlink_item_from_module(link.link_id)
        self.assertEqual(self.service.cleanup_expired_ephemeral(NOW), (item.item_id,))

    def test_19_multiple_links_do_not_duplicate_content(self) -> None:
        item = self.add()
        self.service.link_item_to_module(item.item_id, "15", ModuleRelationType.CONTENT_IDEA, "Creator idea", created_at=NOW)
        self.service.link_item_to_module(item.item_id, "03", ModuleRelationType.PROJECT_RELEVANCE, "Engineering", created_at=NOW)
        self.assertEqual(len(self.store.list_module_links(item.item_id)), 2)
        self.assertEqual(len(self.store.list_items()), 1)

    def test_20_effective_retention_reports_protection(self) -> None:
        item = self.add()
        self.assertEqual(self.store.effective_retention(item.item_id), (RetentionState.EPHEMERAL, False))
        self.service.link_item_to_module(item.item_id, "15", ModuleRelationType.REFERENCE, "Reference", created_at=NOW)
        self.assertEqual(self.store.effective_retention(item.item_id), (RetentionState.EPHEMERAL, True))


class FeedbackTests(WorkspaceCase):
    def test_21_all_required_feedback_states_persist(self) -> None:
        item = self.add()
        for state in (UserState.SAVED, UserState.READ_LATER, UserState.NOT_INTERESTED):
            self.service.set_feedback(item.item_id, state, updated_at=NOW)
            self.assertEqual(self.store.get_feedback(item.item_id).state, state)

    def test_22_feedback_survives_reopen(self) -> None:
        item = self.add()
        self.service.set_feedback(item.item_id, UserState.READ_LATER, updated_at=NOW)
        self.store.close(); self.store = RadarWorkspaceStore(self.db); self.service = RadarWorkspaceService(self.store)
        self.assertEqual(self.store.get_feedback(item.item_id).state, UserState.READ_LATER)


class AIContractTests(WorkspaceCase):
    def setUp(self) -> None:
        super().setUp()
        self.board("selection", target_item_count=5)
        self.entries = build_recommendation_fixture_entries()[:8]

    def request(self):
        return self.service.prepare_ai_selection_request(self.entries, board_id="selection", requested_at=NOW,
                                                         current_interests=("AI", "NEXA"))

    def valid_result(self, request):
        return AISelectionResult(
            request.request_id,
            tuple(AISelectionDecision(value.item_id, rank, f"Reason {rank}", 0.9)
                  for rank, value in enumerate(request.candidates[:request.target_count], 1)),
            AIExecutionEvidence("fake-evaluator", "v0.1", "execution-fixture"),
        )

    def test_23_request_is_bounded_provider_neutral_and_target_five(self) -> None:
        request = self.request()
        self.assertEqual(request.target_count, 5)
        self.assertTrue(all(len(value.summary) <= 500 for value in request.candidates))
        self.assertEqual(
            request.candidates[0].__slots__,
            ("item_id", "title", "summary", "recommendation_evidence", "project_relations", "user_feedback_signal",
             "content_type", "source_label", "source_kind"),
        )

    def test_24_deterministic_fake_and_validation(self) -> None:
        request = self.request()
        result = self.valid_result(request)
        self.assertIs(validate_ai_selection_result(request, result), result)
        self.assertEqual(self.valid_result(request), result)

    def test_25_invalid_result_rejected(self) -> None:
        request = self.request()
        bad = replace(self.valid_result(request), decisions=self.valid_result(request).decisions[:-1])
        with self.assertRaises(ValueError):
            validate_ai_selection_result(request, bad)

    def test_26_selection_to_home_view_model(self) -> None:
        request = self.request()
        home = self.service.apply_ai_selection(request, self.valid_result(request), self.entries)
        self.assertEqual(len(home.cards), 5)
        self.assertEqual(home.cards[0].item_id, request.candidates[0].item_id)

    def test_27_ai_action_types_user_only_and_ephemeral_default(self) -> None:
        item = self.add()
        for index, action_type in enumerate(RadarAIActionType):
            request = self.service.create_ai_action_request(
                action_id=f"action-{index}", action_type=action_type, radar_item_id=item.item_id, requested_at=NOW,
            )
            self.service.complete_ai_action(request, result_text="UI-only result")
            self.assertIsNone(self.store.get_ai_action(request.action_id).result_text)
        with self.assertRaises(ValueError):
            RadarAIActionRequest("bad", RadarAIActionType.DEEP_SUMMARY, item.item_id, NOW, requested_by="SYSTEM")

    def test_28_explicit_saved_ai_result_is_bounded_and_persisted(self) -> None:
        item = self.add()
        request = self.service.create_ai_action_request(
            action_id="saved-action", action_type=RadarAIActionType.DEEP_SUMMARY,
            radar_item_id=item.item_id, requested_at=NOW, persistence=AIActionPersistence.SAVED,
        )
        self.service.complete_ai_action(request, result_text="Saved bounded result", status=AIActionStatus.COMPLETED)
        self.assertEqual(self.store.get_ai_action("saved-action").result_text, "Saved bounded result")

    def test_29_no_action_exists_until_explicit_request(self) -> None:
        item = self.add()
        self.assertIsNone(self.store.get_ai_action("automatic"))
        self.assertEqual(self.store.retention_state(item.item_id), RetentionState.EPHEMERAL)


class IntegrationAndSafetyTests(WorkspaceCase):
    def ingestion_result(self, items: tuple[RadarItem, ...]):
        context = IngestionContext(NOW, preparation_context())
        return MultiSourceIngestion().ingest((SourceIngestionBatch(items[0].source, items, NOW),), context)

    def test_30_manual_ingestion_to_workspace_and_membership(self) -> None:
        self.board(include_rules=(BoardRule(BoardRuleKind.KEYWORD, "nexa"),))
        result = self.ingestion_result((manual_item(),))
        written = WorkspaceIngestionSink(self.service).write(result, observed_at=NOW)
        self.assertEqual(written, ("manual-workspace",))
        self.assertEqual(self.store.retention_state(written[0]), RetentionState.EPHEMERAL)
        self.assertEqual(len(self.store.list_board_items("board-one")), 1)

    def test_31_rss_derived_item_to_workspace_raw_xml_absent(self) -> None:
        parsed = OfflineRssAdapter(feed_ref="fixture:workspace-rss").ingest(RSS_XML, discovered_at=NOW)
        result = self.ingestion_result((parsed.items[0],))
        WorkspaceIngestionSink(self.service).write(result, observed_at=NOW)
        stored = self.store.get_item(parsed.items[0].item_id)
        self.assertEqual(stored.source.kind, SourceKind.RSS)
        self.assertNotIn("<rss", self.db.read_bytes().lower().decode("utf-8", errors="ignore"))

    def test_32_legacy_derived_item_to_workspace_raw_result_absent(self) -> None:
        payload = json.loads((Path(__file__).parent / "fixtures" / "legacy_v1_4_success.json").read_text(encoding="utf-8"))
        validated = LegacyResultValidator().validate(payload, context=LegacyResultContext(
            LegacyCollectorVersion.V1_4, "workflow-fixture", "execution-fixture", LegacyExecutionStatus.OBSERVED_SUCCESS,
        ))
        converted = LegacyRadarAdapter().convert(validated, reference_time=NOW)
        result = self.ingestion_result((converted.item,))
        WorkspaceIngestionSink(self.service).write(result, observed_at=NOW)
        self.assertEqual(self.store.get_item(converted.item.item_id).source.kind, SourceKind.N8N)
        self.assertNotIn("webpage_read_status", self.db.read_bytes().decode("utf-8", errors="ignore"))

    def test_33_same_item_twice_no_duplicate(self) -> None:
        item = manual_item()
        sink = WorkspaceIngestionSink(self.service)
        sink.write(self.ingestion_result((item,)), observed_at=NOW)
        sink.write(self.ingestion_result((item,)), observed_at=NOW)
        self.assertEqual(len(self.store.list_items()), 1)

    def test_34_workspace_to_preparation_recommendation_home(self) -> None:
        self.board("open-home", target_item_count=5)
        entries = build_recommendation_fixture_entries()[:10]
        for entry in entries:
            self.service.add_item(entry.item, observed_at=NOW, board_ids=("open-home",))
            self.store.upsert_feedback(entry.user_feedback)
        prepared = self.service.build_home_candidates(preparation_context(), board_id="open-home")
        recommendation = self.service.recommend_board(prepared.prepared_candidates, board_id="open-home", current_interests=("ai",))
        home = self.service.build_home_view(recommendation)
        self.assertGreaterEqual(len(home.cards), 3)
        self.assertLessEqual(len(home.cards), 5)

    def test_35_module_linked_item_remains_available(self) -> None:
        item = self.add()
        self.service.link_item_to_module(item.item_id, "15", ModuleRelationType.SOURCE_MATERIAL, "Fixture", created_at=NOW)
        self.service.cleanup_expired_ephemeral(NOW)
        self.assertIsNotNone(self.store.get_item(item.item_id))

    def test_36_secret_html_and_absolute_path_rejected(self) -> None:
        for title in ("authorization: Bearer value", "<html>large payload", "C:\\Users\\external\\data"):
            with self.subTest(title=title):
                item = replace(manual_item("unsafe"), title=title)
                with self.assertRaises(ValueError):
                    self.store.upsert_item(item, NOW)

    def test_36b_raw_provider_metadata_rejected(self) -> None:
        item = replace(manual_item("unsafe-metadata"), metadata=ContentMetadata("fixture-v0.1", {"raw_payload": "bounded but prohibited"}))
        with self.assertRaises(ValueError):
            self.store.upsert_item(item, NOW)

    def test_37_no_network_background_or_third_party_runtime(self) -> None:
        modules = (ROOT / "nexa_radar" / "workspace_models.py", ROOT / "nexa_radar" / "workspace_store.py", ROOT / "nexa_radar" / "workspace_service.py")
        imported_roots: set[str] = set()
        text = ""
        for path in modules:
            source = path.read_text(encoding="utf-8")
            text += source.casefold()
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import): imported_roots.update(value.name.split(".")[0] for value in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module: imported_roots.add(node.module.split(".")[0])
        self.assertFalse({"requests", "httpx", "aiohttp", "feedparser", "n8n", "rsshub"} & imported_roots)
        self.assertNotIn("threading", imported_roots)
        self.assertNotIn("socket", imported_roots)
        self.assertNotIn("scheduler", text)
