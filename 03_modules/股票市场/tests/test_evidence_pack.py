from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest

MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from nexa_market.domain import Freshness, ProvenanceKind
from nexa_market.evidence import EvidenceRecord, EvidenceStatus, MarketEvidencePackBuilder, PackAvailability
from nexa_market.fixtures import FUNDAMENTAL_SUMMARY, MARKET_EVENT, NOW, US_QUOTE, US_SHARE, provenance
from nexa_market.research import EvidenceKind
from nexa_market.viewmodels import to_json_compatible


def record(evidence_id: str, source: str, value: str, *, freshness=Freshness.END_OF_DAY, status=EvidenceStatus.ACCEPTED):
    prov = provenance(source, ProvenanceKind.FUNDAMENTAL, freshness=freshness)
    return EvidenceRecord(evidence_id, US_SHARE.instrument_id, "revenue.fy2025", EvidenceKind.FUNDAMENTAL, value, "USD", NOW, NOW, source, prov, freshness, status, "bad shape" if status is EvidenceStatus.REJECTED else None)


class EvidencePackTests(unittest.TestCase):
    def test_pack_is_versioned_deterministic_json_safe_and_explicitly_partial(self):
        value = record("evidence.a", "fixture.a", "100")
        builder = MarketEvidencePackBuilder()
        first = builder.build(pack_id="pack.1", instrument_id=US_SHARE.instrument_id, as_of=NOW, generated_at=NOW, quotes=(US_QUOTE,), fundamentals=(FUNDAMENTAL_SUMMARY,), events=(MARKET_EVENT,), evidence=(value,))
        second = builder.build(pack_id="pack.1", instrument_id=US_SHARE.instrument_id, as_of=NOW, generated_at=NOW, quotes=(US_QUOTE,), fundamentals=(FUNDAMENTAL_SUMMARY,), events=(MARKET_EVENT,), evidence=(value,))
        self.assertEqual(first, second)
        self.assertEqual(PackAvailability.AVAILABLE, first.data_quality.completeness)
        json.dumps(to_json_compatible(first), ensure_ascii=False, sort_keys=True)

    def test_same_fact_different_sources_coexist_and_conflict_is_preserved(self):
        pack = MarketEvidencePackBuilder().build(pack_id="pack.2", instrument_id=US_SHARE.instrument_id, as_of=NOW, generated_at=NOW, evidence=(record("evidence.a", "fixture.a", "100"), record("evidence.b", "fixture.b", "120")))
        self.assertEqual(2, len(pack.evidence))
        self.assertEqual("EVIDENCE_CONFLICT", pack.data_quality.conflicts[0].status)
        self.assertEqual(("evidence.a", "evidence.b"), pack.data_quality.conflicts[0].evidence_refs)

    def test_equal_fact_values_are_not_deduplicated_or_marked_conflicting(self):
        pack = MarketEvidencePackBuilder().build(pack_id="pack.3", instrument_id=US_SHARE.instrument_id, as_of=NOW, generated_at=NOW, evidence=(record("evidence.a", "fixture.a", "100"), record("evidence.b", "fixture.b", "100")))
        self.assertEqual(2, len(pack.evidence))
        self.assertEqual((), pack.data_quality.conflicts)

    def test_stale_rejected_and_missing_are_distinct(self):
        stale = record("evidence.stale", "fixture.a", "100", freshness=Freshness.STALE)
        rejected = record("evidence.rejected", "fixture.b", "120", status=EvidenceStatus.REJECTED)
        pack = MarketEvidencePackBuilder().build(pack_id="pack.4", instrument_id=US_SHARE.instrument_id, as_of=NOW, generated_at=NOW, evidence=(stale, rejected))
        self.assertIn("evidence.stale", pack.data_quality.stale_evidence_refs)
        self.assertIn("evidence.rejected", pack.data_quality.rejected_evidence_refs)
        self.assertIn("quote", pack.data_quality.missing_components)
        self.assertIsNone(pack.latest_quote)

    def test_duplicate_evidence_identity_fails_instead_of_silent_merge(self):
        item = record("evidence.same", "fixture.a", "100")
        with self.assertRaisesRegex(ValueError, "duplicate evidence"):
            MarketEvidencePackBuilder().build(pack_id="pack.5", instrument_id=US_SHARE.instrument_id, as_of=NOW, generated_at=NOW, evidence=(item, replace(item, normalized_value="120")))


if __name__ == "__main__":
    unittest.main()
