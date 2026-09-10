# Legacy Identity Resolution V0.1

## Output states

`MATCHED`, `NEW`, `POSSIBLE_DUPLICATE`, `CONFLICT`, `UNRESOLVED`.

## Evidence precedence

1. Same entity type plus exact legacy ID.
2. Exact authorized source path.
3. Exact external post ID.
4. Exact content-package identity.
5. Exact account code for Account.
6. Title equality is only `POSSIBLE_DUPLICATE` and never an automatic match.

Multiple targets for the same authoritative key produce `CONFLICT`. A record with no safe target identity produces `UNRESOLVED`.

## Real conclusions

- Both real content IDs are authoritative according to the legacy three-end rules; no duplicate content ID was found.
- Historical metadata snapshots share the content IDs intentionally and remain reference evidence.
- A1–B3 match real account codes, but Account creation remains manual because real `creator_id` and account status are absent.
- B4 has no real source record and is `UNRESOLVED`/invalid for import planning.
- No external post ID, actual publication identity or metrics identity exists locally.
- Two static Notion page identities exist; Notion database identity is unresolved and no API was called.

## Conflict policy

The resolver never mutates a target and never merges records. Resolution is evidence for `ImportDryRunPlanner`; it is not an import operation.
