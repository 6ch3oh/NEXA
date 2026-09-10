import json
import unittest
from datetime import datetime
from pathlib import Path

from src.contracts import (
    PriceDimension,
    SourceTag,
    SourceType,
    UsageAttribution,
    UsageRecord,
)
from src.domain.cost_calculator import ComputationStatus, calculate_derived_cost
from src.domain.security import contains_plaintext_secret
from src.query import LookupStatus, QueryService


EVIDENCE_PATH = (
    Path(__file__).resolve().parents[1]
    / ".nexa"
    / "evidence"
    / "real-deepseek-pilot"
    / "NEXA-AI-ASSET-DEEPSEEK-MINIMAL-REAL-PILOT-002.json"
)


def load_evidence():
    return json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))


def canonical_usage(evidence):
    raw = evidence["provider_usage"]
    projection = evidence["canonical_usage_projection"]
    residual = (
        raw["total_tokens"]
        - raw["prompt_cache_miss_tokens"]
        - raw["prompt_cache_hit_tokens"]
        - raw["completion_tokens"]
    )
    if residual != 0:
        raise ValueError("real Provider usage has an unallocated token residual")
    observed_at = datetime.fromisoformat(evidence["completed_at"].replace("Z", "+00:00"))
    return UsageRecord(
        usage_id=projection["usage_id"],
        provider_id=projection["provider_id"],
        input_tokens=raw["prompt_cache_miss_tokens"],
        output_tokens=raw["completion_tokens"],
        cache_read_tokens=raw["prompt_cache_hit_tokens"],
        cache_write_tokens=residual,
        total_tokens=raw["total_tokens"],
        observed_at=observed_at,
        source=SourceTag(
            SourceType.REMOTE_PROVIDER_API,
            projection["source_reference"],
            observed_at,
        ),
        model=projection["model"],
        attribution=UsageAttribution.attributed(
            project_id=projection["project_id"],
            module_id=projection["module_id"],
            task_id=projection["task_id"],
            run_id=projection["run_id"],
        ),
    )


class DeepSeekRealPilot002EvidenceCase(unittest.TestCase):
    def test_gate_result_is_real_sanitized_and_one_shot(self):
        evidence = load_evidence()
        self.assertEqual(evidence["status"], "PASS_WITH_PRICING_GAP")
        self.assertEqual(evidence["real_provider_calls"], 1)
        self.assertEqual(evidence["provider"], "deepseek")
        self.assertEqual(evidence["requested_model"], "deepseek-v4-flash")
        self.assertEqual(evidence["provider_returned_model"], "deepseek-v4-flash")
        self.assertEqual(evidence["sanitized_final_content"], "NEXA_DEEPSEEK_REAL_PILOT_OK")
        self.assertEqual(evidence["real_usage_evidence"], "CAPTURED")
        self.assertFalse(evidence["retry_attempted_after_provider_call"])

    def test_real_usage_enters_existing_canonical_attribution(self):
        evidence = load_evidence()
        usage = canonical_usage(evidence)
        selected = QueryService(usages=(usage,)).list_usage(
            provider_id="deepseek", model="deepseek-v4-flash"
        )
        self.assertEqual(selected, (usage,))
        self.assertEqual(usage.total_tokens, 152)
        self.assertEqual(usage.attribution.project_id, "03_AI_ASSET_CENTER")
        self.assertEqual(usage.attribution.module_id, "AI资产中心")
        self.assertEqual(
            usage.attribution.task_id,
            "NEXA-AI-ASSET-DEEPSEEK-MINIMAL-REAL-PILOT-002",
        )

    def test_exact_model_has_no_pricing_and_cost_fails_closed(self):
        evidence = load_evidence()
        usage = canonical_usage(evidence)
        query = QueryService(usages=(usage,))
        for dimension in (PriceDimension.INPUT, PriceDimension.OUTPUT):
            result = query.resolve_pricing(
                "deepseek", "deepseek-v4-flash", dimension, usage.observed_at
            )
            self.assertIs(result.status, LookupStatus.MISSING)
        cost = calculate_derived_cost(usage, ())
        self.assertIs(cost.status, ComputationStatus.INCOMPLETE)
        self.assertIsNone(cost.amount)
        self.assertIsNone(cost.currency)
        self.assertEqual(cost.missing_pricing_dimensions, ("input", "output"))
        self.assertEqual(
            list(cost.missing_pricing_dimensions),
            evidence["authority_verification"]["missing_pricing_dimensions"],
        )

    def test_evidence_contains_no_secret_or_forbidden_raw_material(self):
        evidence = load_evidence()
        boundary = evidence["credential_boundary"]
        self.assertEqual(boundary["03_secret_reads"], 0)
        for field in (
            "secret_in_prompt",
            "secret_in_result",
            "secret_in_evidence",
            "secret_in_log",
            "secret_in_error",
        ):
            self.assertFalse(boundary[field])
        serialized = json.dumps(evidence, ensure_ascii=False)
        self.assertFalse(contains_plaintext_secret(serialized))
        for forbidden_key in (
            "reasoning_content",
            "raw_headers",
            "raw_response_body",
            "raw_exception",
            "credential_reference",
        ):
            self.assertNotIn(f'"{forbidden_key}"', serialized)


if __name__ == "__main__":
    unittest.main()
