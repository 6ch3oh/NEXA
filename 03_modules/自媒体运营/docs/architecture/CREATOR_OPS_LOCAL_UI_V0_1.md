# Creator Ops Local Production UI V0.1

Status: `READY`  
Goal: `NEXA-CREATOR-UI-PRODUCT-GOAL-001`  
Authoritative facade: `creator_ops.CreatorOpsApplication`  
UI version: `0.1`  
API version: `0.2`

## Outcome

Creator Ops now has a real, offline, desktop-first local web UI. An operator can open the product through `start_creator_ops_ui.cmd` and perform the current production workflow without calling Python functions, SQLite, repositories or Markdown procedures directly.

The UI presents user intent only. All facts, state transitions, validation, package construction, QA, review, publishing records, metrics, research and recovery remain owned by `CreatorOpsApplication`.

## Technology decision

The module had no package manager, frontend framework, local server or reusable production UI. V0.1 therefore uses:

- Python standard-library `HTTPServer` on `127.0.0.1`;
- a small public-API presentation adapter;
- semantic HTML, shared CSS tokens and vanilla JavaScript;
- no downloaded dependency, bundler, Node runtime or public listener.

This is intentionally smaller than introducing React, Vue, Electron or another build/runtime stack. It reuses the authoritative Python runtime and remains deterministic and offline.

## Architecture boundary

```text
Local HTML/CSS/JS
        ↓ JSON / explicit user intent
CreatorOpsUIHost (loopback only)
        ↓
CreatorOpsUIAdapter
        ↓
CreatorOpsApplication public API / public DTOs
        ↓
Authoritative V0.2 runtime
```

Forbidden paths remain absent:

```text
UI → SQLite implementation         NO
UI → repository/query internals    NO
UI → source_import                 NO
UI → legacy writer/CLI             NO
UI → platform/network publisher    NO
UI → second state machine/store    NO
```

`tests/test_creator_ops_ui.py` parses every UI Python import and fails if it imports persistence, query, service, domain, workflow or legacy implementation modules.

## Components

| Component | Responsibility |
|---|---|
| `src/creator_ops/ui/adapter.py` | Public DTO serialization, screen aggregates and an allowlist of user-intent commands |
| `src/creator_ops/ui/host.py` | Loopback lifecycle, local JSON/static bridge, security headers and clean shutdown |
| `src/creator_ops/ui/static/index.html` | Semantic application shell and accessible dialog structure |
| `src/creator_ops/ui/static/styles.css` | Shared spacing, typography, panel, density and status tokens |
| `src/creator_ops/ui/static/app.js` | Navigation, rendering, filters, empty/error/loading states and explicit forms |
| `start_creator_ops_ui.cmd` | Double-click launcher that opens the local product in the default browser |

## Lifecycle

The host owns the application for its complete scope:

```text
start host
→ close any caller-owned open handle
→ bind 127.0.0.1
→ server thread opens CreatorOpsApplication
→ serve UI/API on the same thread as SQLite ownership
→ shutdown server
→ same server thread closes CreatorOpsApplication
→ release port and database connection
```

A single request-serving thread is deliberate: the SQLite connection stays on its owning thread. Startup waits for application readiness; failures do not leave a listener or open connection. Shutdown is idempotent and the same database/port can be reopened.

V0.1 expects the already activated production database. It never silently creates or initializes the formal database.

## Local security

- bind host is exactly `127.0.0.1`; `0.0.0.0` and LAN binding are rejected;
- `Host` is restricted to the bound loopback address or `localhost`;
- every command requires an unguessable per-process token injected into the local shell;
- POST requests accept JSON only, enforce a 1 MiB maximum and validate local `Origin` when present;
- CSP permits only same-origin script, style, image and connection resources;
- framing, MIME sniffing and referrer leakage are disabled;
- static paths are confined to the UI asset root;
- visual previews use only the managed path returned by the public visual-review workbench;
- UI/API responses are not cached; versioned static references avoid stale application code.

The host exposes no login, cookie/token store, verification-code, payment, platform API, collection or publishing capability.

## Navigation and production workbenches

Nine first-level destinations keep the information architecture compact.

