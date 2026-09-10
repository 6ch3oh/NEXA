from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from pathlib import Path
import json
import sys
import tempfile
import unittest

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.evidence import InMemoryEvidenceRepository, LocalEvidenceRepository
from nexa_market.repositories import RecordWriteResult, RepositoryError, RepositoryLoadStatus
from nexa_market.research import EvidenceKind
from tests.test_evidence_pack import record
from nexa_market.fixtures import NOW


class EvidenceRepositoryContractMixin:
    def make_repo(self): raise NotImplementedError
    def test_query_and_identity_contract(self):
        repo = self.make_repo(); a = record("evidence.a", "fixture.a", "100"); b = replace(record("evidence.b", "fixture.b", "120"), fact_key="profit.fy2025")
        self.assertEqual(RecordWriteResult.CREATED, repo.append(a)); self.assertEqual(RecordWriteResult.UNCHANGED, repo.save(a)); self.assertEqual(RecordWriteResult.IDENTITY_CONFLICT, repo.append(replace(a, normalized_value="999")))
        self.assertEqual(RecordWriteResult.CREATED, repo.append(b)); self.assertEqual(a, repo.get(a.evidence_id)); self.assertEqual((a, b), repo.list_by_instrument(a.instrument_id)); self.assertEqual((a, b), repo.list_by_type(EvidenceKind.FUNDAMENTAL)); self.assertEqual((a, b), repo.list_by_time(NOW - timedelta(seconds=1), NOW + timedelta(seconds=1)))


class MemoryEvidenceRepositoryTests(EvidenceRepositoryContractMixin, unittest.TestCase):
    def make_repo(self): return InMemoryEvidenceRepository()


class LocalEvidenceRepositoryTests(EvidenceRepositoryContractMixin, unittest.TestCase):
    def setUp(self): self.temp = tempfile.TemporaryDirectory(); self.path = Path(self.temp.name).resolve() / "证据.json"
    def tearDown(self): self.temp.cleanup()
    def make_repo(self): return LocalEvidenceRepository(self.path)
    def test_restart_unicode_and_partial_recovery(self):
        repo = self.make_repo(); item = replace(record("evidence.unicode", "fixture.中文", "增长"), fact_key="revenue.growth")
        self.assertEqual(RecordWriteResult.CREATED, repo.append(item)); self.assertEqual(item, self.make_repo().get(item.evidence_id)); self.assertIn("中文", self.path.read_text(encoding="utf-8"))
        payload = json.loads(self.path.read_text(encoding="utf-8")); payload["records"].append({"evidence_id": "broken"}); self.path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        loaded = self.make_repo().load_result(); self.assertEqual(RepositoryLoadStatus.PARTIALLY_INVALID, loaded.status); self.assertEqual((item,), loaded.records)
        with self.assertRaises(RepositoryError): self.make_repo().append(record("evidence.new", "fixture.a", "1"))


if __name__ == "__main__": unittest.main()
