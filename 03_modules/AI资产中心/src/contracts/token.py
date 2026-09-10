from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from .source_tag import SourceTag

FINGERPRINT_PREFIX = "fp:"
MASK_CHAR = "*"

_LOOKS_LIKE_SECRET = re.compile(
    r"(?i)\b("
    r"sk-[a-z0-9]{16,}|"
    r"xox[baprs]-[a-z0-9-]{10,}|"
    r"gh[pousr]_[a-z0-9]{20,}|"
    r"AIza[a-z0-9_-]{20,}|"
    r"AKIA[0-9A-Z]{16}|"
    r"eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}"
    r")\b"
)

_MASK_RE = re.compile(re.escape(MASK_CHAR))


class TokenStatus(str, Enum):
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"
    SUSPENDED = "suspended"


@dataclass(frozen=True)
class Token:
    id: str
    provider_id: str
    label: str
    status: TokenStatus
    masked_identifier: str
    source: SourceTag
    secret_ref: str | None = None

    def __post_init__(self) -> None:
        if not _non_empty(self.id):
            raise ValueError("Token id must not be empty")
        if not _non_empty(self.provider_id):
            raise ValueError("Token provider_id must not be empty")
        if not _non_empty(self.label):
            raise ValueError("Token label must not be empty")
        if not isinstance(self.status, TokenStatus):
            raise ValueError("Token status must be a TokenStatus")
        if not isinstance(self.source, SourceTag):
            raise ValueError("Token source must be a SourceTag")
        if not _non_empty(self.masked_identifier):
            raise ValueError("Token masked_identifier must not be empty")
        if _is_plaintext_secret(self.masked_identifier):
            raise ValueError("masked_identifier must be masked or a fingerprint, not a plaintext secret")
        if not (_MASK_RE.search(self.masked_identifier) or self.masked_identifier.startswith(FINGERPRINT_PREFIX)):
            raise ValueError("masked_identifier must contain a masking char or a fingerprint prefix")
        if self.secret_ref is not None and _is_plaintext_secret(self.secret_ref):
            raise ValueError("secret_ref must be a reference (e.g. vault path), not a plaintext secret")


def _non_empty(value: str) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_plaintext_secret(value: str) -> bool:
    return bool(_LOOKS_LIKE_SECRET.search(value))
