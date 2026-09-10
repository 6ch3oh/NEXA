"""Integration acceptance for the read-only Creator Ops Home Widget adapter."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from creator_ops import CommandStatus, create_creator_ops_application  # noqa: E402
from creator_ops.ui import CreatorOpsUIHost  # noqa: E402


UTC = timezone.utc


class CreatorOpsHomeWidgetAdapterIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "creator_ops_widget.sqlite3"
        self.now = datetime(2026, 8, 23, 10, 0, tzinfo=UTC)
        self.app = create_creator_ops_application(self.db)
        self.app.initialize_local_store(confirmation=True)
        self.assertIs(self.app.create_creator(
            creator_id="creator-widget", name="Widget Creator", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.create_account(
            account_id="account-widget", creator_id="creator-widget", platform="local-test",
            account_name="widget-account", display_name="Widget Account",
            content_direction="Widget acceptance", legacy_account_code="A1", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.create_idea(
            content_id="content-widget", creator_id="creator-widget",
            target_accounts=("account-widget",), topic="Widget read-only acceptance",
            content_type="IMAGE_POST", platform_intent=("local-test",), now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.host = CreatorOpsUIHost(self.app, port=0).start()

    def tearDown(self) -> None:
        self.host.shutdown()
        self.temp.cleanup()

    def test_public_adapter_consumes_existing_ui_host_get_surfaces_without_database_write(self) -> None:
        before = hashlib.sha256(self.db.read_bytes()).hexdigest()
        entrypoint = (MODULE_ROOT / "src" / "index.mjs").as_uri()
        script = f"""
            import {{
              CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
              createCreatorOpsHomeWidgetAdapter,
            }} from {json.dumps(entrypoint)};
            const host = {{
              getReadiness() {{
                return {{
                  state: 'READY', ready: true,
                  endpoint: {{ url: {json.dumps(self.host.url)} }},
                }};
              }},
              start() {{ throw new Error('widget must not start the host'); }},
              stop() {{ throw new Error('widget must not stop the host'); }},
              execute() {{ throw new Error('widget must not execute operating commands'); }},
            }};
            const adapter = createCreatorOpsHomeWidgetAdapter({{
              creatorOpsHost: host,
              clock: () => '2026-08-23T12:00:00Z',
            }});
            const summary = await adapter.getHomeSummary({{ windowDays: 30 }});
            console.log(JSON.stringify({{
              version: CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
              adapterKeys: Object.keys(adapter),
              summary,
            }}));
        """
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=MODULE_ROOT,
            capture_output=True, text=True, encoding="utf-8", check=True, timeout=30,
        )
        result = json.loads(completed.stdout)
        summary = result["summary"]
        self.assertEqual(result["version"], "0.2.0")
        self.assertEqual(result["adapterKeys"], ["getHomeSummary"])
        self.assertFalse(summary["empty_state"]["is_empty"])
        self.assertEqual(summary["account_matrix"][0]["account_id"], "account-widget")
        self.assertEqual(summary["account_matrix"][0]["legacy_account_code"], "A1")
        self.assertEqual(summary["availability"]["status"], "NON_PRODUCTION_DATA")
        self.assertEqual(summary["account_summaries"][0]["account_id"], "account-widget")
        self.assertEqual(summary["account_summaries"][0]["availability"], "NON_PRODUCTION_DATA")
        self.assertIsNone(summary["account_summaries"][0]["latest_snapshot"]["views"])
        self.assertTrue(summary["performance"]["empty"])
        self.assertIsNone(summary["performance"]["totals"]["views"])
        self.assertGreaterEqual(len(summary["recent_activity"]), 1)
        self.assertEqual(summary["safety"]["write_capability"], "NONE")
        self.assertEqual(summary["safety"]["transport"], "EXISTING_LOOPBACK_UI_HOST_GET_ONLY")
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(), before)


if __name__ == "__main__":
    unittest.main()
