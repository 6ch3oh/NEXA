from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable, TypeVar

from src.contracts import (
    BalanceSnapshot,
    CostRecord,
    EntitlementSnapshot,
    PricingSnapshot,
    PricingAuthorityRecord,
    Provider,
    SourceTag,
    Token,
    UsageRecord,
)
from src.domain.security import contains_plaintext_secret
from src.store import SQLiteCanonicalStore, StoreConflictError, WriteResult

from .intake_models import (
    AuthorityUpdateReceipt,
    BatchConflictError,
    BatchIntakeResult,
    IntakeReasonCode,
    IntakeResult,
    IntakeStatus,
    IntakeStoreConflictError,
    InvalidCanonicalRecordError,
    ReferenceMismatchError,
    ReferenceMissingError,
    SecretRejectedError,
)


CanonicalRecord = Provider | Token | BalanceSnapshot | UsageRecord | PricingSnapshot | CostRecord | PricingAuthorityRecord | EntitlementSnapshot
T = TypeVar("T", Provider, Token, BalanceSnapshot, UsageRecord, PricingSnapshot, CostRecord, PricingAuthorityRecord, EntitlementSnapshot)


class CanonicalIntakeService:
    """Local application write boundary for constructed canonical records.

    Adapters and sanitizers run before this service. It performs relationship
    and Secret gates, delegates persistence/idempotency to SQLiteCanonicalStore,
    and never interprets raw payloads or rewrites record provenance.
    """

    def __init__(self, database_path: str | Path):
        if not isinstance(database_path, (str, Path)) or not str(database_path):
            raise ValueError("database_path must be explicitly provided")
        path = Path(database_path)
        if path.exists() and not path.is_file():
            raise IsADirectoryError("intake database path must be a file")
        self.database_path = path

    def ingest_provider(self, provider: Provider) -> IntakeResult:
        record = _require_record(provider, Provider)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            result = _stable_write(lambda: store.put_provider(record), "provider")
        return _result(result, "provider", record.id)

    def ingest_token(self, token: Token) -> IntakeResult:
        record = _require_record(token, Token)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _require_provider(store, record.provider_id)
            result = _stable_write(lambda: store.put_token(record), "token")
        return _result(result, "token", record.id)

    def ingest_balance(self, balance: BalanceSnapshot) -> IntakeResult:
        record = _require_record(balance, BalanceSnapshot)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _validate_references(store, record.provider_id, record.token_id)
            result = store.append_balance(record)
        identity = _event_identity(
            record.provider_id, record.token_id, record.observed_at.isoformat()
        )
        return _result(result, "balance", identity)

    def ingest_usage(self, usage: UsageRecord) -> IntakeResult:
        record = _require_record(usage, UsageRecord)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _validate_references(store, record.provider_id, record.token_id)
            result = store.append_usage(record)
        return _result(result, "usage", record.usage_id)

    def ingest_pricing(self, pricing: PricingSnapshot) -> IntakeResult:
        record = _require_record(pricing, PricingSnapshot)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _validate_references(store, record.provider_id, record.token_id)
            result = store.append_pricing(record)
        identity = _event_identity(
            record.provider_id,
            record.token_id,
            record.model,
            record.price_dimension.value,
            record.effective_at.isoformat(),
        )
        return _result(result, "pricing", identity)

    def ingest_cost(self, cost: CostRecord) -> IntakeResult:
        record = _require_record(cost, CostRecord)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _validate_references(store, record.provider_id, record.token_id)
            result = store.append_cost(record)
        identity = _event_identity(
            record.provider_id,
            record.token_id,
            record.model,
            record.kind.value,
            record.occurred_at.isoformat(),
        )
        return _result(result, "cost", identity)

    def ingest_pricing_authority(self, authority: PricingAuthorityRecord) -> IntakeResult:
        record = _require_record(authority, PricingAuthorityRecord)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _require_provider(store, record.provider_id)
            persisted = set(store.load_pricing())
            if any(component not in persisted for component in record.components):
                raise ReferenceMissingError("pricing authority component is not persisted")
            result = store.append_pricing_authority(record)
        return _result(result, "pricing_authority", record.authority_id)

    def ingest_entitlement(self, entitlement: EntitlementSnapshot) -> IntakeResult:
        record = _require_record(entitlement, EntitlementSnapshot)
        _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _validate_references(store, record.provider_id, record.token_id)
            result = store.append_entitlement(record)
        return _result(result, "entitlement", record.entitlement_id)

    def ingest_batch(self, records: Iterable[CanonicalRecord]) -> BatchIntakeResult:
        """Preflight and commit a canonical batch as one SQLite transaction."""
        supplied = _require_batch(records)
        ordered = _batch_order(supplied)
        for record in ordered:
            _secret_gate(record)
        with SQLiteCanonicalStore(self.database_path) as store:
            _preflight_batch(store, ordered)
            results: list[IntakeResult] = []
            with store.transaction():
                for record in ordered:
                    results.append(_write_record(store, record))
        return BatchIntakeResult(tuple(results), transaction_committed=True)

    def ingest_pricing_authority_with_receipt(
        self, authority: PricingAuthorityRecord, *, accepted_at
    ) -> AuthorityUpdateReceipt:
        record = _require_record(authority, PricingAuthorityRecord)
        _require_accepted_at(accepted_at)
        result = self.ingest_pricing_authority(record)
        return _authority_receipt(record, result, accepted_at)

    def ingest_entitlement_with_receipt(
        self, entitlement: EntitlementSnapshot, *, accepted_at
    ) -> AuthorityUpdateReceipt:
        record = _require_record(entitlement, EntitlementSnapshot)
        _require_accepted_at(accepted_at)
        result = self.ingest_entitlement(record)
        return _authority_receipt(record, result, accepted_at)


