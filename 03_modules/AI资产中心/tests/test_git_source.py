from __future__ import annotations

import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.evidence.git_source import GitObjectSource

COMMIT = "7d4e3830ddf5e786d85499571e10086a9cc518f4"
BLOB_OID = "a" * 40


def completed(stdout: bytes) -> subprocess.CompletedProcess[bytes]:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr=b"")


class TestGitObjectSource(unittest.TestCase):
    def make_repo(self, tmp: str) -> Path:
        repo = Path(tmp) / "repo"
        (repo / ".git").mkdir(parents=True)
        return repo

    def verified_source(self, repo: Path, mocked_run) -> GitObjectSource:
        mocked_run.side_effect = [completed((COMMIT + "\n").encode()), completed(b"commit\n")]
        return GitObjectSource(repo, COMMIT)

    def test_rejects_empty_or_ambiguous_authority(self) -> None:
        with self.assertRaises(ValueError):
            GitObjectSource("", COMMIT)
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(tmp)
            with self.assertRaises(ValueError):
                GitObjectSource(repo, "")
            with self.assertRaises(ValueError):
                GitObjectSource(repo, "HEAD")

    @patch("src.evidence.git_source.subprocess.run")
    def test_locks_commit_and_reads_only_explicit_blob(self, mocked_run) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(tmp)
            content = b"export const provider = 'deepseek';\n"
            mocked_run.side_effect = [
                completed((COMMIT + "\n").encode()),
                completed(b"commit\n"),
                completed((BLOB_OID + "\n").encode()),
                completed(b"blob\n"),
                completed(content),
            ]
            blob = GitObjectSource(repo, COMMIT).read_blob("src/shared/limits.js")
            self.assertEqual(blob.commit, COMMIT)
            self.assertEqual(blob.relative_path, "src/shared/limits.js")
            self.assertEqual(blob.blob_oid, BLOB_OID)
            self.assertEqual(blob.content_sha256, hashlib.sha256(content).hexdigest())
            self.assertEqual(blob.content, content)
            for call in mocked_run.call_args_list:
                self.assertIs(call.kwargs["shell"], False)

    @patch("src.evidence.git_source.subprocess.run")
    def test_rejects_traversal_and_revision_injection(self, mocked_run) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = self.verified_source(self.make_repo(tmp), mocked_run)
            initial_calls = mocked_run.call_count
            for path in ("../outside.js", "src/:evil.js", "src/*.js", "-n"):
                with self.subTest(path=path):
                    with self.assertRaises(ValueError):
                        source.read_blob(path)
            self.assertEqual(mocked_run.call_count, initial_calls)

    @patch("src.evidence.git_source.subprocess.run")
    def test_rejects_commit_identity_mismatch(self, mocked_run) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(tmp)
            mocked_run.return_value = completed(("0" * 40 + "\n").encode())
            with self.assertRaises(ValueError):
                GitObjectSource(repo, COMMIT)
