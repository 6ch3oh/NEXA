from __future__ import annotations

import re

MASK_CHAR = "*"


def mask_secret(raw: str, visible: int = 4) -> str:
    """Return a masked identifier for display/storage.

    The raw value is only ever transient in memory; callers must not persist
    it. Use a Fingerprint/secret_ref for real secret handling.
    """
    if not isinstance(raw, str) or not raw:
        raise ValueError("cannot mask an empty value")
    if visible < 0:
        raise ValueError("visible must be >= 0")
    visible = min(visible, len(raw))
    return f"{MASK_CHAR * 4}{raw[-visible:]}"


def fingerprint(value: str, prefix: str = "fp:") -> str:
    """Return a stable, non-reversible fingerprint marker (requires hashing at
    the store layer). Never returns the raw value itself."""
    if not isinstance(value, str) or not value:
        raise ValueError("cannot fingerprint an empty value")
    return f"{prefix}{len(value)}:{value[:2]}..."


def contains_plaintext_secret(value: str) -> bool:
    return bool(_SECRET_PATTERN.search(value))


_SECRET_PATTERN = re.compile(
    r"(?i)\b("
    r"sk-[a-z0-9]{16,}|"
    r"xox[baprs]-[a-z0-9-]{10,}|"
    r"gh[pousr]_[a-z0-9]{20,}|"
    r"AIza[a-z0-9_-]{20,}|"
    r"AKIA[0-9A-Z]{16}|"
    r"eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}"
    r")\b"
)
