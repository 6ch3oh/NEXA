from __future__ import annotations

from collections.abc import Iterable

from src.contracts import SourceTag

from .models import ProvenanceSummary


def summarize_provenance(sources: Iterable[SourceTag]) -> ProvenanceSummary:
    """Deterministically retain distinct fact-level provenance."""

    unique = set(sources)
    ordered = tuple(
        sorted(
            unique,
            key=lambda item: (
                item.source_type.value,
                item.source_reference or "",
                item.captured_at.isoformat() if item.captured_at is not None else "",
            ),
        )
    )
    return ProvenanceSummary(underlying_sources=ordered)
