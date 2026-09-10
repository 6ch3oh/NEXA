from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

MODULE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = MODULE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from creator_ops.application.works import LocalWorksService, WorkLocationState, WorksError
from creator_ops.persistence.sqlite_adapter import SQLiteCreatorOpsStore
from creator_ops.ui.adapter import NAVIGATION


NOW = datetime(2026, 8, 28, 4, 0, tzinfo=timezone.utc)


class CreatorOpsWorksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = SQLiteCreatorOpsStore(self.root / "works.sqlite3")
        self.created = {}
        self.service = LocalWorksService(
            self.store, nexa_root=self.root, managed_root=self.root / "自媒体作品",
            cache_root=self.root / "cache",
            created_time_resolver=lambda path, _stat: self.created.get(path.name, NOW),
        )

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def media(self, name: str, *, age_days: int = 0, content: bytes = b"fixture") -> Path:
        path = self.root / name
        path.write_bytes(content)
        self.created[name] = NOW - timedelta(days=age_days)
        return path

    def test_single_multi_video_and_no_copy(self):
        image = self.media("one.jpg")
        video = self.media("clip.mp4", content=b"video-fixture")
        before = {path: path.read_bytes() for path in (image, video)}
        work = self.service.intake_resources([
            {"kind": "file", "absolute_path": str(image)},
            {"kind": "file", "absolute_path": str(video)},
        ], now=NOW)[0]
        self.assertEqual(len(work.media), 2)
        self.assertEqual([item.order_index for item in work.media], [0, 1])
        self.assertEqual([item.media_type.value for item in work.media], ["IMAGE", "VIDEO"])
        self.assertEqual({path: path.read_bytes() for path in (image, video)}, before)
        self.assertFalse(self.service.managed_root.exists())

    def test_folder_is_one_work_with_multiple_ordered_media(self):
        folder = self.root / "重庆夜景"
        folder.mkdir()
        for name in ("002.jpg", "001.jpg", "003.mp4"):
            path = folder / name
            path.write_bytes(name.encode())
            self.created[name] = NOW
        work = self.service.intake_resources([
            {"kind": "directory", "absolute_path": str(folder)},
        ], now=NOW)[0]
        self.assertEqual(work.title, "重庆夜景")
        self.assertEqual(len(work.media), 3)
        self.assertEqual([Path(item.absolute_path).name for item in work.media], ["001.jpg", "002.jpg", "003.mp4"])
        self.assertEqual(work.cover_media_id, work.media[0].media_id)

    def test_recent_uses_created_time_not_import_time(self):
        old = self.media("old.jpg", age_days=300)
        recent = self.media("recent.jpg", age_days=2)
        old_work = self.service.intake_resources([{"kind": "file", "absolute_path": str(old)}], now=NOW)[0]
        recent_work = self.service.intake_resources([{"kind": "file", "absolute_path": str(recent)}], now=NOW)[0]
        recent_ids = {item.work_id for item in self.service.list_works("recent", now=NOW)}
        self.assertNotIn(old_work.work_id, recent_ids)
        self.assertIn(recent_work.work_id, recent_ids)
        self.assertEqual({item.work_id for item in self.service.list_works("all", now=NOW)}, {old_work.work_id, recent_work.work_id})

    def test_portfolio_is_manual_and_persistent(self):
        work = self.service.intake_resources([{"kind": "file", "absolute_path": str(self.media("p.jpg"))}], now=NOW)[0]
        self.assertFalse(work.portfolio)
        self.service.set_portfolio(work.work_id, True)
        reopened = LocalWorksService(self.store, nexa_root=self.root, managed_root=self.root / "自媒体作品")
        self.assertTrue(reopened.get_work(work.work_id).portfolio)
        self.assertFalse(reopened.move_permission)
        reopened.set_portfolio(work.work_id, False)
        self.assertEqual(reopened.list_works("portfolio", now=NOW), ())

    def test_missing_and_relocate_preserve_identity_order_and_portfolio(self):
        source = self.media("moving.jpg")
        work = self.service.intake_resources([{"kind": "file", "absolute_path": str(source)}], now=NOW)[0]
        self.service.set_portfolio(work.work_id, True)
        media_id = work.media[0].media_id
        relocated = self.root / "relocated.jpg"
        source.rename(relocated)
        self.assertEqual(self.service.get_work(work.work_id).media[0].location_state, WorkLocationState.MISSING)
        updated = self.service.relocate(media_id, str(relocated))
        self.assertEqual(updated.work_id, work.work_id)
        self.assertEqual(updated.media[0].media_id, media_id)
        self.assertTrue(updated.portfolio)
        self.assertEqual(updated.media[0].order_index, 0)

    def test_move_permission_boundary_collision_and_identity(self):
        source = self.media("move.jpg")
        work = self.service.intake_resources([{"kind": "file", "absolute_path": str(source)}], now=NOW)[0]
        with self.assertRaisesRegex(WorksError, "权限"):
            self.service.move_to_managed(work.work_id, explicit_user_intent=True)
        self.service.set_move_permission(True)
        with self.assertRaisesRegex(WorksError, "explicit"):
            self.service.move_to_managed(work.work_id, explicit_user_intent=False)
        moved = self.service.move_to_managed(work.work_id, explicit_user_intent=True)
        self.assertEqual(moved.work_id, work.work_id)
        self.assertEqual(moved.media[0].media_id, work.media[0].media_id)
        self.assertEqual(moved.media[0].location_state, WorkLocationState.MANAGED)
        self.assertFalse(source.exists())
        self.assertTrue(Path(moved.media[0].absolute_path).is_file())

    def test_collision_never_overwrites(self):
        source = self.media("same.jpg", content=b"source")
        work = self.service.intake_resources([{"kind": "file", "absolute_path": str(source)}], now=NOW)[0]
        target = self.service.managed_root / work.work_id / source.name
        target.parent.mkdir(parents=True)
        target.write_bytes(b"existing")
        self.service.set_move_permission(True)
        with self.assertRaisesRegex(WorksError, "same name"):
            self.service.move_to_managed(work.work_id, explicit_user_intent=True)
        self.assertEqual(source.read_bytes(), b"source")
        self.assertEqual(target.read_bytes(), b"existing")

    def test_contract_has_no_delete_shell_or_canonical_asset_side_effect(self):
        schema = (Path(__file__).parents[1] / "src" / "creator_ops" / "persistence" / "schema_v0_1.sql").read_text(encoding="utf-8")
        source = (Path(__file__).parents[1] / "src" / "creator_ops" / "application" / "works.py").read_text(encoding="utf-8")
        self.assertIn("local_works", schema)
        self.assertNotIn("canonical_asset_id", schema.split("-- Local Works V0.1", 1)[1])
        self.assertNotIn("shell=True", source)
        self.assertNotIn("unlink(source", source)
        self.assertIn(("works", "作品"), NAVIGATION)

    def test_thumbnail_is_generated_on_demand_then_reused(self):
        image = self.media("thumbnail.jpg")
        calls = []

        def render(args, **kwargs):
            calls.append((args, kwargs))
            Path(args[-1]).write_bytes(b"thumbnail-cache")

        self.service.process_runner = render
        self.service._ffmpeg_path = lambda: self.root / "ffmpeg.exe"
        media_id = self.service.intake_resources([
            {"kind": "file", "absolute_path": str(image)},
        ], now=NOW)[0].media[0].media_id
        first = self.service.thumbnail_path(media_id)
        second = self.service.thumbnail_path(media_id)
        self.assertEqual(first, second)
        self.assertEqual(first.read_bytes(), b"thumbnail-cache")
        self.assertEqual(len(calls), 1)
        self.assertIsInstance(calls[0][0], list)
        self.assertNotIn("shell", calls[0][1])

    def test_potplayer_available_missing_invalid_and_video_only(self):
        video = self.media("watch.mp4", content=b"video")
        image = self.media("still.jpg")
        video_media = self.service.intake_resources([
            {"kind": "file", "absolute_path": str(video)},
        ], now=NOW)[0].media[0]
        image_media = self.service.intake_resources([
            {"kind": "file", "absolute_path": str(image)},
        ], now=NOW)[0].media[0]
        self.service._discover_potplayer = lambda: None
        with self.assertRaisesRegex(WorksError, "PotPlayer"):
            self.service.open_potplayer(video_media.media_id)
        invalid = self.root / "other-player.exe"
        invalid.write_bytes(b"fixture")
        with self.assertRaisesRegex(WorksError, "not PotPlayer"):
            self.service.configure_potplayer(str(invalid))
        executable = self.root / "PotPlayerMini64.exe"
        executable.write_bytes(b"fixture")
        launched = []
        self.service.process_launcher = lambda args, **kwargs: launched.append((args, kwargs))
        self.assertTrue(self.service.configure_potplayer(str(executable))["available"])
        self.service.open_potplayer(video_media.media_id)
        self.assertEqual(launched[0][0], [str(executable), str(video.resolve())])
        self.assertEqual(launched[0][1], {"close_fds": True})
        with self.assertRaisesRegex(WorksError, "video"):
            self.service.open_potplayer(image_media.media_id)

    def test_move_failure_rolls_back_all_fixture_files(self):
        first = self.media("rollback-a.jpg", content=b"a")
        second = self.media("rollback-b.jpg", content=b"b")
        work = self.service.intake_resources([
            {"kind": "file", "absolute_path": str(first)},
            {"kind": "file", "absolute_path": str(second)},
        ], now=NOW)[0]
        self.service.set_move_permission(True)
        import creator_ops.application.works as works_module
        real_move = works_module.shutil.move
        calls = 0

        def fail_second(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("fixture move failure")
            return real_move(source, target)

        with patch.object(works_module.shutil, "move", side_effect=fail_second):
            with self.assertRaisesRegex(OSError, "fixture move failure"):
                self.service.move_to_managed(work.work_id, explicit_user_intent=True)
        self.assertEqual(first.read_bytes(), b"a")
        self.assertEqual(second.read_bytes(), b"b")
        unchanged = self.service.get_work(work.work_id)
        self.assertTrue(all(item.location_state is WorkLocationState.EXTERNAL for item in unchanged.media))

    def test_public_works_implementation_has_no_network_or_arbitrary_command_surface(self):
        source = (MODULE_ROOT / "src" / "creator_ops" / "application" / "works.py").read_text(encoding="utf-8")
        lowered = source.lower()
        for forbidden in ("requests.", "urllib", "http://", "https://", "socket.", "shell=true", "powershell"):
            self.assertNotIn(forbidden, lowered)
        self.assertNotIn("command_string", lowered)

    @unittest.skipUnless(sys.platform == "win32", "Windows shell handoff contract")
    def test_open_original_and_location_use_structured_windows_apis(self):
        image = self.media("open.jpg")
        media_id = self.service.intake_resources([
            {"kind": "file", "absolute_path": str(image)},
        ], now=NOW)[0].media[0].media_id
        process_calls = []
        self.service.process_runner = lambda args, **kwargs: process_calls.append((args, kwargs))
        with patch("creator_ops.application.works.os.startfile", create=True) as startfile:
            self.service.open_original(media_id)
            startfile.assert_called_once_with(image.resolve())
        self.service.open_location(media_id)
        self.assertEqual(process_calls, [
            (["explorer.exe", "/select,", str(image.resolve())], {"check": True, "timeout": 10})
        ])


if __name__ == "__main__":
    unittest.main()
