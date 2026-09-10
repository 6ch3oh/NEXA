"""Provider adapters owned by NEXA Automation Center."""

from .n8n_export import (
    MappingDiagnostic,
    MappingDiagnosticCode,
    N8nExportAdapter,
    N8nExportContext,
    N8nExportMappingError,
    N8nExportMappingResult,
)
from .result_intake import (
    LegacyExecutionResultAdapter,
    ResultIntakeContext,
    ResultIntakeError,
)
from .request_ledger import (
    IdempotencyConflictError,
    InvocationWriteResult,
    RequestLedgerError,
    RequestNotFoundError,
    SQLiteRequestLedger,
)
from .owner_read import SQLiteOwnerReadRepository

__all__ = [
    "MappingDiagnostic",
    "MappingDiagnosticCode",
    "N8nExportAdapter",
    "N8nExportContext",
    "N8nExportMappingError",
    "N8nExportMappingResult",
    "LegacyExecutionResultAdapter",
    "ResultIntakeContext",
    "ResultIntakeError",
    "IdempotencyConflictError",
    "InvocationWriteResult",
    "RequestLedgerError",
    "RequestNotFoundError",
    "SQLiteRequestLedger",
    "SQLiteOwnerReadRepository",
]
