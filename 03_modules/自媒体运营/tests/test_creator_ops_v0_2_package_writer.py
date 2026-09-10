from __future__ import annotations

import tempfile
import unittest
import json
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from creator_ops.application.package_writer import (
    LocalPackageWriter, PackageBuildRequest, PackageFileInput, PackageWriteStatus,
)


class PackageWriterV02Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "packages"
        self.writer = LocalPackageWriter(self.root)
        self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def request(self, *, body: bytes = b"Synthetic body") -> PackageBuildRequest:
        return PackageBuildRequest(
            "pkg-001", "content-001", "B3",
            (
                PackageFileInput("content_metadata", "metadata/content.json", b'{"synthetic":true}\n', True, "application/json"),
                PackageFileInput("script", "02_script/script.md", body, True, "text/markdown"),
                PackageFileInput("publish_plan", "07_publish/publish_plan.md", b"Manual only\n", True, "text/markdown"),
            ),
            ("asset://reference-only",), {"source": "synthetic", "reference": "test"}, self.now,
        )

    def test_staging_validate_atomic_finalize_and_manifest_hashes(self) -> None:
        result = self.writer.write(self.request())
        self.assertIs(result.status, PackageWriteStatus.CREATED)
        self.assertTrue(result.manifest_path.is_file())
        self.assertFalse((self.root / ".staging" / "pkg-001.staging").exists())
        text = result.manifest_path.read_text(encoding="utf-8")
        self.assertIn('"sha256"', text)
        self.assertIn('"asset://reference-only"', text)

    def test_identical_build_is_idempotent_but_changed_build_conflicts(self) -> None:
        first = self.writer.write(self.request())
        second = self.writer.write(replace(
            self.request(), generated_at=datetime(2026, 8, 14, tzinfo=timezone.utc),
        ))
        changed = self.writer.write(self.request(body=b"Changed body"))
        self.assertIs(first.status, PackageWriteStatus.CREATED)
        self.assertIs(second.status, PackageWriteStatus.IDEMPOTENT)
        self.assertEqual(first.package_digest, second.package_digest)
        self.assertIs(changed.status, PackageWriteStatus.CONFLICT)
        self.assertEqual((first.target_path / "02_script/script.md").read_bytes(), b"Synthetic body")
        manifest = json.loads(first.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["package_state"], "FINALIZED")

    def test_write_failure_removes_only_current_staging_and_never_finalizes(self) -> None:
        original = LocalPackageWriter._create_file
        calls = 0
        def fail_second(path: Path, content: bytes) -> None:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("synthetic write failure")
            original(path, content)
        with patch.object(LocalPackageWriter, "_create_file", side_effect=fail_second):
            result = self.writer.write(self.request())
        self.assertIs(result.status, PackageWriteStatus.FAILED)
        self.assertFalse(result.target_path.exists())
        self.assertFalse((self.root / ".staging" / "pkg-001.staging").exists())

    def test_existing_staging_requires_recovery_and_explicit_rollback(self) -> None:
        staging = self.root / ".staging" / "pkg-001.staging"
        staging.mkdir(parents=True)
        (staging / "evidence.txt").write_text("partial", encoding="utf-8")
        result = self.writer.write(self.request())
        self.assertIs(result.status, PackageWriteStatus.FAILED)
        self.assertTrue(staging.exists())
        self.assertTrue(self.writer.rollback_staging("pkg-001"))
        self.assertFalse(staging.exists())

    def test_unsafe_paths_duplicate_paths_and_manifest_collision_rejected(self) -> None:
        bad = PackageBuildRequest(
            "pkg-001", "content-001", "B3",
            (PackageFileInput("bad", "../escape.txt", b"bad"),), (), {"source": "test"}, self.now,
        )
        with self.assertRaises(ValueError):
            self.writer.write(bad)
        collision = PackageBuildRequest(
            "pkg-001", "content-001", "B3",
            (PackageFileInput("manifest", LocalPackageWriter.MANIFEST, b"bad"),),
            (), {"source": "test"}, self.now,
        )
        with self.assertRaises(ValueError):
            self.writer.write(collision)

    def test_source_import_cannot_be_target_root(self) -> None:
        source_import = Path(__file__).resolve().parents[1] / "source_import"
        with self.assertRaises(ValueError):
            LocalPackageWriter(source_import)


if __name__ == "__main__":
    unittest.main()
