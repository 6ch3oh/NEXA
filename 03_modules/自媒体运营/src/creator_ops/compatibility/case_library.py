"""Read-only compatibility contracts for the mature legacy Case Library."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class LegacyCase:
    case_id: str
    title: str
    platform: str
    original_url: str | None
    target_accounts: tuple[str, ...]
    local_folder: str | None
    local_video: str | None
    cover: str | None
    material_references: tuple[tuple[str, str], ...]
    statuses: tuple[tuple[str, str], ...]
    evidence_manifest_reference: str | None
    provenance_reference: str
    extension_fields: Mapping[str, Any] = field(default_factory=dict)
    version: str = "0.1"


class LegacyCaseLibraryMapper:
    @staticmethod
    def map_case(
        data: Mapping[str, Any], *, source_reference: str,
        evidence_manifest_reference: str | None = None,
    ) -> LegacyCase:
        case_id = str(data.get("case_id") or "").strip()
        title = str(data.get("title") or "").strip()
        platform = str(data.get("platform") or "").strip()
        if not case_id or not title or not platform:
            raise ValueError("legacy case requires case_id, title, and platform")
        raw_accounts = data.get("target_accounts") or data.get("primary_codes") or ()
        if isinstance(raw_accounts, str):
            accounts = tuple(part.strip() for part in raw_accounts.replace("，", ",").split(",") if part.strip())
        else:
            accounts = tuple(str(item) for item in raw_accounts)
        materials = data.get("materials") or {}
        statuses = tuple(sorted(
            (str(key), str(value)) for key, value in data.items()
            if key.endswith("_status") and value not in (None, "")
        ))
        consumed = {
            "case_id", "title", "platform", "original_link", "original_url", "target_accounts",
            "primary_codes", "case_folder", "local_folder", "local_video", "cover", "materials",
        } | {key for key in data if key.endswith("_status")}
        return LegacyCase(
            case_id=case_id, title=title, platform=platform,
            original_url=_optional(data.get("original_url") or data.get("original_link")),
            target_accounts=accounts,
            local_folder=_optional(data.get("local_folder") or data.get("case_folder")),
            local_video=_optional(data.get("local_video")), cover=_optional(data.get("cover")),
            material_references=tuple(sorted((str(key), str(value)) for key, value in materials.items()))
            if isinstance(materials, Mapping) else (),
            statuses=statuses, evidence_manifest_reference=evidence_manifest_reference,
            provenance_reference=source_reference,
            extension_fields={key: value for key, value in data.items() if key not in consumed},
        )


def _optional(value: Any) -> str | None:
    return str(value) if value not in (None, "") else None
