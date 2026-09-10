# Market Product Information Architecture V0.1

## Product position

NEXA Market V0.1 is a personal investment research workspace, investment memory, beginner learning aid, and risk observation desk. It is not a trading terminal. Beginner Mode is on by default, and every visible state must be understandable without repository, cache, evidence-ref, or provider knowledge.

## Primary navigation

Only four primary entries are exposed:

1. **Home** — answer “What most needs my attention today?” through selected CN/HK/US indices, portfolio status, watchlist preview, and Attention Today.
2. **Watchlist** — stable, searchable/filterable/sortable list of companies being followed, including price, priority, tags, note, holding, research, event, risk, and attention state.
3. **Portfolio** — manual positions, cost, value, unrealized PnL, quote completeness, and allocation inside each currency bucket. Cross-currency totals are unavailable without reliable FX.
4. **Research & Journal** — instruments needing review, research lifecycle and quality, stale evidence, invalidated theses, decision journals, and retrospectives.

Instrument Detail is a core drill-down, not a fifth navigation silo. Its nine sections follow user questions: Header, My Relationship, Beginner Summary, Fundamentals, Events, Risks, Research, Evidence, and History.

## Status and error language

- Empty content uses an explanation and a safe next step; it never fabricates zeroes.
- Partial, stale, missing, unavailable, evidence conflict, and research quality states carry visible text and do not rely on red/green color.
- User-facing failures expose title, explanation, severity, affected area, whether other data remains usable, and a safe next action. Tracebacks, exception types, and repository paths are forbidden.
- A damaged local store stays read-only and explains that unsafe records were not used. Manual recovery is outside the product facade.

## Actions and boundaries

The UI contract permits watchlist edits, manual-position recording, observations, research drafts/reviews, journal creation/review, evidence viewing, and explanations. Attention Today may recommend only REVIEW, READ, UPDATE_RESEARCH, CHECK_DATA, or RECORD_DECISION. There are no order, broker, transfer, or execution actions.

Queries are supplied by `MarketProductAPI`, composed over the unchanged `MarketReadAPI`. Writes remain in existing state services and `MarketResearchApplication`; the read API never writes. Projections are JSON-safe, stable-order, card-oriented, and make no desktop-width, hover, or complex-table assumption, so a future mobile consumer can use the same contract.

## Authoritative demo states

`product_personas()` provides deterministic New, Light, Complete, and Data Issues personas. `MarketProductSnapshot` yields Home, Watchlist, Portfolio, Detail, Research Center, and Decision Journal in one call. Six compact golden contracts pin the public projections.
