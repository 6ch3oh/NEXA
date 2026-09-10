# Home Learning Summary Public Contract V0.1

```text
CONTRACT_VERSION: 0.1.0
AUTHORITATIVE_PUBLIC_ENTRYPOINT: src/index.mjs
EXPORTS: HOME_LEARNING_SUMMARY_CONTRACT_VERSION, createHomeLearningSummaryAdapter, validateHomeLearningSummary
MODE: read-only projection of the existing CET-6 runtime and learner partition
```

## Source ownership

The adapter receives the already-composed CET-6 runtime and current study plan. It does not create another vocabulary store, learner partition, queue, scheduler, review ledger, or persistence path. It calls only the existing queue/home/statistics/card read surfaces.

The Desktop-managed loopback runtime exposes the narrow read-only endpoint `GET /api/home-summary`. `createStudyCenterDesktopApplication().getHomeSummary()` is the only Core-facing consumer method; it validates the returned public projection and never consumes the broad `/api/bootstrap` payload.

## Summary

`getHomeSummary({ now? })` returns a frozen object containing:

- at most four real vocabulary cards selected by the existing due/relearning/new queue priority;
- `card_id`, `type`, `title`, Chinese core content, bounded explanation, optional example, safe source classification, availability, and an inert card handoff;
- today's completed count and due-review count;
- aggregate progress as `progress_current / progress_total` plus `total_progress` percentage;
- learner-activity `updated_at`, projection `generated_at`, and explicit freshness;
- a Study Center route handoff and a truthful empty reason when no card is due or no content exists.

The adapter never uses AI generation, screenshot examples, or synthetic validation content unless the runtime was explicitly started in its existing test-only synthetic mode. Raw source references and local file paths are not returned.

