# Manual Publishing Workbench V0.1

## Package reuse

The workbench references `ContentPackageV01`; it does not copy or replace the
ContentItem aggregate. It presents target account/platform, title, body or
script reference, linked assets, cover, notes, planned time and checklist.

## Checklist

Each item returns PASS, FAIL, UNKNOWN or NOT_APPLICABLE with a reason. Critical
checks cover:

- body or script readiness;
- declared/required asset readiness;
- approved content review;
- target account existence and active status;
- absence of blocked content state;
- complete content provenance;
- title/body/account/package completeness.

Any critical FAIL prevents the confirmation command from proceeding.

## Single manual publish path

`confirm_manual_publish` validates the matching MANUAL_PUBLISH WorkItem,
rebuilds the checklist from current domain data, then delegates to the
NEXA-CREATOR-002 `ContentPipelineService.record_manual_publish` method.

The existing pipeline enforces `manual_confirmation=True`, account relation and
the `READY_TO_PUBLISH → PUBLISHED` transition. The workbench creates no
PublishRecord directly. On success it marks the operational work item DONE and
derives a METRICS_BACKFILL item from the new published state.

There is no automatic publish path, platform client, browser automation,
credential/session handling, API call, like, comment, or message capability.

## Metrics and review

The Metrics Backfill Workbench shows the allowed metric fields, existing values,
missing values and collection time. It preserves `None` versus measured `0`.
Actual recording continues through the 002 pipeline with MANUAL, FIXTURE or
FUTURE_ADAPTER input mode.

The Review Workbench shows Content, PublishRecord, Metrics, Assets and any
existing Review. `suggested_fields_to_fill` is exactly the set of empty review
sections; it never generates evaluations or conclusions.
