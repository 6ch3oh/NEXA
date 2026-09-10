from __future__ import annotations

import ast
from datetime import UTC, datetime
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from nexa_radar.candidate_preparation import CandidatePreparationContext, ProjectMatchingRule
from nexa_radar.domain import ContentType, Provenance, RadarItem, Source, SourceKind, UserState
from nexa_radar.ingestion import IngestionContext, MultiSourceIngestion
from nexa_radar.legacy_adapter import LegacyRadarAdapter
from nexa_radar.legacy_result import LegacyCollectorVersion, LegacyExecutionStatus, LegacyResultContext, LegacyResultValidator
from nexa_radar.product_api import (
    AISelectionViewState,
    RadarApplicationAPI,
    RadarCardAction,
    RadarReadAPI,
    RadarWatchTargetAction,
    WatchObservationState,
)
from nexa_radar.rss_adapter import OfflineRssAdapter
from nexa_radar.source_adapter import (
    LegacySourceResultProjector,
    LocalSourceConsumption,
    ManualSourceAdapter,
    ManualSourceInput,
    RssSourceResultProjector,
    SourceAdapterNotice,
    SourceAdapterNoticeSeverity,
    SourceAdapterRegistry,
    SourceAdapterResult,
    create_default_source_adapter_registry,
)
from nexa_radar.workspace_models import ModuleRelationType, RadarAIActionType, RetentionState, SourceCapabilityKind, WatchCadence, WatchTargetStatus, WatchTargetType
from nexa_radar.workspace_service import WorkspaceIngestionSink, create_default_workspace
from nexa_radar.workspace_store import RadarWorkspaceStore


