# Real Legacy Format Inventory V0.1

## Scope

- Authorized root: `E:\AI工作台\内容创作\06_自媒体运营`
- Reader: `RealLegacyReader`
- Mode: read-only, root-confined, no command execution
- Exclusions inherited from Intake: `.venv`, `__pycache__`
- Files inventoried: `96`
- Parse failures: `0`

The inventory is generated in memory and returns exactly one `RealLegacyFormatRecord` per file. It does not serialize source content or copy real records into NEXA fixtures.

## Required row contract

Every one of the 96 rows contains:

| Field | Meaning |
| --- | --- |
| `asset_family` | Evidence-backed family classification |
| `source_path` | Path relative to the authorized root |
| `file_format` | Physical format, independently from schema |
| `encoding` | Detected text encoding |
| `record_shape` | JSON object/array shape, CSV table shape, or unstructured document shape |
| `identity_fields` | Identity-bearing field names only |
| `status_fields` | Status/state field names only |
| `relationship_fields` | Account/content/Notion/Obsidian relation field names |
| `timestamp_fields` | Date/time field names |
| `provenance_fields` | Source/path/URL/provenance field names |
| `known_nullability` | Observed top-level null/empty fields |
| `known_duplicates` | Identity fields whose values recur in the authorized set |
| `parse_status` | `PARSED`, `UNSTRUCTURED`, or `FAILED` |

## Physical formats

| Format | Files |
| --- | ---: |
| JSON | 42 |
| Markdown | 28 |
| Python | 20 |
| CMD | 3 |
| CSV | 2 |
| Text / gitignore | 1 |
| Total | 96 |

There are `51` distinct `record_shape` values. Equal extensions are therefore not treated as equal schemas.

## Asset-family classification

| Family | Files | Treatment |
| --- | ---: | --- |
| ACCOUNT | 1 | Account adapter |
| CONTENT | 17 | Content, package metadata, registry and historical snapshot recognition |
| PROMPT | 2 | Prompt/asset-reference and human handoff adapters |
| PUBLISH_DRAFT | 2 | Explicitly not a PublishRecord |
| QA_REFERENCE | 2 | Explicitly pre-publish QA, not Review |
| WORKFLOW | 4 | Daily brief/selection/run-log reference adapter |
| KNOWLEDGE_REFERENCE | 3 | Reference-only |
| AUDIT | 12 | Evidence-only |
| RESEARCH | 32 | Not publication Metrics; excluded from canonical import |
| LEGACY_TOOL | 13 | Command reconciliation only; never executed |
| CONFIGURATION | 8 | Compatibility evidence/configuration |

## Real JSON schema families

The 42 JSON files include multiple non-equivalent shapes:

- account configuration keyed by account code;
- daily brief with nested account candidate arrays;
- per-account selection object;
- run log with item events;
- canonical legacy content metadata and four historical snapshot variants per content;
- pre-publish QA object;
- content registry array;
- migration/data-quality audit objects;
- research runtime, capability, plan, output and schema objects.

Only the evidence-backed Account, Content, static Notion reference, Prompt, Asset reference, Content Package, snapshot, QA and daily-workflow shapes enter reconciliation records. Research statistics are not reclassified as publication metrics.

## Real identity and nullability conclusions

- `content_id` is explicitly documented by the legacy system as the cross-system identity key; titles are forbidden as identity.
- A1–B3 are real account codes in the account configuration; B4 is absent and remains unresolved.
- The two canonical metadata records are parseable and have distinct valid content IDs.
- Historical metadata snapshots repeat those content IDs by design and are compatibility evidence, not duplicate ContentItems.
- `sync_event_id` is observed empty and is preserved as null/unresolved semantics.
- `assets_status=external_or_missing` is not converted into a missing-file assertion or a zero-value asset.

## Parser safety

All path resolution is constrained under the constructor-authorized root. Parent traversal fails closed. The reader prunes `.venv` and `__pycache__` before traversal and exposes no write method.