| Destination | Implemented work |
|---|---|
| Dashboard | Authoritative summary, Queue, A1–B3 workload, Creator identity and runtime/business health |
| Work Queue | Priority, accounts, content, work type, status, next action, due, blocker and operator overlay |
| Content | State/account/blocked/needs-action filters and production readiness columns |
| Content Detail | Overview, provenance, content, requirements, submissions, visual reviews, canonical assets, Package, QA, Editorial, Publishing and activity |
| Accounts | A1/A2/B1/B2/B3 list and identity/workload/content/activity details; `UNKNOWN` is preserved |
| Assets | A2/B3 production packets, real prompts, requirements, intake submissions and Visual Review entry |
| Reviews | QA evidence, assets, Package, Prompt/Research context, warnings, Editorial Decision and post-publish availability |
| Publishing | Manual Publishing Workbench, readiness evidence, manual record, metrics and post-publish review entry |
| Research | Offline local sessions, evidence, synthesis and topic planning |
| Health | DB/schema/task/recovery/package/QA/visual/import/publishing/network state and safe recovery |

Visual Review displays the managed preview and all 11 operator checks. `APPROVE`, `REJECT` and `REQUEST_CHANGE` require an explicit human confirmation. It never auto-approves.

QA remains five distinct evidence families: Content, Asset, Visual, Package and Publish Prep. Editorial Review is a separate human decision. Package construction calls the public package command and never writes package files from JavaScript.

Manual publishing is labelled explicitly as record-only. The confirmation says that Creator Ops will not publish on the platform and requires `manual_confirmation=true`. Metrics blank values serialize as `null`, not zero. Post-publish review content is entered by the operator; it is not generated automatically.

## Public local routes

Read routes are under `/api/v1`: bootstrap, dashboard, work queue, contents/detail, accounts/detail, assets, reviews, publishing, research, health and managed visual preview.

Writes are accepted only through `/api/v1/actions/{name}` and the adapter allowlist:

- work-item overlay;
- asset submission and human visual decision;
- the five QA families;
- Editorial Review;
- local package construction;
- record manual publication;
- metrics and post-publish review;
- local research/evidence/synthesis/topic planning;
- safe runtime recovery.

Every action calls a public `CreatorOpsApplication` method and refreshes canonical reads after completion.

## States, accessibility and desktop behavior

- shared loading, empty, error and degraded semantics are present on all main surfaces;
- statuses always include text in addition to color;
- forms use labels, buttons use visible names and the skip link targets the main region;
- focus-visible styling, logical DOM order, native submit and explicit Escape dialog cancellation are implemented;
- design is optimized for 1440×900 and 1920×1080;
- 1280×720 browser acceptance measured `scrollWidth=1265` at `innerWidth=1280`, with all primary controls usable.

## Launch

Normal operator use:

```text
double-click start_creator_ops_ui.cmd
```

It opens `http://127.0.0.1:8765/` in the default browser. Closing the terminal with `Ctrl+C` shuts down the host cleanly.

Diagnostic fallback:

```powershell
$env:PYTHONPATH='src'
python -m creator_ops.ui.host --port 8765 --open-browser
```

## Acceptance evidence

- production read displayed Creator `主创作者`, Accounts A1/A2/B1/B2/B3, A2/B3 content and Queue, and 4 + 6 visual requirements;
- A2/B3 next action is `GENERATE_ASSET`, readiness `BLOCKED`, health `HEALTHY`;
- production DB SHA-256 before/after UI and browser smoke remained `1d699b4f3af3087cef083329c195169d8eb35bee7e21463829435d1ec4c37c18`;
- application-browser smoke navigated every primary page and A2 detail at 1440×900, repeated 1280×720 layout acceptance, exercised dialog keyboard cancellation and found zero page-console errors;
- writes and restart tests used temporary SQLite databases only;
- final NEXA and Legacy results are recorded in the Goal audit report.

## Seal

`CREATOR_OPS_LOCAL_UI_V0.1 = READY`

This seal does not mean Core integration or platform integration. Future Core work may host this product through the public contract; it must not replace the facade or introduce another data/business route.