def _require_record(value: object, expected: type[T]) -> T:
    if not isinstance(value, expected):
        raise InvalidCanonicalRecordError(
            f"intake accepts only constructed {expected.__name__} objects"
        )
    return value


def _require_provider(store: SQLiteCanonicalStore, provider_id: str) -> None:
    if not any(provider.id == provider_id for provider in store.load_providers()):
        raise ReferenceMissingError(f"provider reference does not exist: {provider_id}")


def _validate_references(
    store: SQLiteCanonicalStore,
    provider_id: str,
    token_id: str | None,
) -> None:
    _require_provider(store, provider_id)
    if token_id is None:
        return
    matches = [token for token in store.load_tokens() if token.id == token_id]
    if not matches:
        raise ReferenceMissingError(f"token reference does not exist: {token_id}")
    if matches[0].provider_id != provider_id:
        raise ReferenceMismatchError(
            f"token {token_id} does not belong to provider {provider_id}"
        )


def _stable_write(writer: Callable[[], WriteResult], record_type: str) -> WriteResult:
    try:
        return writer()
    except StoreConflictError as exc:
        raise IntakeStoreConflictError(
            f"conflicting canonical {record_type} identity"
        ) from exc


def _result(result: WriteResult, record_type: str, identity: str) -> IntakeResult:
    if result is WriteResult.INSERTED:
        return IntakeResult(
            status=IntakeStatus.STORED,
            record_type=record_type,
            record_identity=identity,
            persisted=True,
            idempotent=False,
            reason_code=IntakeReasonCode.STORED,
        )
    return IntakeResult(
        status=IntakeStatus.IDEMPOTENT,
        record_type=record_type,
        record_identity=identity,
        persisted=False,
        idempotent=True,
        reason_code=IntakeReasonCode.EXACT_DUPLICATE,
    )


def _event_identity(*parts: str | None) -> str:
    return ":".join(part if part is not None else "unscoped" for part in parts)


def _secret_gate(record: CanonicalRecord) -> None:
    values = _text_values(record)
    if any(contains_plaintext_secret(value) for value in values if value):
        raise SecretRejectedError("canonical intake rejected secret-shaped content")


