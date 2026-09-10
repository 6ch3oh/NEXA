from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from src.contracts import (
    BalanceSnapshot,
    CostRecord,
    PricingSnapshot,
    Provider,
    Token,
    UsageRecord,
    PricingAuthorityRecord,
    EntitlementSnapshot,
)


class WriteResult(str, Enum):
    INSERTED = "inserted"
    IDEMPOTENT = "idempotent"


@dataclass(frozen=True)
class CanonicalCollections:
    providers: tuple[Provider, ...]
    tokens: tuple[Token, ...]
    balances: tuple[BalanceSnapshot, ...]
    usages: tuple[UsageRecord, ...]
    pricing: tuple[PricingSnapshot, ...]
    costs: tuple[CostRecord, ...]
    pricing_authorities: tuple[PricingAuthorityRecord, ...] = ()
    entitlements: tuple[EntitlementSnapshot, ...] = ()

    def as_query_kwargs(self) -> dict[str, tuple]:
        """Return caller-injected collections for ``QueryService``.

        The store contract deliberately does not import or construct the Query
        Service, keeping persistence and read selection as separate layers.
        """
        return {
            "providers": self.providers,
            "tokens": self.tokens,
            "balances": self.balances,
            "usages": self.usages,
            "pricing": self.pricing,
            "costs": self.costs,
            "pricing_authorities": self.pricing_authorities,
            "entitlements": self.entitlements,
        }


class CanonicalStore(ABC):
    @abstractmethod
    def put_provider(self, provider: Provider) -> WriteResult: ...

    @abstractmethod
    def put_token(self, token: Token) -> WriteResult: ...

    @abstractmethod
    def append_balance(self, snapshot: BalanceSnapshot) -> WriteResult: ...

    @abstractmethod
    def append_usage(self, usage: UsageRecord) -> WriteResult: ...

    @abstractmethod
    def append_pricing(self, snapshot: PricingSnapshot) -> WriteResult: ...

    @abstractmethod
    def append_cost(self, record: CostRecord) -> WriteResult: ...

    @abstractmethod
    def append_pricing_authority(self, record: PricingAuthorityRecord) -> WriteResult: ...

    @abstractmethod
    def append_entitlement(self, snapshot: EntitlementSnapshot) -> WriteResult: ...

    @abstractmethod
    def load_providers(self) -> tuple[Provider, ...]: ...

    @abstractmethod
    def load_tokens(self) -> tuple[Token, ...]: ...

    @abstractmethod
    def load_balances(self) -> tuple[BalanceSnapshot, ...]: ...

    @abstractmethod
    def load_usage(self) -> tuple[UsageRecord, ...]: ...

    @abstractmethod
    def load_pricing(self) -> tuple[PricingSnapshot, ...]: ...

    @abstractmethod
    def load_costs(self) -> tuple[CostRecord, ...]: ...

    @abstractmethod
    def load_pricing_authorities(self) -> tuple[PricingAuthorityRecord, ...]: ...

    @abstractmethod
    def load_entitlements(self) -> tuple[EntitlementSnapshot, ...]: ...

    def load_collections(self) -> CanonicalCollections:
        return CanonicalCollections(
            providers=self.load_providers(),
            tokens=self.load_tokens(),
            balances=self.load_balances(),
            usages=self.load_usage(),
            pricing=self.load_pricing(),
            costs=self.load_costs(),
            pricing_authorities=self.load_pricing_authorities(),
            entitlements=self.load_entitlements(),
        )

    @abstractmethod
    def close(self) -> None: ...
