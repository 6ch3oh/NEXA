"""Provider-neutral, deterministic local research runtime."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from typing import Any, Mapping, Protocol, Sequence


class ResearchStatus(str, Enum):
    CREATE = "CREATE"
    COLLECT = "COLLECT"
    SYNTHESIZE = "SYNTHESIZE"
    READY_FOR_CONTENT = "READY_FOR_CONTENT"
    BLOCKED = "BLOCKED"
    NEED_MORE_EVIDENCE = "NEED_MORE_EVIDENCE"
    ARCHIVED = "ARCHIVED"


class ResearchSourceType(str, Enum):
    LOCAL_SOURCE = "LOCAL_SOURCE"
    USER_NOTE = "USER_NOTE"
    IMPORTED_RESEARCH = "IMPORTED_RESEARCH"
    LEGACY_RESEARCH = "LEGACY_RESEARCH"
    FUTURE_RADAR_HANDOFF = "FUTURE_RADAR_HANDOFF"


@dataclass(frozen=True)
class ResearchSource:
    source_id: str
    source_type: ResearchSourceType
    reference: str
    summary: str
    evidence: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResearchSession:
    research_id: str
    topic: str
    account_id: str
    content_intent: str
    status: ResearchStatus
    sources: tuple[ResearchSource, ...]
    evidence: tuple[str, ...]
    notes: tuple[str, ...]
    findings: tuple[str, ...]
    open_questions: tuple[str, ...]
    provenance: Mapping[str, Any]
    created_at: datetime
    updated_at: datetime
    version: str = "0.2"


@dataclass(frozen=True)
class TopicCandidate:
    candidate_id: str
    account_id: str
    topic: str
    reason: str
    evidence_references: tuple[str, ...]
    source_research_id: str
    realtime_claim: bool = False
    version: str = "0.2"


class ResearchExecutor(Protocol):
    def synthesize(self, session: ResearchSession, *, now: datetime) -> ResearchSession: ...


class LocalResearchExecutor:
    """Default executor: deterministic string synthesis over supplied local evidence."""

    def synthesize(self, session: ResearchSession, *, now: datetime) -> ResearchSession:
        if not session.sources:
            return replace(
                session, status=ResearchStatus.NEED_MORE_EVIDENCE,
                open_questions=session.open_questions or ("What local evidence supports this topic?",),
                updated_at=now,
            )
        findings = tuple(dict.fromkeys(
            source.summary.strip() for source in session.sources if source.summary.strip()
        ))
        evidence = tuple(dict.fromkeys(
            (*session.evidence, *(item for source in session.sources for item in source.evidence),
             *(source.reference for source in session.sources))
        ))
        status = ResearchStatus.READY_FOR_CONTENT if findings and evidence else ResearchStatus.NEED_MORE_EVIDENCE
        return replace(session, findings=findings, evidence=evidence, status=status, updated_at=now)


class DeterministicTopicPlanner:
    def plan(
        self, *, account_id: str, account_direction: str, research: ResearchSession,
        existing_topics: Sequence[str], operator_intent: str,
    ) -> tuple[TopicCandidate, ...]:
        if research.status is not ResearchStatus.READY_FOR_CONTENT:
            raise ValueError("research must be ready for content")
        existing = {item.strip().casefold() for item in existing_topics}
        seeds = tuple(dict.fromkeys((research.topic, *research.findings)))
        candidates: list[TopicCandidate] = []
        for seed in seeds:
            topic = f"{seed}｜{operator_intent}" if operator_intent else seed
            if topic.strip().casefold() in existing:
                continue
            identity = hashlib.sha256(
                f"{account_id}\0{research.research_id}\0{topic}".encode("utf-8")
            ).hexdigest()[:16]
            candidates.append(TopicCandidate(
                f"topic:{identity}", account_id, topic,
                f"Matches account direction '{account_direction}' and supplied local research",
                research.evidence, research.research_id, False,
            ))
        return tuple(candidates[:5])


class ResearchRuntimeService:
    ALLOWED = {
        ResearchStatus.CREATE: {ResearchStatus.COLLECT, ResearchStatus.BLOCKED, ResearchStatus.ARCHIVED},
        ResearchStatus.COLLECT: {ResearchStatus.SYNTHESIZE, ResearchStatus.NEED_MORE_EVIDENCE,
                                 ResearchStatus.BLOCKED, ResearchStatus.ARCHIVED},
        ResearchStatus.SYNTHESIZE: {ResearchStatus.READY_FOR_CONTENT,
                                    ResearchStatus.NEED_MORE_EVIDENCE, ResearchStatus.BLOCKED},
        ResearchStatus.NEED_MORE_EVIDENCE: {ResearchStatus.COLLECT, ResearchStatus.BLOCKED,
                                            ResearchStatus.ARCHIVED},
        ResearchStatus.BLOCKED: {ResearchStatus.COLLECT, ResearchStatus.ARCHIVED},
        ResearchStatus.READY_FOR_CONTENT: {ResearchStatus.ARCHIVED},
        ResearchStatus.ARCHIVED: set(),
    }

    def __init__(self, store: Any, executor: ResearchExecutor | None = None) -> None:
        self.store = store
        self.repo = store.runtime
        self.executor = executor or LocalResearchExecutor()
        self.topic_planner = DeterministicTopicPlanner()

    def create(
        self, *, research_id: str, topic: str, account_id: str, content_intent: str,
        provenance: Mapping[str, Any], now: datetime,
    ) -> ResearchSession:
        existing = self.repo.find_research(research_id)
        if existing:
            if (
                existing.topic != topic or existing.account_id != account_id
                or existing.content_intent != content_intent
                or dict(existing.provenance) != dict(provenance)
            ):
                raise ValueError("research identity already exists with different payload")
            return existing
        session = ResearchSession(
            research_id, topic, account_id, content_intent, ResearchStatus.CREATE,
            (), (), (), (), (), dict(provenance), now, now,
        )
        self.repo.save_research(session)
        return session

    def add_source(self, research_id: str, source: ResearchSource, *, now: datetime) -> ResearchSession:
        session = self.repo.get_research(research_id)
        if session.status in {ResearchStatus.READY_FOR_CONTENT, ResearchStatus.ARCHIVED}:
            raise ValueError("research no longer accepts sources")
        current = {item.source_id: item for item in session.sources}
        if source.source_id in current:
            if current[source.source_id] == source:
                return session
            raise ValueError("research source identity conflict")
        status = ResearchStatus.COLLECT
        updated = replace(session, status=status, sources=(*session.sources, source), updated_at=now)
        self.repo.update_research(updated)
        return updated

    def synthesize(self, research_id: str, *, now: datetime) -> ResearchSession:
        session = self.repo.get_research(research_id)
        if session.status not in {ResearchStatus.COLLECT, ResearchStatus.SYNTHESIZE,
                                  ResearchStatus.NEED_MORE_EVIDENCE}:
            raise ValueError("research cannot synthesize from current state")
        staged = replace(session, status=ResearchStatus.SYNTHESIZE, updated_at=now)
        result = self.executor.synthesize(staged, now=now)
        self.repo.update_research(result)
        return result

    def transition(self, research_id: str, target: ResearchStatus, *, now: datetime) -> ResearchSession:
        session = self.repo.get_research(research_id)
        if target not in self.ALLOWED[session.status]:
            raise ValueError("invalid research transition")
        updated = replace(session, status=target, updated_at=now)
        self.repo.update_research(updated)
        return updated
