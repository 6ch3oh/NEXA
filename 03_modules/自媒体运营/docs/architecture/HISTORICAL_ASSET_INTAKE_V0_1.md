# Historical Asset Intake V0.1

## Purpose

This is a read-only evidence intake boundary, not a disk search facility. A
caller supplies one or more explicit `HistoricalAssetManifestEntry` records.
The service validates, inspects, classifies, maps where supported, and reports.

## Manifest contract

Each entry carries manifest and asset-set identity, `AssetFamily`, source type,
absolute local path, `READ_ONLY`, expected format, legacy system, optional
account/content scope, complete provenance, notes, and enabled state.

Validation is fail-closed. It rejects:

- empty and relative paths;
- disk roots and known module/workspace aggregate directories;
- wildcard/glob paths and parent traversal;
- URL and UNC/network paths;
- undeclared family/source type;
- any mode other than `READ_ONLY`;
- missing or incomplete provenance;
- unsupported manifest versions and mismatched entry identity.

Manifest loading validates its own path before reading it. No path is expanded
through discovery or inferred from adjacent folders.

## Dry Run

`HistoricalAssetIntakeService.dry_run` returns immutable `IntakeResult` records
and an `IntakePlan` whose `write_operations` is always empty. It checks the
explicit target's existence, readability, basic file/directory type and format.
It never copies, migrates, renames, deletes, or writes source assets.

For JSON families supported by the existing compatibility layer, Dry Run
actually parses the synthetic record and invokes its mapper. Missing evidence,
unsupported formats, and mapping failures remain `UNKNOWN`.

## Fixture classification evidence

The 11 synthetic entries produce:

| Classification | Count | Evidence |
|---|---:|---|
| REUSE_AS_IS | 1 | V0.1 fixture Manifest identity validates directly |
| REUSE_WITH_ADAPTER | 7 | Account, Content, Content Package, Publish, Metrics, Review, Prompt mappers run |
| MIGRATION_REQUIRED | 1 | readable legacy Workflow CSV has no V0.1 workflow adapter |
| REFERENCE_ONLY | 1 | media reference remains external/reference-only |
| UNKNOWN | 1 | deliberately unrecognized legacy file |

These are fixture outcomes only. They do not mean any real historical asset has
been located or connected.
