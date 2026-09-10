"""Stable persistence errors that do not expose SQL or filesystem details."""

from __future__ import annotations

from enum import Enum


class PersistenceErrorCode(str, Enum):
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    STORAGE_ERROR = "STORAGE_ERROR"
    SCHEMA_VERSION_UNSUPPORTED = "SCHEMA_VERSION_UNSUPPORTED"
    TRANSACTION_FAILED = "TRANSACTION_FAILED"


class PersistenceError(RuntimeError):
    def __init__(self, code: PersistenceErrorCode, message: str, *, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.cause = cause

