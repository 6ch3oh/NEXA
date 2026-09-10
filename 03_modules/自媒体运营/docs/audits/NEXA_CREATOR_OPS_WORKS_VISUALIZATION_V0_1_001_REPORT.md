# NEXA Creator Ops 作品可视化 V0.1 工程报告

TASK: `NEXA-CREATOR-OPS-WORKS-VISUALIZATION-V0_1-001`

STATUS: `BLOCKED`

PROJECT_PATH: `<PROJECT_ROOT>\03_modules\自媒体运营`

NEXA_ROOT: `<PROJECT_ROOT>`

## 结论

当前权威 Creator Ops Local UI 是由 Python 标准库 `HTTPServer` 提供的 loopback Web UI，并通过 `start_creator_ops_ui.cmd` 打开系统默认浏览器。该页面没有 Electron/Windows 原生文件路径桥，且 Host 明确设置 `X-Frame-Options: DENY`，当前 Core Handoff 只暴露 loopback endpoint。

标准浏览器中的文件选择与 Explorer 拖放不能可靠向页面或本地 HTTP Host 暴露 Windows 绝对路径。若改为上传 `File` 内容，会把“收录”变成内容传输/复制，并且无法支持重启后的原位置访问、PotPlayer 打开、打开所在位置或可靠重新定位。这与本任务的最高数据原则冲突。

要完整实现 Explorer 拖放且保持 path-only 收录，至少需要以下任一能力：

1. Core/Electron 提供受控的原生文件选择与 drop-path broker；或
2. 新增第二套具备 Windows 原生拖放能力的 Creator Ops Desktop Host。

两者分别命中“不得修改 Core”和“不得创建第二套 Creator Ops UI”的停止条件。因此没有派发 OpenCode/DeepSeek，也没有进行业务代码施工。

## Baseline

STARTING_BASELINE: `228/228 PASS`

- Python `unittest`: `224/224 PASS`
- Node Home Widget: `4/4 PASS`
- Production DB: `491520 bytes`
- Production DB SHA-256: `1D699B4F3AF3087CEF083329C195169D8EB35BEE7E21463829435D1EC4C37C18`
- Production DB LastWriteTimeUtc: `2026-08-13T12:27:38.2265992Z`
- `source_import`: `1491` files; metadata digest `5C9C9F725883898FF9B0759366588D0730929B055AA94AE5F90E4756BE8F1DCF`
- `<NEXA_ROOT>\自媒体作品`: not created before this audit

FINAL_BASELINE: `228/228 PASS / NO IMPLEMENTATION CHANGE`

The only Project write is this audit report. No runtime, source, test, database, legacy or user-content file was changed.

## Existing assets reused or assessed

EXISTING_ASSETS_REUSED:

- Existing nine-page SPA navigation and hash routing can add one additive route after the native-path dependency is resolved.
- `CreatorOpsUIAdapter` is the correct presentation/application boundary.
- `CreatorOpsApplication` and the authoritative SQLite database are the correct business-data owners; a second business database is unnecessary.
- Existing Visual Review preview route demonstrates safe allowlisted media serving, but it is Canonical Asset-specific and must not be reused as Local Work identity.
- Existing visual media validation understands PNG/JPEG/MP4 metadata, but the canonical pipeline copies media and therefore cannot implement path-only Work collection.
- The current Host already enforces loopback binding, CSRF, local Origin validation, CSP and static path confinement.
- Existing temp-database and temp-directory fixtures are suitable for future safe tests.

## Required output matrix

WORKS_PAGE: `NOT_IMPLEMENTED / BLOCKED_BY_NATIVE_PATH_BRIDGE`

TOP_TABS: `SPECIFIED: 全部 | 最近 | 作品集 / NOT_IMPLEMENTED`

DEFAULT_TAB: `SPECIFIED: 最近 / NOT_IMPLEMENTED`

RECENT_SEMANTICS: `SPECIFIED: media-created time, Windows creation fallback, seven days / NOT_IMPLEMENTED`

