from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from creator_ops.api.application import create_creator_ops_application
from creator_ops.api.contracts import CommandStatus


class ResearchRuntimeV02Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(); self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)
        self.db = Path(self.temp.name) / "research.sqlite3"
        self.app = create_creator_ops_application(self.db); self.app.initialize_local_store(confirmation=True)
        self.app.create_creator(creator_id="creator", name="Creator", now=self.now)
        self.app.create_account(
            account_id="B2", creator_id="creator", legacy_account_code="B2", platform="douyin",
            account_name="b2", display_name="B2", content_direction="football AI visual", now=self.now,
        )

    def tearDown(self) -> None:
        self.app.close(); self.temp.cleanup()

    def test_local_source_intake_synthesis_and_topic_planning(self) -> None:
        created = self.app.create_research(
            research_id="research-1", topic="Football visual storytelling", account_id="B2",
            content_intent="educational short video", now=self.now,
        )
        self.assertIs(created.status, CommandStatus.SUCCESS)
        source = self.app.add_research_source(
            "research-1", source_id="source-1", source_type="LEGACY_RESEARCH",
            reference="legacy://case-0004", summary="Use evidence-backed scene changes",
            evidence=("legacy://manifest",), now=self.now,
        )
        duplicate = self.app.add_research_source(
            "research-1", source_id="source-1", source_type="LEGACY_RESEARCH",
            reference="legacy://case-0004", summary="Use evidence-backed scene changes",
            evidence=("legacy://manifest",), now=self.now,
        )
        self.assertIs(source.status, CommandStatus.SUCCESS)
        self.assertIs(duplicate.status, CommandStatus.SUCCESS)
        synthesized = self.app.synthesize_research("research-1", now=self.now)
        self.assertEqual(synthesized.data.status.value, "READY_FOR_CONTENT")
        candidates = self.app.plan_topics("research-1", operator_intent="manual production")
        self.assertTrue(candidates)
        self.assertFalse(any(item.realtime_claim for item in candidates))
        self.assertIn("legacy://manifest", candidates[0].evidence_references)

    def test_no_source_needs_more_evidence(self) -> None:
        self.app.create_research(
            research_id="research-empty", topic="No evidence", account_id="B2",
            content_intent="test", now=self.now,
        )
        # Move into collect with a deliberately empty but valid user note, then synthesize.
        self.app.add_research_source(
            "research-empty", source_id="empty", source_type="USER_NOTE",
            reference="user://note", summary="", evidence=(), now=self.now,
        )
        result = self.app.synthesize_research("research-empty", now=self.now)
        self.assertEqual(result.data.status.value, "NEED_MORE_EVIDENCE")
        with self.assertRaises(Exception):
            self.app.plan_topics("research-empty", operator_intent="")

    def test_restart_preserves_research_and_has_zero_network_dependency(self) -> None:
        self.app.create_research(
            research_id="research-1", topic="Local", account_id="B2",
            content_intent="test", now=self.now,
        )
        self.app.close(); reopened = create_creator_ops_application(self.db)
        try:
            reopened.open()
            self.assertEqual(reopened.list_research()[0].research_id, "research-1")
            self.assertEqual(reopened.health().network_capability, "NONE")
        finally:
            reopened.close()

    def test_research_identity_is_idempotent_only_for_identical_payload(self) -> None:
        first = self.app.create_research(
            research_id="research-idempotent", topic="Local", account_id="B2",
            content_intent="test", now=self.now,
        )
        same = self.app.create_research(
            research_id="research-idempotent", topic="Local", account_id="B2",
            content_intent="test", now=self.now,
        )
        conflict = self.app.create_research(
            research_id="research-idempotent", topic="Changed", account_id="B2",
            content_intent="test", now=self.now,
        )
        self.assertIs(first.status, CommandStatus.SUCCESS)
        self.assertIs(same.status, CommandStatus.SUCCESS)
        self.assertIs(conflict.status, CommandStatus.VALIDATION_ERROR)


if __name__ == "__main__":
    unittest.main()