def _text_values(record: CanonicalRecord) -> tuple[str | None, ...]:
    source = record.metadata.source if isinstance(record, PricingAuthorityRecord) else record.source
    source_values = _source_text(source)
    if isinstance(record, Provider):
        return (record.id, record.key, record.display_name, *source_values)
    if isinstance(record, Token):
        return (
            record.id,
            record.provider_id,
            record.label,
            record.masked_identifier,
            record.secret_ref,
            *source_values,
        )
    if isinstance(record, BalanceSnapshot):
        return (record.provider_id, record.token_id, *source_values)
    if isinstance(record, UsageRecord):
        return (
            record.usage_id,
            record.provider_id,
            record.token_id,
            record.model,
            record.attribution.project_id,
            record.attribution.module_id,
            record.attribution.task_id,
            record.attribution.run_id,
            *source_values,
        )
    if isinstance(record, PricingSnapshot):
        return (
            record.provider_id,
            record.token_id,
            record.model,
            record.currency,
            *source_values,
        )
    if isinstance(record, PricingAuthorityRecord):
        return (record.authority_id, record.provider_id, record.model,
                record.metadata.official_source, *source_values)
    if isinstance(record, EntitlementSnapshot):
        return (record.entitlement_id, record.provider_id, record.token_id,
                record.plan, record.model, record.fee_currency,
                record.billing_cycle, record.quota_cycle,
                record.metadata.official_source,
                *(value for limit in record.limits for value in (limit.unit, limit.model)),
                *source_values)
    return (
        record.provider_id,
        record.token_id,
        record.model,
        record.currency,
        record.cost_basis,
        record.usage_id,
        *source_values,
    )


def _source_text(source: SourceTag) -> tuple[str | None, ...]:
    return (source.source_reference,)


def _require_batch(records: Iterable[CanonicalRecord]) -> tuple[CanonicalRecord, ...]:
    if isinstance(records, (str, bytes, dict)) or not isinstance(records, Iterable):
        raise InvalidCanonicalRecordError("batch must be an iterable of canonical records")
    supplied = tuple(records)
    if not supplied:
        raise InvalidCanonicalRecordError("batch must not be empty")
    allowed = (Provider, Token, BalanceSnapshot, UsageRecord, PricingSnapshot,
               CostRecord, PricingAuthorityRecord, EntitlementSnapshot)
    if any(not isinstance(item, allowed) for item in supplied):
        raise InvalidCanonicalRecordError("batch accepts only constructed canonical records")
    return supplied


def _batch_order(records: tuple[CanonicalRecord, ...]) -> tuple[CanonicalRecord, ...]:
    order = {Provider: 0, Token: 1, BalanceSnapshot: 2, UsageRecord: 3,
             PricingSnapshot: 4, CostRecord: 5, PricingAuthorityRecord: 6,
             EntitlementSnapshot: 7}
    return tuple(sorted(records, key=lambda item: (order[type(item)], _record_identity(item))))


def _record_identity(record: CanonicalRecord) -> str:
    if isinstance(record, Provider): return record.id
    if isinstance(record, Token): return record.id
    if isinstance(record, UsageRecord): return f"{record.provider_id}:{record.usage_id}"
    if isinstance(record, PricingAuthorityRecord): return record.authority_id
    if isinstance(record, EntitlementSnapshot): return record.entitlement_id
    if isinstance(record, BalanceSnapshot):
        return _event_identity(record.provider_id, record.token_id, record.observed_at.isoformat())
    if isinstance(record, PricingSnapshot):
        return _event_identity(record.provider_id, record.token_id, record.model,
                               record.price_dimension.value, record.effective_at.isoformat(),
                               str(record.price_per_unit))
    return _event_identity(record.provider_id, record.token_id, record.model,
                           record.kind.value, record.occurred_at.isoformat(),
                           record.usage_id, str(record.amount))


