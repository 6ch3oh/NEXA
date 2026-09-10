from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from nexa_radar.candidate_preparation import CandidatePreparationContext
from nexa_radar.domain import ContentType, Provenance, RadarItem, Source, SourceKind
from nexa_radar.ingestion import IngestionContext
from nexa_radar.product_api import AISelectionViewState, RadarApplicationAPI, RadarReadAPI
from nexa_radar.rss_adapter import OfflineRssAdapter
from nexa_radar.rss_fetch import (
    RawRssHttpResponse, RealRssFetchCoordinator, RealRssFetchPolicy, RssFetchResult,
    RssFetchStatus, RssUrlSafetyCode, SafeRssHttpTransport, validate_rss_url,
)
from nexa_radar.workspace_models import (
    AIActionPersistence, AIActionStatus, ModuleRelationType, RadarAIActionType,
    RetentionState, SourceCapability, SourceCapabilityKind, SourceCapabilityMode,
    WatchCadence, WatchTargetType,
)
from nexa_radar.source_adapter import (
    LocalSourceConsumption, ManualSourceAdapter, ManualSourceInput, RssSourceResultProjector,
    SourceAdapterRegistry, SourceAdapterResult,
)
from nexa_radar.workspace_service import create_default_workspace
from nexa_radar.workspace_store import RadarWorkspaceStore


