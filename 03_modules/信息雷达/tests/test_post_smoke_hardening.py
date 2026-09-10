from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path

from nexa_radar.ai_selection import NexaAISelectionAdapter, build_ai_selection_provider_request
from nexa_radar.ai_selection_reporting import (
    build_ai_selection_evidence_report,
    build_ai_selection_smoke_report,
    render_ai_selection_smoke_report_utf8,
)
from nexa_radar.credential_free_consumer import (
    CredentialFreeConsumerExecutionAdapter,
    build_credential_free_consumer_request,
)
from nexa_radar.product_api import RadarAISelectionEvidenceViewModel, RadarReadAPI
from nexa_radar.workspace_service import create_default_workspace
from nexa_radar.workspace_store import RadarWorkspaceStore

from tests.test_ai_selection_product import NOW, SelectionProductCase, context
from tests.test_executionhub_cli_transport import fixture_transport, request


FIXTURES = Path(__file__).parent / "fixtures"
UTF8_REASON = "中文选择理由：自媒体、星枢优化、人工智能、摄影、足球、长跑；NEXA Mix ✅。"


class Utf8ProtocolTests(SelectionProductCase):
    def test_chinese_request_projection_and_json_utf8_roundtrip(self):
        entries = self.service.recommend_shortlist(
            self.service.build_home_candidates(context()).prepared_candidates,
            target_count=15,
            current_interests=("自媒体", "星枢优化", "人工智能", "摄影", "足球", "长跑"),
        )
        selection = self.service.prepare_ai_selection_request(
            entries,
            board_id="home",
            requested_at=NOW,
            current_interests=("自媒体", "星枢优化", "人工智能", "摄影", "足球", "长跑"),
        )
        first = replace(
            selection.candidates[0],
            title="人工智能 × 摄影：自媒体观察 ✅",
            summary="星枢优化关注足球、长跑；中英文 Mix，中文标点完整。",
        )
        provider = build_ai_selection_provider_request(
            replace(selection, candidates=(first,) + selection.candidates[1:])
        )
        public = build_credential_free_consumer_request(provider)
        encoded = json.dumps(public, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        decoded = json.loads(encoded.decode("utf-8"))
        candidate = decoded["input"]["candidates"][0]
        self.assertEqual(candidate["title"], first.title)
        self.assertEqual(candidate["summary"], first.summary)
        self.assertEqual(decoded["input"]["current_interests"], list(selection.current_interests))

    def test_subprocess_public_response_and_canonical_mapping_preserve_utf8(self):
        public = fixture_transport().execute(request("fixture-utf8"))
        reason = public["result"]["selections"][0]["reason"]
        self.assertEqual(reason, UTF8_REASON)
        serialized = json.dumps(public, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.assertEqual(json.loads(serialized.decode("utf-8"))["result"]["selections"][0]["reason"], UTF8_REASON)

    def test_utf8_persistence_reopen_home_and_report_rendering(self):
        for index in range(18):
            original = self.service.get_item(f"selection-{index}")
            self.service.add_item(
                replace(
                    original,
                    title=f"人工智能与自媒体观察 {index} ✅",
                    summary="摄影、足球、长跑与星枢优化；中文标点，中英文 Mix。",
                ),
                observed_at=NOW,
                board_ids=("home", "ai", "creator", "nexa-optimization"),
            )
        execution = CredentialFreeConsumerExecutionAdapter(fixture_transport(), clock=lambda: NOW)
        selected = self.app(execution).request_ai_reselection("home", requested_at=NOW)
        home = self.read.get_home()
        self.assertTrue(all(value == UTF8_REASON for value in selected.selected_reasons))
        self.assertTrue(all("人工智能" in card.title for card in home.cards))
        self.assertEqual(build_ai_selection_smoke_report(selected, home)["selected_count"], 5)
        rendered = render_ai_selection_smoke_report_utf8(selected, home)
        self.assertTrue(rendered.endswith(b"\n"))
        self.assertIn(UTF8_REASON, rendered.decode("utf-8"))

        self.store.close()
        self.store = RadarWorkspaceStore(self.db)
        self.service = create_default_workspace(self.store, created_at=NOW)
        self.read = RadarReadAPI(self.service, context())
        reopened = self.read.get_latest_ai_selection("home")
        reopened_home = self.read.get_home()
        self.assertEqual(reopened.selected_reasons, selected.selected_reasons)
        self.assertIn(UTF8_REASON, render_ai_selection_smoke_report_utf8(reopened, reopened_home).decode("utf-8"))


class ReportingContractTests(SelectionProductCase):
    def test_real_smoke_sanitized_evidence_replays_current_viewmodel_fields(self):
        payload = json.loads(
            (FIXTURES / "real_ai_smoke_evidence_viewmodel.json").read_text(encoding="utf-8")
        )
        payload["selected_item_ids"] = tuple(payload["selected_item_ids"])
        payload["selected_reasons"] = tuple(payload["selected_reasons"])
        evidence = RadarAISelectionEvidenceViewModel(**payload)
        report = build_ai_selection_evidence_report(evidence)
        self.assertEqual(report["selected_count"], 5)
        self.assertIn("自媒体", report["selections"][0]["bounded_reason"])
        self.assertNotIn("\ufffd", json.dumps(report, ensure_ascii=False))

    def test_reporting_uses_selected_fields_and_missing_reason_fails_closed(self):
        payload = json.loads(
            (FIXTURES / "real_ai_smoke_evidence_viewmodel.json").read_text(encoding="utf-8")
        )
        payload["selected_item_ids"] = tuple(payload["selected_item_ids"])
        payload["selected_reasons"] = tuple(payload["selected_reasons"])
        evidence = RadarAISelectionEvidenceViewModel(**payload)
        self.assertFalse(hasattr(evidence, "decisions"))
        self.assertEqual(len(evidence.selected_item_ids), len(evidence.selected_reasons))
        with self.assertRaises(ValueError):
            build_ai_selection_evidence_report(replace(evidence, selected_reasons=()))