NOW = datetime(2026, 8, 13, 2, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"
MODULE_ROOT = Path(__file__).parents[1] / "nexa_radar"


def context() -> CandidatePreparationContext:
    return CandidatePreparationContext(
        frozenset({"nexa"}),
        ("ai", "creator"),
        {"nexa": ProjectMatchingRule(keywords=("nexa", "workflow"))},
        {"ai": ("automation",), "creator": ("content",)},
        {},
        NOW,
    )


def manual_items(count: int = 5) -> tuple[RadarItem, ...]:
    source = Source(SourceKind.MANUAL, "manual:product-smoke", "Manual Product Smoke", "manual:product-smoke")
    values = []
    for index in range(count):
        ref = f"https://manual.invalid/product/{index}"
        values.append(RadarItem(
            f"manual-product-{index}",
            f"NEXA AI workflow product insight {index}",
            "A complete bounded summary about NEXA workflow automation, AI product operations, creator content, and reliable local systems.",
            ref, source, ContentType.ARTICLE, NOW,
            Provenance(source.instance_id, "manual-product:v0.1", ref, NOW, f"manual-{index}", True, f"manual-evidence:{index}"),
            NOW,
        ))
    return tuple(values)


def legacy_result(index: int = 0):
    payload = json.loads((FIXTURES / "legacy_v1_4_success.json").read_text(encoding="utf-8"))
    payload["ai_name"] = f"NEXA Legacy AI workflow {index}"
    payload["source_url"] = f"https://legacy.invalid/product/{index}"
    validation = LegacyResultValidator().validate(payload, context=LegacyResultContext(
        LegacyCollectorVersion.V1_4, "workflow-product", f"execution-product-{index}", LegacyExecutionStatus.OBSERVED_SUCCESS,
    ))
    return LegacyRadarAdapter().convert(validation, reference_time=NOW)


class ProductCase(TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.db = Path(self.temp.name) / "product.sqlite3"
        self.store = RadarWorkspaceStore(self.db)
        self.service = create_default_workspace(self.store, created_at=NOW)
        self.read = RadarReadAPI(self.service, context())
        self.app = RadarApplicationAPI(self.service, self.read)
        self.registry = create_default_source_adapter_registry(self.store.list_capabilities())

    def tearDown(self) -> None:
        self.store.close()
        self.temp.cleanup()

    def ingest(self, results: tuple[SourceAdapterResult, ...]) -> tuple[str, ...]:
        receipt = LocalSourceConsumption(self.service).consume(
            results, IngestionContext(NOW, context()), board_ids=("home",),
        )
        return receipt.written_item_ids


class AdapterBoundaryTests(ProductCase):
    def test_01_rss_unified_result(self) -> None:
        rss = OfflineRssAdapter(feed_ref="fixture:product-rss").ingest((FIXTURES / "rss_normal.xml").read_bytes(), discovered_at=NOW)
        result = RssSourceResultProjector().project(rss, observed_at=NOW)
        self.assertEqual(result.source_kind, SourceKind.RSS)
        self.assertEqual(len(result.accepted_items), rss.accepted_count)
        self.assertEqual(result.adapter_identity, "rss-atom:v0.1")

    def test_02_legacy_unified_result(self) -> None:
        result = LegacySourceResultProjector().project(legacy_result(), observed_at=NOW)
        self.assertEqual(result.source_kind, SourceKind.N8N)
        self.assertEqual(len(result.accepted_items), 1)
        self.assertTrue(result.accepted_items[0].provenance.traceable)

    def test_03_manual_unified_result(self) -> None:
        items = manual_items(2)
        result = ManualSourceAdapter().project(ManualSourceInput(items[0].source, items), observed_at=NOW)
        self.assertEqual(result.source_kind, SourceKind.MANUAL)
        self.assertEqual(result.accepted_items, items)

    def test_04_registry_resolves_three_capabilities(self) -> None:
        self.assertEqual(set(self.registry.registered_kinds()), {
            SourceCapabilityKind.RSS, SourceCapabilityKind.LEGACY_N8N_RESULT, SourceCapabilityKind.MANUAL,
        })
        for kind in self.registry.registered_kinds():
            self.assertEqual(self.registry.resolve(kind).capability_kind, kind)

    def test_05_provider_neutral_result_fields(self) -> None:
        result = ManualSourceAdapter().project(ManualSourceInput(manual_items(1)[0].source, manual_items(1)), observed_at=NOW)
        self.assertEqual(result.__slots__, (
            "source_kind", "source_identity", "source", "accepted_items", "rejected_count",
            "issues", "warnings", "observed_at", "adapter_identity", "adapter_version", "result_version",
        ))
        self.assertNotIn("raw", " ".join(result.__slots__))

    def test_06_rejected_legacy_projects_structured_issue(self) -> None:
        rejected = LegacyRadarAdapter().convert({})
        result = LegacySourceResultProjector().project(rejected, observed_at=NOW)
        self.assertEqual(result.rejected_count, 1)
        self.assertEqual(result.issues[0].severity, SourceAdapterNoticeSeverity.ERROR)

    def test_07_batch_retains_source_provenance(self) -> None:
        items = manual_items(1)
        result = ManualSourceAdapter().project(ManualSourceInput(items[0].source, items), observed_at=NOW)
        batch = result.to_ingestion_batch(batch_id="batch-provenance")
        self.assertEqual(batch.items[0].provenance.source_instance_id, batch.source.instance_id)
        self.assertTrue(batch.items[0].provenance.traceable)

    def test_08_future_source_contract_ready(self) -> None:
        protocol_methods = {value for value in dir(type("Fake", (), {}))}
        self.assertIn("project", RssSourceResultProjector.__dict__)
        self.assertNotIn("fetch", RssSourceResultProjector.__dict__)

    def test_08b_unified_consumer_reaches_workspace(self) -> None:
        items = manual_items(2)
        projected = ManualSourceAdapter().project(ManualSourceInput(items[0].source, items), observed_at=NOW)
        receipt = LocalSourceConsumption(self.service).consume(
            (projected,), IngestionContext(NOW, context()), board_ids=("home",),
        )
        self.assertEqual(receipt.written_item_ids, tuple(value.item_id for value in items))
        self.assertEqual(len(self.store.list_items()), 2)


class ReadAndViewModelTests(ProductCase):
    def setUp(self) -> None:
        super().setUp()
        items = manual_items(7)
        manual = ManualSourceAdapter().project(ManualSourceInput(items[0].source, items), observed_at=NOW)
        self.ingest((manual,))
        self.app.create_watch_target(
            target_id="watch-product", board_id="home", target_type=WatchTargetType.TOPIC,
            display_name="Product topic", query="local radar", created_at=NOW, cadence=WatchCadence.DAILY,
        )

    def test_09_home_default_five_and_safe_cards(self) -> None:
        home = self.read.get_home()
        self.assertEqual(home.item_count, 5)
        self.assertEqual(home.board_title, "Home")
        self.assertFalse(home.empty_state)
        self.assertEqual(home.ai_selection_state, AISelectionViewState.NOT_REQUESTED)
        self.assertLessEqual(max(len(value.short_summary) for value in home.cards), 240)

    def test_10_card_fields_actions_and_no_internals(self) -> None:
        card = self.read.get_home().cards[0]
        required = {RadarCardAction.SAVE, RadarCardAction.PIN, RadarCardAction.READ_LATER,
                    RadarCardAction.NOT_INTERESTED, RadarCardAction.OPEN_SOURCE,
                    RadarCardAction.DEEP_SUMMARY, RadarCardAction.NEXA_RELEVANCE_ANALYSIS,
                    RadarCardAction.CREATOR_INSIGHT, RadarCardAction.GENERATE_CONTENT_IDEAS,
                    RadarCardAction.EXTRACT_ACTIONS}
        self.assertTrue(required <= set(card.available_actions))
        self.assertNotIn("provenance", card.__slots__)
        self.assertNotIn("metadata", card.__slots__)
        self.assertEqual(card.source_ref, f"https://manual.invalid/product/{card.item_id.rsplit('-', 1)[-1]}")

    def test_11_boards_get_and_items(self) -> None:
        boards = self.read.list_boards()
        self.assertEqual(self.read.get_board("home").item_count, 7)
        self.assertEqual(len(self.read.get_board_items("home")), 7)
        self.assertTrue(any(value.board_id == "home" for value in boards))

    def test_12_watch_targets_filters_and_not_run(self) -> None:
        target = self.read.list_watch_targets(board_id="home", status=WatchTargetStatus.ACTIVE)[0]
        self.assertEqual(target.observation_state, WatchObservationState.NOT_RUN)
        self.assertIsNone(target.last_observed_at)
        self.assertIn(RadarWatchTargetAction.PAUSE, target.available_actions)

    def test_13_saved_pinned_read_later(self) -> None:
        ids = tuple(value.item_id for value in self.read.get_home().cards[:3])
        self.app.save_item(ids[0], updated_at=NOW)
        self.app.pin_item(ids[1], updated_at=NOW)
        self.app.mark_read_later(ids[2], updated_at=NOW)
        self.assertEqual(self.read.list_saved_items()[0].retention_state, RetentionState.SAVED.value)
        self.assertEqual(self.read.list_pinned_items()[0].retention_state, RetentionState.PINNED.value)
        self.assertEqual(self.read.list_read_later_items()[0].user_feedback, UserState.READ_LATER.value)
        self.assertEqual(self.service.effective_retention(ids[2])[0], RetentionState.EPHEMERAL)

    def test_14_module_queries_generic(self) -> None:
        item_id = self.read.get_home().cards[0].item_id
        self.app.link_item_to_module(item_id, "15", ModuleRelationType.SOURCE_MATERIAL, "Creator material", created_at=NOW)
        self.assertEqual(self.read.list_item_module_links(item_id)[0].target_module_id, "15")
        self.assertEqual(self.read.list_module_items("15")[0].item_id, item_id)

    def test_15_application_commands_delegate_lifecycle(self) -> None:
        self.app.pause_watch_target("watch-product", updated_at=NOW)
        self.assertEqual(self.read.list_watch_targets(status=WatchTargetStatus.PAUSED)[0].status, "PAUSED")
        self.app.resume_watch_target("watch-product", updated_at=NOW)
        self.app.archive_watch_target("watch-product", updated_at=NOW)
        self.assertEqual(self.read.list_watch_targets(status=WatchTargetStatus.ARCHIVED)[0].status, "ARCHIVED")

    def test_16_no_ai_action_auto_runs(self) -> None:
        self.read.get_home()
        self.assertIsNone(self.store.get_ai_action("automatic"))

    def test_16b_board_commands_use_existing_service(self) -> None:
        created = self.app.create_board(board_id="command-board", name="Command", description="Facade", created_at=NOW)
        updated = self.app.update_board(created.board_id, updated_at=NOW, name="Updated")
        archived = self.app.archive_board(created.board_id, updated_at=NOW)
        self.assertEqual(updated.name, "Updated")
        self.assertTrue(archived.archived)

    def test_16c_ai_command_creates_request_but_does_not_execute(self) -> None:
        item_id = self.read.get_home().cards[0].item_id
        request = self.app.create_ai_action_request(
            action_id="product-ai-action", action_type=RadarAIActionType.DEEP_SUMMARY,
            radar_item_id=item_id, requested_at=NOW,
        )
        record = self.store.get_ai_action(request.action_id)
        self.assertEqual(record.status.value, "REQUESTED")
        self.assertIsNone(record.result_text)


class FeedbackAndProductSmokeTests(ProductCase):
    def all_source_results(self) -> tuple[SourceAdapterResult, ...]:
        rss_adapter = OfflineRssAdapter(feed_ref="fixture:product-smoke-rss")
        rss = rss_adapter.ingest((FIXTURES / "rss_normal.xml").read_bytes(), discovered_at=NOW)
        rss_result = self.registry.resolve(SourceCapabilityKind.RSS).project(rss, observed_at=NOW)
        legacy_results = tuple(
            self.registry.resolve(SourceCapabilityKind.LEGACY_N8N_RESULT).project(legacy_result(index), observed_at=NOW)
            for index in range(2)
        )
        manual = manual_items(5)
        manual_result = self.registry.resolve(SourceCapabilityKind.MANUAL).project(
            ManualSourceInput(manual[0].source, manual), observed_at=NOW,
        )
        return (rss_result, *legacy_results, manual_result)

    def test_17_not_interested_changes_next_recommendation(self) -> None:
        self.ingest(self.all_source_results())
        first = self.read.get_home()
        item_id = first.cards[0].item_id
        self.app.mark_not_interested(item_id, updated_at=NOW)
        second = self.read.get_home()
        self.assertNotIn(item_id, tuple(value.item_id for value in second.cards))
        self.assertNotEqual(tuple(value.item_id for value in first.cards), tuple(value.item_id for value in second.cards))

    def test_18_saved_and_read_later_remain_eligible(self) -> None:
        self.ingest(self.all_source_results())
        first = self.read.get_home()
        saved_id, later_id = first.cards[0].item_id, first.cards[1].item_id
        self.app.save_item(saved_id, updated_at=NOW)
        self.app.mark_read_later(later_id, updated_at=NOW)
        second_ids = {value.item_id for value in self.read.get_home().cards}
        self.assertIn(saved_id, second_ids)
        self.assertIn(later_id, second_ids)

    def test_19_full_product_smoke_reopen(self) -> None:
        written = self.ingest(self.all_source_results())
        self.assertGreaterEqual(len(written), 8)
        home = self.read.get_home()
        self.assertEqual(home.item_count, 5)
        rejected_id, saved_id = home.cards[0].item_id, home.cards[1].item_id
        self.app.mark_not_interested(rejected_id, updated_at=NOW)
        self.app.save_item(saved_id, updated_at=NOW)
        self.app.link_item_to_module(saved_id, "15", ModuleRelationType.SOURCE_MATERIAL, "Creator source", created_at=NOW)
        self.assertNotIn(rejected_id, {value.item_id for value in self.read.get_home().cards})
        source_kinds = {value.source_kind for value in self.read.get_board_items("home")}
        self.assertEqual(source_kinds, {"RSS", "N8N", "MANUAL"})
        self.store.close()
        self.store = RadarWorkspaceStore(self.db)
        self.service = create_default_workspace(self.store, created_at=NOW)
        self.read = RadarReadAPI(self.service, context())
        self.app = RadarApplicationAPI(self.service, self.read)
        self.assertEqual(self.store.retention_state(saved_id), RetentionState.SAVED)
        self.assertEqual(self.read.list_module_items("15")[0].item_id, saved_id)
        self.assertEqual(len(self.store.list_items()), len(set(value.item_id for value in self.store.list_items())))

    def test_20_internal_provenance_retained_after_reopen(self) -> None:
        self.ingest(self.all_source_results())
        before = {value.item_id: (value.source.kind, value.source.instance_id, value.provenance.adapter_id) for value in self.store.list_items()}
        self.store.close(); self.store = RadarWorkspaceStore(self.db)
        after = {value.item_id: (value.source.kind, value.source.instance_id, value.provenance.adapter_id) for value in self.store.list_items()}
        self.assertEqual(before, after)


class ProductSafetyTests(ProductCase):
    def test_21_no_network_background_or_provider_branches(self) -> None:
        paths = (MODULE_ROOT / "source_adapter.py", MODULE_ROOT / "product_api.py")
        imports: set[str] = set()
        source_text = ""
        for path in paths:
            source = path.read_text(encoding="utf-8")
            source_text += source.casefold()
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, ast.Import): imports.update(value.name.split(".")[0] for value in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module: imports.add(node.module.split(".")[0])
        self.assertFalse({"requests", "httpx", "aiohttp", "socket", "threading", "subprocess"} & imports)
        self.assertNotIn("if sourcekind.rss", source_text)
        self.assertNotIn("if sourcekind.n8n", source_text)

    def test_22_dto_has_no_raw_payload_or_external_path(self) -> None:
        manual = manual_items(1)
        self.ingest((ManualSourceAdapter().project(ManualSourceInput(manual[0].source, manual), observed_at=NOW),))
        rendered = repr(self.read.get_board_items("home"))
        self.assertNotIn("provider_item_id", rendered)
        self.assertNotIn("provenance", rendered)
        self.assertNotIn("C:\\", rendered)

    def test_23_registry_does_not_execute_runtime(self) -> None:
        source = (MODULE_ROOT / "source_adapter.py").read_text(encoding="utf-8").casefold()
        self.assertNotIn("subprocess", source)
        self.assertNotIn("requests", source)
        self.assertNotIn("execute n8n", source)