IMPORT_CLICK: `BLOCKED_FOR_END_TO_END_CONTRACT`; a server-side Windows picker is feasible, but implementing it alone would leave mandatory Explorer drag/drop inconsistent.

IMPORT_DRAG_DROP: `BLOCKED`; the current default-browser surface cannot provide a durable absolute local path without a native broker.

COPY_ON_IMPORT: `NONE`; no import implementation was added.

IMAGE_SUPPORT: `EXISTING_CANONICAL_PREVIEW_ONLY / WORKS_SUPPORT_NOT_IMPLEMENTED`

VIDEO_SUPPORT: `EXISTING_MP4_VALIDATION_ONLY / WORKS_PLAYBACK_NOT_IMPLEMENTED`

GRID_4: `NOT_IMPLEMENTED`

GRID_9: `NOT_IMPLEMENTED`

GRID_16: `NOT_IMPLEMENTED`

MULTI_IMAGE_WORK: `NOT_IMPLEMENTED`

MAIN_IMAGE: `NOT_IMPLEMENTED`

THUMBNAIL_STRIP: `NOT_IMPLEMENTED`

THUMBNAIL_ANIMATION: `NOT_IMPLEMENTED`

PORTFOLIO: `NOT_IMPLEMENTED`

SIMPLE_VIDEO: `NOT_IMPLEMENTED`

POTPLAYER: `NOT_IMPLEMENTED`; no existing safe external-program discovery/invoke contract was found.

MANAGED_WORKS_ROOT: `<NEXA_ROOT>\自媒体作品`; directory remains absent and was not created during this blocked audit.

LOCATION_STATES: `DESIGNED_IN_REQUIREMENT / NOT_IMPLEMENTED`

RELOCATE_SUPPORT: `NOT_IMPLEMENTED`

MOVE_PERMISSION: `NOT_IMPLEMENTED`

BOOT_DEFAULT: `REQUIRED_OFF / NOT_IMPLEMENTED`

POWERSHELL_BOUNDARY: `NO POWERSHELL EXECUTION ADDED`

REAL_FILE_DELETE: `NONE`

PRODUCTION_DB_CHANGED_BY_TESTS: `NO`

SOURCE_IMPORT_WRITES: `0`

CORE_WRITES: `0`

CROSS_MODULE_WRITES: `0`

FOCUSED_TESTS: `NOT_RUN`; implementation stopped before source changes.

FULL_REGRESSION: `228/228 PASS` at the live pre-construction baseline; no executable source was changed afterward.

UI_SMOKE: `NOT_RUN`; no Works page exists to smoke-test, and claiming UI PASS would be false.

MODIFIED_FILES: `0`

NEW_FILES:

- `docs/audits/NEXA_CREATOR_OPS_WORKS_VISUALIZATION_V0_1_001_REPORT.md`

UNAUTHORIZED_WRITES: `0`

## Minimum unblocking scope

The preferred repair is a narrow Core/Desktop-owned public capability that returns user-approved absolute local paths for:

- file selection;
- folder selection;
- Explorer file/folder drop;
- relocate selection.

The broker must be explicit-user-intent only, loopback/session bound, path-only, non-uploading, non-copying, and must not expose generic filesystem or shell access. Creator Ops would remain the owner of Work/Media identity, metadata, portfolio state, location state, thumbnails, playback actions and restricted moves.

After that contract exists, the Creator Ops implementation can remain additive: new Work/Media tables in the existing authoritative SQLite database, one new SPA route, on-demand cached previews, allowlisted local media serving, a session-default-OFF restricted mover, safe external-program discovery and fixture-only tests.

## Remaining gaps

REMAINING_GAPS:

- No approved native absolute-path broker for click picker, folder picker, Explorer drag/drop or relocate.
- No existing general-purpose Works thumbnail cache.
- No existing PotPlayer discovery/invoke contract.
- No Works/Media persistence model exists yet; this is additive work after the native-path dependency is authorized.
- OpenCode calls: `0`.
- DeepSeek primary attempts: `0`; dispatch was intentionally withheld because preflight already met a mandatory stop condition.

