class StoreError(RuntimeError):
    """Base error for the canonical persistence boundary."""


class StoreConflictError(StoreError):
    """A stable identity already exists with different canonical content."""


class StoreDataError(StoreError):
    """Persisted data cannot be reconstructed as a canonical domain object."""


class UnsupportedSchemaVersion(StoreError):
    """The database schema version is unknown to this adapter."""
