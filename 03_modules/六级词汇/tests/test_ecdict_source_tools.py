from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
EXTRACTOR = MODULE_ROOT / "scripts" / "extract-ecdict-pilot.py"
VERIFIER = MODULE_ROOT / "scripts" / "verify-ecdict-source-recovery.py"
COLUMNS = (
    "word", "phonetic", "definition", "translation", "pos", "collins", "oxford",
    "tag", "bnc", "frq", "exchange", "detail", "audio",
)


def alpha_suffix(index: int) -> str:
    value = index
    result = ""
    while True:
        result = chr(97 + value % 26) + result
        value = value // 26 - 1
        if value < 0:
            return result


def row(word: str | None, **overrides: object) -> tuple:
    values = {
        "word": word,
        "phonetic": "test",
        "definition": "synthetic English definition",
        "translation": "合成测试释义",
        "pos": "n:1",
        "collins": None,
        "oxford": None,
        "tag": "cet6",
        "bnc": None,
        "frq": None,
        "exchange": None,
        "detail": None,
        "audio": None,
    }
    values.update(overrides)
    return tuple(values[column] for column in COLUMNS)


class EcdictSourceToolsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="nexa-ecdict-source-test-")
        self.root = Path(self.temporary.name)
        self.database = self.root / "stardict.db"
        connection = sqlite3.connect(self.database)
        connection.execute(
            "CREATE TABLE stardict (id INTEGER PRIMARY KEY, word TEXT, phonetic TEXT, "
            "definition TEXT, translation TEXT, pos TEXT, collins TEXT, oxford TEXT, "
            "tag TEXT, bnc TEXT, frq TEXT, exchange TEXT, detail TEXT, audio TEXT)"
        )
        valid_rows = [row(f"synthetic{alpha_suffix(index)}") for index in range(50)]
        audit_rows = [
            row("synthetica"),
            row("SYNTHETICB"),
            row(None),
            row("bad!"),
            row("missingtranslation", translation=None),
            row("missingfields", phonetic=None, pos=None),
        ]
        placeholders = ",".join("?" for _ in COLUMNS)
        connection.executemany(
            f"INSERT INTO stardict ({','.join(COLUMNS)}) VALUES ({placeholders})",
            valid_rows + audit_rows,
        )
        connection.commit()
        connection.close()
        self.archive = self.root / "ecdict-sqlite-28.zip"
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as source_zip:
            source_zip.write(self.database, arcname="stardict.db")
        self.archive_sha256 = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.manifest = self.root / "source-manifest.json"
        self.manifest.write_text(json.dumps({
            "sourceId": "ecdict",
            "sourceName": "ECDICT",
            "classification": "THIRD_PARTY",
            "official": False,
            "repositoryRevision": "1.0.28",
            "repositoryCommit": "8defb76",
            "redistributionStatus": "REDISTRIBUTION_NOT_ESTABLISHED",
            "sourceArchiveName": self.archive.name,
            "sourceArchiveBytes": self.archive.stat().st_size,
            "sourceDatabaseName": self.database.name,
            "sourceDatabaseBytes": self.database.stat().st_size,
            "sourceSha256": self.archive_sha256,
            "upstreamAssetUrl": "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip",
            "cet6CandidateCount": 56,
        }), encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_script(self, script: Path, *arguments: str, expect_success: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(script), *arguments],
            cwd=MODULE_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            check=False,
        )
        if expect_success and result.returncode != 0:
            self.fail(f"{script.name} failed: {result.stderr}\n{result.stdout}")
        return result

    def test_source_verifier_matches_hash_integrity_and_independent_count(self) -> None:
        output = self.root / "recovery.json"
        self.run_script(
            VERIFIER,
            "--module-root", str(self.root),
            "--archive", str(self.archive),
            "--database", str(self.database),
            "--historical-manifest", str(self.manifest),
            "--output", str(output),
            "--recovered-at", "2026-08-21T00:00:00.000Z",
        )
        report = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(report["artifactIdentity"], "MATCH")
        self.assertEqual(report["archiveIntegrity"], "ZIP_CRC_OK")
        self.assertEqual(report["sqliteIntegrity"], "ok")
        self.assertEqual(report["recomputedCet6CandidateCount"], 56)
        self.assertTrue(report["countMatch"])
        self.assertEqual(report["sourceReadMode"], "SQLITE_URI_MODE_RO")

    def test_source_verifier_fails_closed_on_hash_mismatch(self) -> None:
        altered = json.loads(self.manifest.read_text(encoding="utf-8"))
        altered["sourceSha256"] = "0" * 64
        self.manifest.write_text(json.dumps(altered), encoding="utf-8")
        result = self.run_script(
            VERIFIER,
            "--module-root", str(self.root),
            "--archive", str(self.archive),
            "--database", str(self.database),
            "--historical-manifest", str(self.manifest),
            "--output", str(self.root / "must-not-exist.json"),
            "--recovered-at", "2026-08-21T00:00:00.000Z",
            expect_success=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ARTIFACT_IDENTITY_MISMATCH", result.stderr)
        self.assertFalse((self.root / "must-not-exist.json").exists())

    def test_default_pilot_mode_remains_50_to_100_and_source_only(self) -> None:
        output = self.root / "pilot.json"
        self.run_script(
            EXTRACTOR,
            "--database", str(self.database),
            "--archive", str(self.archive),
            "--output", str(output),
            "--count", "50",
            "--retrieved-at", "2026-08-21T00:00:00.000Z",
        )
        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(payload["mode"], "PILOT")
        self.assertEqual(len(payload["rows"]), 50)
        self.assertFalse(payload["pipelineBoundary"]["directStoreWrite"])
        self.assertFalse(payload["selection"]["explicitFullMode"])

    def test_explicit_audit_expansion_reads_all_and_quantifies_raw_findings(self) -> None:
        output = self.root / "audit.raw.json"
        report_path = self.root / "audit-report.json"
        self.run_script(
            EXTRACTOR,
            "--database", str(self.database),
            "--archive", str(self.archive),
            "--output", str(output),
            "--mode", "audit-expansion",
            "--audit-report", str(report_path),
            "--retrieved-at", "2026-08-21T00:00:00.000Z",
        )
        payload = json.loads(output.read_text(encoding="utf-8"))
        audit = payload["rawAudit"]
        self.assertEqual(payload["mode"], "AUDIT_EXPANSION")
        self.assertEqual(len(payload["rows"]), 56)
        self.assertEqual(audit["counts"]["MISSING_WORD"], 1)
        self.assertEqual(audit["counts"]["INVALID_WORD"], 1)
        self.assertEqual(audit["counts"]["MISSING_DEFINITION"], 1)
        self.assertEqual(audit["counts"]["MISSING_PHONETIC"], 1)
        self.assertEqual(audit["counts"]["MISSING_POS"], 1)
        self.assertGreaterEqual(audit["counts"]["EXACT_DUPLICATE"], 1)
        self.assertGreaterEqual(audit["counts"]["NORMALIZED_DUPLICATE"], 2)
        self.assertEqual(audit["counts"]["STRUCTURAL_INVALID"], 3)
        self.assertEqual(audit["counts"]["REJECTION_REASON"], 3)
        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertFalse(report["directStoreWrite"])
        self.assertEqual(report["runtimeNetworkDependency"], 0)


if __name__ == "__main__":
    unittest.main()
