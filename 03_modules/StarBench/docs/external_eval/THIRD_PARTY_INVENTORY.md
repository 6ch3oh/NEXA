# StarBench Third-Party Eval Asset Inventory V0.1

## Scope and authority

This inventory covers exactly KBF, CompatBench, and Promptfoo. Each repository is
a fixed, shallow, local candidate snapshot under
`source_import/third_party_candidates`, marked `READ_ONLY_REFERENCE` and
`NOT_PRODUCTION`. None is a StarBench authority, runtime dependency, or production
integration.

Acquisition used public Git transport only. No repository script, package manager,
probe, endpoint test, eval, Provider API, or model API was run. Credential reads
were zero.

## Fixed snapshots

| Candidate | Repository | Default branch | Exact commit | Acquisition timestamp (UTC) | Acquisition | Shallow | Tracked files | Worktree size | Principal source/language profile | Status |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| KBF | `https://github.com/Ooo0ption/KBF.git` | `main` | `b789b4b7abe119e28ec6260142564b2189ff5449` | `2026-08-22T05:23:32.5142666Z` | `git clone --depth 1` | yes | 27 | 1.84 MiB | JSON: 16 files/1,770,672 B; Python: 5/112,899 B; Markdown: 2/34,820 B | `READ_ONLY_REFERENCE`, `NOT_PRODUCTION` |
| CompatBench | `https://github.com/RuizhangZhou/CompatBench.git` | `main` | `40e2bcc1f2e6a566baa8cd3b5abf965c0a11245e` | `2026-08-22T05:23:38.4138256Z` | `git clone --depth 1` | yes | 46 | 0.19 MiB | Python: 30 files/166,047 B; Markdown: 6/16,245 B | `READ_ONLY_REFERENCE`, `NOT_PRODUCTION` |
| Promptfoo | `https://github.com/promptfoo/promptfoo.git` | `main` | `127d90534b9c1b1ba4554f007dd4b5fd2c8bf1b4` | `2026-08-22T05:23:42.1965730Z` | `git clone --depth 1` | yes | 5,516 | 227.18 MiB | TypeScript: 2,024 files/25,769,364 B; Markdown: 842/6,951,697 B; TSX: 638/6,326,193 B; YAML: 632/4,060,963 B; PNG assets: 367/116,365,027 B | `READ_ONLY_REFERENCE`, `NOT_PRODUCTION` |

The worktree sizes are local snapshot observations, not upstream release-size
claims. Git provenance was read with per-command `safe.directory` configuration;
the global Git configuration was not modified.

## License audit

| Candidate | Formal license evidence | SPDX | Modify | Commercial/internal use | NOTICE/attribution | Future source-copy obligation | Independent runner obligation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KBF | Root `LICENSE`, SHA-256 `6BC14AE5EEC46B82AF2F0292B4B810EC5DCF539E7708A95CEA75D52D82649EA1` | `Apache-2.0` | permitted | permitted | No root NOTICE found. Preserve license, copyright/patent/trademark notices; mark modified files; include NOTICE content if a copied distribution later includes applicable NOTICE material | Include Apache-2.0 license, retain required notices, identify changes, and respect patent termination/attribution terms | Keep the license with the distributed runner; StarBench adapter documentation must identify the external component and pinned version | CLEAR |
| CompatBench | Root `LICENSE` plus `pyproject.toml`, SHA-256 `09215207F579798DB89F532FDFF828A2D400AF1F3E4F0DF31833C6EDF2ED1C01` | `MIT` | permitted | permitted | No root NOTICE found. Copies or substantial portions retain copyright and permission notice | Retain the MIT copyright and permission notice in copied/substantial portions | Preserve the MIT license in a distributed independent runner/package | CLEAR |
| Promptfoo | Root `LICENSE` plus package metadata, SHA-256 `31777A96A6539ED54B89601C1A739E5312A8DEAB23FF9401C986F5C80A912056` | `MIT` | permitted | permitted | No root NOTICE found. Copies or substantial portions retain copyright and permission notice. A nested red-team provider subtree carries an additional Microsoft/PyRIT MIT attribution file | Retain root MIT notice and audit any copied subtree for nested notices before copying | Preserve applicable root and nested license notices with the distributed runner/package | CLEAR_WITH_NESTED_NOTICE_REVIEW |

This is an engineering inventory, not legal advice. Any later source copying must
repeat the license audit against the exact files selected.

## Candidate safety surface

A targeted high-confidence secret-pattern scan excluded `.git` data. KBF and
CompatBench produced no matches. Promptfoo produced matches in tests, examples,
docs-site content, and source that constructs or detects key-shaped values. Review
found public demonstration/test material, including a committed example key, but no
evidence of a live or usable Provider credential.

Classification: `TEST_FIXTURE_SECRET_MATERIAL_PRESENT`; current StarBench secret
leakage: `0`. No matched value is reproduced here. The Promptfoo snapshot must stay
quarantined, and its demo key material or secret-derived cache artifacts must never
be copied into StarBench source, fixtures, reports, or evidence.

## Provenance controls

- Repository URL, default branch, exact commit, upstream commit timestamp,
  acquisition timestamp, shallow state, and license hash are recorded per snapshot.
- Candidate metadata is StarBench-local and untracked by the upstream commit; the
  pinned upstream commit remains independently verifiable through Git.
- The snapshots were read selectively: README/license/package metadata, entrypoint,
  protocol/provider/evaluation contracts, and files located by targeted search.
- No candidate output was promoted to `RAW_RESULT`, Canonical Evaluation, Evidence,
  Score, Profile, Decision, or any existing ledger/seal.

## Baseline preservation

- Production source modified: `NO`
- External prospective validation files modified: `NO`
- Production integration: `NO`
- Real model/API calls: `0`
- Model API token cost: `0`
- Authoritative regression baseline retained: `598/598 PASS`

The complete adoption rationale is in the three candidate audits and
`STARBENCH_EXTERNAL_EVAL_ADOPTION_DECISION_V0_1.md`.