NOW = datetime(2026, 8, 13, 4, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"


def preparation_context() -> CandidatePreparationContext:
    return CandidatePreparationContext(frozenset(), ("ai",), {}, {}, {}, NOW)


def item(index: int, observed: datetime = NOW) -> RadarItem:
    source = Source(SourceKind.MANUAL, "manual:continuous", "Manual", "manual:continuous")
    ref = f"https://example.invalid/continuous/{index}"
    return RadarItem(
        f"continuous-{index}", f"AI local intelligence signal {index}",
        "A sufficiently complete local-first intelligence summary about AI systems and product operations.",
        ref, source, ContentType.ARTICLE, observed,
        Provenance(source.instance_id, "continuous-test:v0.1", ref, observed, f"provider-{index}", True, f"evidence:{index}"),
        observed,
    )


class ContinuousCase(TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.store = RadarWorkspaceStore(Path(self.temp.name) / "continuous.sqlite3")
        self.service = create_default_workspace(self.store, created_at=NOW)
        self.read = RadarReadAPI(self.service, preparation_context())
        self.app = RadarApplicationAPI(self.service, self.read)

    def tearDown(self) -> None:
        self.store.close()
        self.temp.cleanup()

    def persist(self, value: RadarItem, observed: datetime = NOW, *boards: str) -> None:
        self.store.upsert_item(value, observed)
        for board in boards:
            self.store.assign_item_to_board(board, value.item_id, observed)


class BoardAndReadApiTests(ContinuousCase):
    def test_01_custom_board_independent_target_and_ai_fallback(self) -> None:
        self.app.create_board(
            board_id="deep-ai", name="Deep AI", description="Ten local signals", created_at=NOW,
            target_item_count=10, ai_selection_profile="ai-final-v0.1",
        )
        for index in range(14):
            self.persist(item(index), NOW, "home", "deep-ai")
        home = self.read.get_home()
        feed = self.read.get_board_feed("deep-ai")
        self.assertEqual(home.item_count, 5)
        self.assertEqual(feed.item_count, 10)
        self.assertEqual(feed.ai_selection_state, AISelectionViewState.NOT_BOUND_FALLBACK)
        self.assertEqual(len({card.item_id for card in feed.cards}), 10)

    def test_02_board_disable_and_archive(self) -> None:
        self.app.create_board(board_id="state", name="State", description="", created_at=NOW, target_item_count=8)
        self.assertFalse(self.app.set_board_enabled("state", False, updated_at=NOW).enabled)
        archived = self.app.archive_board("state", updated_at=NOW + timedelta(seconds=1))
        self.assertTrue(archived.archived)
        with self.assertRaises(ValueError):
            self.app.set_board_enabled("state", True, updated_at=NOW + timedelta(seconds=2))

    def test_03_item_detail_is_safe_and_actionable(self) -> None:
        value = item(1)
        self.persist(value, NOW, "home")
        detail = self.read.get_item_detail(value.item_id)
        self.assertEqual(detail.full_summary, value.summary)
        self.assertTrue(detail.provenance.traceable)
        self.assertNotIn(value.provenance.original_ref, repr(detail.provenance))
        self.assertTrue(detail.empty_module_links)

    def test_04_preferences_are_editable_and_used_by_read_api(self) -> None:
        updated = self.app.update_current_interests(("Robotics", "Local AI"))
        self.assertEqual(updated.current_interests, ("local ai", "robotics"))
        self.assertEqual(self.read.get_preferences(), updated)


class WatchAndSourceReadinessTests(ContinuousCase):
    def test_05_site_watch_is_ready_only_if_network_allowed(self) -> None:
        self.app.create_watch_target(
            target_id="site-one", board_id="home", target_type=WatchTargetType.SITE,
            display_name="Example feed", query="example feed", reference="https://example.invalid/feed.xml",
            created_at=NOW, cadence=WatchCadence.DAILY,
        )
        view = self.read.list_watch_targets(board_id="home")[0]
        self.assertEqual(view.fulfillment_status, "READY_IF_NETWORK_ALLOWED")
        self.assertIn("REAL_RSS_FETCH:VALIDATED_READ_ONLY", view.fulfillment_requirements)

    def test_06_repository_watch_truthfully_reports_missing_reader(self) -> None:
        self.app.create_watch_target(
            target_id="repo-one", board_id="home", target_type=WatchTargetType.REPOSITORY,
            display_name="Repository", query="repository changes", reference="https://github.com/example/project",
            created_at=NOW, cadence=WatchCadence.WEEKLY,
        )
        view = self.read.list_watch_targets(board_id="home")[0]
        self.assertEqual(view.fulfillment_status, "MISSING_SOURCE_CAPABILITY")
        statuses = {value.capability: value for value in self.read.list_source_statuses()}
        self.assertEqual(statuses["RSS_PARSE"].readiness, "READY_OFFLINE")
        self.assertEqual(statuses["AI_SELECTION"].readiness, "NOT_BOUND")


class AIActionLifecycleTests(ContinuousCase):
    def test_07_saved_action_lifecycle_and_read_api(self) -> None:
        value = item(2)
        self.persist(value)
        request = self.app.create_ai_action_request(
            action_id="action-one", action_type=RadarAIActionType.DEEP_SUMMARY,
            radar_item_id=value.item_id, requested_at=NOW, persistence=AIActionPersistence.SAVED,
        )
        self.assertEqual(self.read.get_ai_action(request.action_id).status, "REQUESTED")
        self.assertEqual(self.app.start_ai_action(request.action_id).status, "RUNNING")
        completed = self.app.complete_ai_action(request.action_id, result_text="Bounded saved result")
        self.assertEqual(completed.status, "COMPLETED")
        self.assertTrue(completed.result_saved)
        self.assertEqual(len(self.read.list_ai_actions(item_id=value.item_id, status=AIActionStatus.COMPLETED)), 1)

    def test_08_invalid_action_transition_is_rejected(self) -> None:
        value = item(3)
        self.persist(value)
        self.app.create_ai_action_request(
            action_id="action-two", action_type=RadarAIActionType.EXTRACT_ACTIONS,
            radar_item_id=value.item_id, requested_at=NOW,
        )
        with self.assertRaises(ValueError):
            self.app.complete_ai_action("action-two", result_text=None)


class RetentionAndIntegrityTests(ContinuousCase):
    def test_09_cleanup_preview_execute_protects_saved_pinned_recent_and_linked(self) -> None:
        old = NOW - timedelta(days=40)
        for index in range(5):
            self.persist(item(index, old), old)
        self.service.save_item("continuous-1", updated_at=NOW)
        self.service.pin_item("continuous-2", updated_at=NOW)
        self.service.link_item_to_module(
            "continuous-3", "creator", ModuleRelationType.CONTENT_IDEA, "Keep as creator input", created_at=NOW,
        )
        self.persist(item(4, NOW), NOW)
        preview = self.read.preview_cleanup(NOW - timedelta(days=30))
        self.assertEqual(preview.candidate_item_ids, ("continuous-0",))
        self.assertEqual(self.app.execute_cleanup(preview), ("continuous-0",))
        self.assertIsNotNone(self.service.get_item("continuous-3"))
        self.assertIn("continuous-4", {value.item_id for value in self.service.list_recent_items(NOW - timedelta(days=1))})

    def test_10_stale_cleanup_preview_is_rejected(self) -> None:
        old = NOW - timedelta(days=40)
        self.persist(item(1, old), old)
        preview = self.read.preview_cleanup(NOW - timedelta(days=30))
        self.service.save_item("continuous-1", updated_at=NOW)
        with self.assertRaises(RuntimeError):
            self.app.execute_cleanup(preview)

    def test_11_sqlite_integrity_and_foreign_keys(self) -> None:
        self.assertEqual(self.store.integrity_check(), ("ok",))
        self.assertTrue(self.store.foreign_keys_enabled())


class FakeTransport:
    def __init__(self, body: bytes, *, final_url: str = "https://example.com/feed.xml", content_type: str = "application/rss+xml") -> None:
        self.body = body
        self.final_url = final_url
        self.content_type = content_type

    def fetch(self, url: str, policy: RealRssFetchPolicy) -> RssFetchResult:
        return RssFetchResult(
            RssFetchStatus.COMPLETED, url, self.final_url, NOW, 200, self.content_type, self.body,
        )


class RealRssFetchContractTests(TestCase):
    def test_12_url_policy_rejects_local_and_private_targets(self) -> None:
        policy = RealRssFetchPolicy()
        self.assertTrue(validate_rss_url("http://example.com/feed", policy).accepted)
        self.assertEqual(validate_rss_url("https://localhost/feed", policy).code, RssUrlSafetyCode.LOCAL_HOST_FORBIDDEN)
        self.assertEqual(validate_rss_url("https://127.0.0.1/feed", policy).code, RssUrlSafetyCode.PRIVATE_ADDRESS_FORBIDDEN)
        accepted = validate_rss_url("https://example.com/feed.xml", policy)
        self.assertTrue(accepted.accepted)
        self.assertTrue(accepted.requires_runtime_dns_validation)

    def test_13_fake_transport_reuses_offline_rss_adapter(self) -> None:
        body = (FIXTURES / "rss_normal.xml").read_bytes()
        result = RealRssFetchCoordinator(FakeTransport(body)).fetch_and_ingest(
            "https://example.com/feed.xml", discovered_at=NOW,
        )
        self.assertEqual(result.fetch.status, RssFetchStatus.COMPLETED)
        self.assertGreater(result.ingestion.accepted_count, 0)

    def test_14_redirect_and_content_type_are_revalidated(self) -> None:
        body = (FIXTURES / "rss_normal.xml").read_bytes()
        with self.assertRaises(ValueError):
            RealRssFetchCoordinator(FakeTransport(body, final_url="https://127.0.0.1/feed")).fetch_and_ingest(
                "https://example.com/feed.xml", discovered_at=NOW,
            )
        with self.assertRaises(ValueError):
            RealRssFetchCoordinator(FakeTransport(body, content_type="text/html")).fetch_and_ingest(
                "https://example.com/feed.xml", discovered_at=NOW,
            )


class ScaleAndRecoveryTests(ContinuousCase):
    def test_15_hundreds_of_items_remain_deterministic(self) -> None:
        self.app.create_board(board_id="scale", name="Scale", description="", created_at=NOW, target_item_count=50)
        for index in range(220):
            self.persist(item(index), NOW, "scale")
        first = self.read.get_board_feed("scale")
        second = self.read.get_board_feed("scale")
        self.assertEqual(first.item_count, 50)
        self.assertEqual(tuple(x.item_id for x in first.cards), tuple(x.item_id for x in second.cards))

    def test_16_reopen_preserves_state(self) -> None:
        value = item(9)
        self.persist(value, NOW, "home")
        db = self.store.path
        self.store.close()
        self.store = RadarWorkspaceStore(db)
        self.service = create_default_workspace(self.store, created_at=NOW)
        self.assertIsNotNone(self.service.get_item(value.item_id))
        self.assertIn(value.item_id, {item.item_id for item in self.service.list_board_items("home")})


class FakeWebAdapter:
    capability_kind = SourceCapabilityKind.NATIVE_WEB
    adapter_identity = "fake-web-dryrun"
    adapter_version = "0.1"

    def project(self, safe_input: object, *, observed_at: datetime) -> SourceAdapterResult:
        if not isinstance(safe_input, RadarItem) or safe_input.source.kind is not SourceKind.WEB:
            raise ValueError("FakeWebAdapter accepts one safe WEB RadarItem")
        return SourceAdapterResult(
            SourceKind.WEB, safe_input.source.instance_id, safe_input.source, (safe_input,), 0,
            (), (), observed_at, self.adapter_identity, self.adapter_version,
        )


class ExtensibilityAndSmokeV2Tests(ContinuousCase):
    @staticmethod
    def web_item() -> RadarItem:
        source = Source(SourceKind.WEB, "web:dryrun", "Web Dry Run", "https://example.com")
        ref = "https://example.com/article"
        return RadarItem(
            "web-dryrun-1", "AI web adapter dry run", 
            "A validated and bounded fourth-source payload used only to prove the generic local adapter contract.",
            ref, source, ContentType.ARTICLE, NOW,
            Provenance(source.instance_id, "fake-web-dryrun:v0.1", ref, NOW, "web-1", True, "dryrun:web-1"), NOW,
        )

    def test_17_fourth_source_registers_without_core_branch(self) -> None:
        registry = SourceAdapterRegistry((
            SourceCapability("web-dryrun", SourceCapabilityKind.NATIVE_WEB, SourceCapabilityMode.FUTURE, True, "Web dry run"),
        ))
        registry.register(FakeWebAdapter())
        result = registry.resolve(SourceCapabilityKind.NATIVE_WEB).project(self.web_item(), observed_at=NOW)
        receipt = LocalSourceConsumption(self.service).consume(
            (result,), IngestionContext(NOW, preparation_context()), board_ids=("home",),
        )
        self.assertEqual(receipt.written_item_ids, ("web-dryrun-1",))
        self.assertEqual(self.service.get_item("web-dryrun-1").source.kind, SourceKind.WEB)  # type: ignore[union-attr]

    def test_18_product_smoke_v2_twenty_steps(self) -> None:
        steps: list[str] = []
        steps.append("01_default_workspace")
        self.app.update_current_interests(("AI", "NEXA")); steps.append("02_edit_interests")
        self.app.create_board(
            board_id="smoke-v2", name="Smoke V2", description="Product loop", created_at=NOW,
            target_item_count=8, ai_selection_profile="ai-final-v0.1",
        ); steps.append("03_create_board")
        self.app.create_watch_target(
            target_id="smoke-site", board_id="smoke-v2", target_type=WatchTargetType.SITE,
            display_name="Smoke Feed", query="smoke feed", reference="https://example.com/feed.xml",
            created_at=NOW, cadence=WatchCadence.DAILY,
        ); steps.append("04_create_watch")
        self.assertEqual(self.read.list_watch_targets(board_id="smoke-v2")[0].fulfillment_status, "READY_IF_NETWORK_ALLOWED"); steps.append("05_plan_watch")
        rss = OfflineRssAdapter(feed_ref="fixture:smoke-v2").ingest((FIXTURES / "rss_normal.xml").read_bytes(), discovered_at=NOW); steps.append("06_parse_rss")
        rss_result = RssSourceResultProjector().project(rss, observed_at=NOW); steps.append("07_project_rss")
        manual_values = tuple(item(index) for index in range(10))
        manual_result = ManualSourceAdapter().project(ManualSourceInput(manual_values[0].source, manual_values), observed_at=NOW); steps.append("08_project_manual")
        web_result = FakeWebAdapter().project(self.web_item(), observed_at=NOW); steps.append("09_project_fourth_source")
        receipt = LocalSourceConsumption(self.service).consume(
            (rss_result, manual_result, web_result), IngestionContext(NOW, preparation_context()),
            board_ids=("home", "smoke-v2"),
        ); self.assertGreaterEqual(len(receipt.written_item_ids), 10); steps.append("10_ingest_multi_source")
        feed = self.read.get_board_feed("smoke-v2"); self.assertEqual(feed.item_count, 8); steps.append("11_read_board_feed")
        selected = feed.cards[0].item_id
        self.assertEqual(self.read.get_item_detail(selected).card.item_id, selected); steps.append("12_read_item_detail")
        self.app.save_item(selected, updated_at=NOW); steps.append("13_save")
        self.app.mark_read_later(feed.cards[1].item_id, updated_at=NOW); steps.append("14_read_later")
        self.app.link_item_to_module(selected, "creator", ModuleRelationType.SOURCE_MATERIAL, "Smoke V2 input", created_at=NOW); steps.append("15_link_module")
        request = self.app.create_ai_action_request(
            action_id="smoke-v2-ai", action_type=RadarAIActionType.CREATOR_INSIGHT,
            radar_item_id=selected, requested_at=NOW, persistence=AIActionPersistence.SAVED,
        ); steps.append("16_request_ai")
        self.app.start_ai_action(request.action_id); steps.append("17_start_ai")
        self.app.complete_ai_action(request.action_id, result_text="Smoke V2 bounded result"); steps.append("18_complete_ai")
        self.assertEqual(self.read.preview_cleanup(NOW - timedelta(days=30)).candidate_count, 0); steps.append("19_cleanup_preview")
        db = self.store.path; self.store.close(); self.store = RadarWorkspaceStore(db)
        self.service = create_default_workspace(self.store, created_at=NOW)
        self.read = RadarReadAPI(self.service, preparation_context())
        self.assertEqual(self.store.integrity_check(), ("ok",)); steps.append("20_reopen_integrity")
        self.assertEqual(len(steps), 20)
