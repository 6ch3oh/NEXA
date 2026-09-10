"""Acceptance tests for Creator Ops Local Production UI V0.1."""

from __future__ import annotations

import ast
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
UI_ROOT = SRC_ROOT / "creator_ops" / "ui"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from creator_ops import CommandStatus, create_creator_ops_application  # noqa: E402
from creator_ops.ui import CreatorOpsUIAdapter, CreatorOpsUIHost  # noqa: E402


UTC = timezone.utc


class UIContractGuardTests(unittest.TestCase):
    def test_ui_python_imports_only_public_creator_ops_surface(self) -> None:
        forbidden = (
            "creator_ops.persistence", "creator_ops.query", "creator_ops.services",
            "creator_ops.domain", "creator_ops.legacy", "creator_ops.workflow",
        )
        for path in UI_ROOT.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            imported: list[str] = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported.extend(alias.name for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported.append(node.module)
            self.assertFalse(
                [name for name in imported if name.startswith(forbidden)],
                f"{path.name} bypasses CreatorOpsApplication public boundary",
            )

    def test_static_product_contract_and_offline_boundary(self) -> None:
        html = (UI_ROOT / "static" / "index.html").read_text(encoding="utf-8")
        script = (UI_ROOT / "static" / "app.js").read_text(encoding="utf-8")
        styles = (UI_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
        combined = html + script
        for label in (
            "星枢 · 自媒体运营", "高级管理 · 仅本机", "NEXA Desktop 为日常入口",
            "总览", "工作队列", "内容", "账号", "素材", "审核", "发布", "研究",
            "运行状态", "视觉审核", "人工业务审核", "回填表现", "发布后复盘",
        ):
            self.assertIn(label, combined)
        for leaked_markup in (
            '>Dashboard<', '>Work Queue<', '>Content<', '>Accounts<', '>Assets<',
            '>Reviews<', '>Publishing<', '>Research<', '>Health<', '>LOADING<',
            'panel("Current Work"', 'panel("Account Snapshot"',
            'panel("Production / System"', '>Open Editorial Decision<',
        ):
            self.assertNotIn(leaked_markup, combined)
        self.assertIn('node.textContent = displayLabel(health.status)', script)
        for internal, product in (
            ("PENDING", "待处理"), ("READY", "已就绪"), ("BLOCKED", "已阻塞"),
            ("PASS", "已通过"), ("FAIL", "失败"),
        ):
            self.assertIn(f'{internal}: "{product}"', script)
        for state in ("loading", "empty", "error", "degraded"):
            self.assertIn(state, combined.lower())
        self.assertNotIn("https://", combined + styles)
        self.assertNotIn("http://", combined + styles)
        self.assertIn(":focus-visible", styles)
        self.assertIn("manual_confirmation", script)
        self.assertIn("human_confirmation", script)
        for label in ("全部", "最近", "作品集", "宫格", "PotPlayer 观看", "重新定位"):
            self.assertIn(label, script)
        self.assertIn("[4,9,16]", script)
        self.assertIn(".work-thumb:hover", styles)
        self.assertIn("scale(1.045)", styles)

    def test_host_rejects_non_loopback_binding(self) -> None:
        app = create_creator_ops_application(Path(tempfile.gettempdir()) / "unused-ui.sqlite3")
        try:
            with self.assertRaisesRegex(ValueError, "127.0.0.1"):
                CreatorOpsUIHost(app, host="0.0.0.0")
        finally:
            app.close()


class LocalUIHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "creator_ops_ui.sqlite3"
        self.now = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
        self.app = create_creator_ops_application(self.db)
        self.app.initialize_local_store(confirmation=True)
        self.assertIs(self.app.create_creator(
            creator_id="creator-ui", name="UI Creator", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.create_account(
            account_id="account-ui", creator_id="creator-ui", platform="local-test",
            account_name="ui-account", display_name="UI Account",
            content_direction="UI acceptance", legacy_account_code="A1", now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.assertIs(self.app.create_idea(
            content_id="content-ui", creator_id="creator-ui", target_accounts=("account-ui",),
            topic="Local UI acceptance", content_type="IMAGE_POST",
            platform_intent=("local-test",), now=self.now,
        ).status, CommandStatus.SUCCESS)
        self.host = CreatorOpsUIHost(self.app, port=0).start()

    def tearDown(self) -> None:
        self.host.shutdown()
        self.temp.cleanup()

    def get_json(self, path: str) -> tuple[dict, object]:
        with urlopen(self.host.url.rstrip("/") + path, timeout=5) as response:
            return json.load(response), response.headers

    def post_control_json(self, path: str, payload: dict, *, token: str = "works-test-token") -> tuple[dict, object]:
        request = Request(
            self.host.url.rstrip("/") + path,
            data=json.dumps(payload).encode("utf-8"), method="POST", headers={
                "Content-Type": "application/json", "X-Creator-Ops-Control": token,
            },
        )
        with urlopen(request, timeout=5) as response:
            return json.load(response), response.headers

    def test_dashboard_queue_content_account_health_and_security_headers(self) -> None:
        with urlopen(self.host.url, timeout=5) as response:
            html = response.read().decode("utf-8")
            self.assertIn(self.host.csrf_token, html)
            self.assertIn("星枢 · 自媒体运营", html)
            self.assertIn("高级管理 · 仅本机", html)
            self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")

        bootstrap, _ = self.get_json("/api/v1/bootstrap")
        self.assertEqual(len(bootstrap["navigation"]), 10)
        self.assertEqual(
            [item["label"] for item in bootstrap["navigation"]],
            ["总览", "作品", "工作队列", "内容", "账号", "素材", "审核", "发布", "研究", "运行状态"],
        )
        self.assertEqual(bootstrap["safety"]["automatic_publishing"], "NONE")
        for path in (
            "/api/v1/dashboard", "/api/v1/work-queue", "/api/v1/contents",
            "/api/v1/contents/content-ui", "/api/v1/accounts",
            "/api/v1/accounts/account-ui", "/api/v1/assets", "/api/v1/reviews",
            "/api/v1/publishing", "/api/v1/research", "/api/v1/health",
        ):
            payload, _ = self.get_json(path)
            self.assertIsInstance(payload, dict, path)

        contents, _ = self.get_json("/api/v1/contents")
        self.assertEqual(contents["items"][0]["content"]["content_id"], "content-ui")

    def test_write_guard_and_temp_database_command_route(self) -> None:
        request = Request(
            self.host.url.rstrip("/") + "/api/v1/actions/recover_runtime",
            data=b"{}", method="POST", headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(HTTPError) as caught:
            urlopen(request, timeout=5)
        self.assertEqual(caught.exception.code, 403)

        request.add_header("X-Creator-Ops-Token", self.host.csrf_token)
        request.add_header("Origin", self.host.url.rstrip("/"))
        with urlopen(request, timeout=5) as response:
            payload = json.load(response)
        self.assertTrue(payload["ok"])

        queue, _ = self.get_json("/api/v1/work-queue")
        item = next(row for row in queue["items"] if row["content_id"] == "content-ui")
        body = json.dumps({
            "work_item_id": item["work_item_id"],
            "content_id": item["content_id"],
            "status": "IN_PROGRESS",
            "operator_notes": "UI temp DB acceptance",
        }).encode("utf-8")
        command = Request(
            self.host.url.rstrip("/") + "/api/v1/actions/update_work_item",
            data=body, method="POST", headers={
                "Content-Type": "application/json",
                "X-Creator-Ops-Token": self.host.csrf_token,
                "Origin": self.host.url.rstrip("/"),
            },
        )
        with urlopen(command, timeout=5) as response:
            result = json.load(response)
        self.assertTrue(result["ok"])

    def test_shutdown_reopen_and_state_preserved(self) -> None:
        first_port = self.host.port
        self.host.shutdown()
        reopened_app = create_creator_ops_application(self.db)
        self.host = CreatorOpsUIHost(reopened_app, port=first_port).start()
        contents, _ = self.get_json("/api/v1/contents")
        ids = {row["content"]["content_id"] for row in contents["items"]}
        self.assertIn("content-ui", ids)

    def test_works_control_handoff_query_media_range_and_sanitized_error(self) -> None:
        from creator_ops.application.works import LocalWorksService
        works = LocalWorksService(
            self.app._root.store, nexa_root=self.temp.name,
            managed_root=Path(self.temp.name) / "managed", cache_root=Path(self.temp.name) / "cache",
        )
        self.app._root.works_service = works
        self.host._control_token = "works-test-token"
        image = Path(self.temp.name) / "real.jpg"
        image.write_bytes(b"local-image-content")
        video = Path(self.temp.name) / "real.mp4"
        video.write_bytes(b"0123456789-video-content")
        intake, _ = self.post_control_json("/api/v1/integration/works/command", {
            "operation": "intake", "resources": [
                {"kind": "file", "absolute_path": str(image)},
                {"kind": "file", "absolute_path": str(video)},
            ],
        })
        self.assertEqual(len(intake["items"]), 1)
        work = intake["items"][0]
        listed, _ = self.post_control_json("/api/v1/integration/works/query", {
            "operation": "list", "view": "all",
        })
        self.assertEqual(listed["items"][0]["work_id"], work["work_id"])
        detail, _ = self.post_control_json("/api/v1/integration/works/query", {
            "operation": "detail", "work_id": work["work_id"],
        })
        self.assertEqual(len(detail["work"]["media"]), 2)
        video_id = next(item["media_id"] for item in work["media"] if item["media_type"] == "VIDEO")
        request = Request(
            self.host.url.rstrip("/") + f"/api/v1/works/media/{video_id}/content",
            headers={"Range": "bytes=2-7"},
        )
        with urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), b"234567")
            self.assertEqual(response.headers["Content-Range"], "bytes 2-7/24")
        image_id = next(item["media_id"] for item in work["media"] if item["media_type"] == "IMAGE")
        with self.assertRaises(HTTPError) as caught:
            self.post_control_json("/api/v1/integration/works/command", {
                "operation": "open_potplayer", "media_id": image_id,
            })
        self.assertEqual(caught.exception.code, 400)
        error = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(error["error"]["code"], "NOT_VIDEO")


if __name__ == "__main__":
    unittest.main()
