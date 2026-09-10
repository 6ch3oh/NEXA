from __future__ import annotations

from datetime import datetime, timezone


EFFECTIVE_AT = datetime(2026, 8, 1, tzinfo=timezone.utc)
OBSERVED_AT = datetime(2026, 8, 2, tzinfo=timezone.utc)
PROVIDER_ID = "provider-offline-synthetic"
MODEL_ID = "model-offline-synthetic"


def offline_row(**overrides):
    values = {
        "provider_id": PROVIDER_ID,
        "model_id": MODEL_ID,
        "currency": "USD",
        "effective_at": EFFECTIVE_AT,
        "source_id": "models-dev",
        "input_per_m": "0.40",
        "output_per_m": "0.80",
        "cache_read_per_m": "0.04",
    }
    values.update(overrides)
    return values