def _preflight_batch(store: SQLiteCanonicalStore,
                     records: tuple[CanonicalRecord, ...]) -> None:
    providers = {item.id: item for item in store.load_providers()}
    tokens = {item.id: item for item in store.load_tokens()}
    usages: dict[tuple[str, str], UsageRecord] = {}
    for item in store.load_usage():
        key = (item.provider_id, item.usage_id)
        prior = usages.get(key)
        if prior is not None and prior != item:
            raise BatchConflictError(
                f"persisted usage identity is ambiguous: {item.usage_id}"
            )
        usages[key] = item
    persisted_pricing = set(store.load_pricing())
    seen_stable: dict[tuple[type, str], CanonicalRecord] = {}
    seen_events: set[CanonicalRecord] = set()
    for record in records:
        if isinstance(record, (Provider, Token)):
            key = (type(record), record.id)
            prior = seen_stable.get(key)
            if prior is not None and prior != record:
                raise BatchConflictError(f"conflicting batch identity: {record.id}")
            seen_stable[key] = record
        elif record in seen_events:
            continue
        else:
            seen_events.add(record)
        if isinstance(record, Provider):
            if record.id in providers and providers[record.id] != record:
                raise IntakeStoreConflictError("conflicting canonical provider identity")
            providers[record.id] = record
        elif isinstance(record, Token):
            if record.provider_id not in providers:
                raise ReferenceMissingError(f"provider reference does not exist: {record.provider_id}")
            if record.id in tokens and tokens[record.id] != record:
                raise IntakeStoreConflictError("conflicting canonical token identity")
            tokens[record.id] = record
        else:
            _preflight_references(record, providers, tokens, usages, persisted_pricing)
            if isinstance(record, UsageRecord):
                key = (record.provider_id, record.usage_id)
                prior = usages.get(key)
                if prior is not None and prior != record:
                    raise BatchConflictError(f"conflicting batch usage identity: {record.usage_id}")
                usages[key] = record
            elif isinstance(record, PricingSnapshot):
                persisted_pricing.add(record)


def _preflight_references(record, providers, tokens, usages, pricing) -> None:
    if record.provider_id not in providers:
        raise ReferenceMissingError(f"provider reference does not exist: {record.provider_id}")
    token_id = getattr(record, "token_id", None)
    if token_id is not None:
        token_record = tokens.get(token_id)
        if token_record is None:
            raise ReferenceMissingError(f"token reference does not exist: {token_id}")
        if token_record.provider_id != record.provider_id:
            raise ReferenceMismatchError(f"token {token_id} does not belong to provider {record.provider_id}")
    if isinstance(record, CostRecord) and record.usage_id is not None:
        linked = usages.get((record.provider_id, record.usage_id))
        if linked is None:
            raise ReferenceMissingError(f"usage reference does not exist: {record.usage_id}")
        if linked.token_id != record.token_id or linked.model != record.model:
            raise ReferenceMismatchError("cost does not match linked usage token/model identity")
    if isinstance(record, PricingAuthorityRecord) and any(
        component not in pricing for component in record.components
    ):
        raise ReferenceMissingError("pricing authority component is not persisted or batched")


def _write_record(store: SQLiteCanonicalStore, record: CanonicalRecord) -> IntakeResult:
    if isinstance(record, Provider): result, kind, identity = store.put_provider(record), "provider", record.id
    elif isinstance(record, Token): result, kind, identity = store.put_token(record), "token", record.id
    elif isinstance(record, BalanceSnapshot): result, kind, identity = store.append_balance(record), "balance", _record_identity(record)
    elif isinstance(record, UsageRecord): result, kind, identity = store.append_usage(record), "usage", record.usage_id
    elif isinstance(record, PricingSnapshot): result, kind, identity = store.append_pricing(record), "pricing", _record_identity(record)
    elif isinstance(record, CostRecord): result, kind, identity = store.append_cost(record), "cost", _record_identity(record)
    elif isinstance(record, PricingAuthorityRecord): result, kind, identity = store.append_pricing_authority(record), "pricing_authority", record.authority_id
    else: result, kind, identity = store.append_entitlement(record), "entitlement", record.entitlement_id
    return _result(result, kind, identity)


def _authority_receipt(record, result: IntakeResult, accepted_at) -> AuthorityUpdateReceipt:
    metadata = record.metadata
    when = record.effective_from if isinstance(record, PricingAuthorityRecord) else record.observed_at
    return AuthorityUpdateReceipt(
        authority_kind="pricing_authority" if isinstance(record, PricingAuthorityRecord) else "entitlement",
        authority_identity=record.authority_id if isinstance(record, PricingAuthorityRecord) else record.entitlement_id,
        intake_status=result.status, persisted=result.persisted, idempotent=result.idempotent,
        authority_source_type=metadata.authority_source_type,
        source_type=metadata.source.source_type,
        source_reference=metadata.source.source_reference,
        fetched_at=metadata.fetched_at, verified_at=metadata.last_verified_at,
        effective_or_observed_at=when,
        freshness_at_acceptance=metadata.freshness_policy.evaluate(metadata.last_verified_at, accepted_at),
    )


def _require_accepted_at(value) -> None:
    from datetime import datetime
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("accepted_at must be timezone-aware")
