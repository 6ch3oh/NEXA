# ASSET HUMAN VERIFICATION PACKET

Task：`NEXA-CREATOR-REAL-ASSET-TO-PUBLISH-GOAL-001`  
状态：`NO_IN_PROJECT_CANDIDATE / NEW_REAL_ASSET_REQUIRED`

## Machine result

六组有效 `source_import` 共检查 `600` 个文件、`805,312,168` bytes。识别出真实媒体文件 `58` 个：JPG 56、MP4 2。逐文件记录了 absolute path、size、SHA-256、JPG dimensions 与 MP4 duration。

```text
VERIFIED_MATCH      0
STRONG_CANDIDATE    0
AMBIGUOUS           0
UNRELATED          58
INVALID             0
UNKNOWN             0
```

58 个媒体全部由明确的 `CASE-0004` 或 `CASE-0009` identity 管理；没有 manifest、metadata 或 content package 将它们关联到 A2/B3。A2/B3 authoritative metadata 均明确声明 `assets_status = external_or_missing`，直属目录没有图片或视频。案例媒体不可作为 A2/B3 候选。

完整逐文件 evidence：`runtime/receipts/REAL_ASSET_CANDIDATE_RECONCILIATION_V0_1.json`，SHA-256 `70fdf93113e25b4bd68511a83f224ee9dd8d924dd83e0f00250aa614965c9c1a`。

## Human gates

项目内没有 STRONG/AMBIGUOUS 候选，因此当前无需用户在现有 58 个文件中作视觉归属判断。需要用户未来另行提供真实素材：

### `ASSET-INTAKE-A2-001`

- Content：`A2-20260714-001`
- Account：A2 / 抖音
- 需要：与“下课后的校园独白”实际制作相关的 verified 视频、校园空镜、生成画面或 cover；必须能说明真实来源与用途。
- 当前选项：`KEEP_DEFERRED`
- 未来素材到位后可选：`CONFIRM_ASSET / REJECT_ASSET / REFERENCE_ONLY / KEEP_DEFERRED`

### `ASSET-INTAKE-B3-001`

- Content：`B3-20260714-001`
- Account：B3 / 小红书
- 需要：正式渲染的 3:4 卡片 PNG/JPG 与 cover，或可验证的设计源文件；Prompt/README 本身不是发布素材。
- 当前选项：`KEEP_DEFERRED`
- 未来素材到位后可选：`CONFIRM_ASSET / REJECT_ASSET / REFERENCE_ONLY / KEEP_DEFERRED`

将新素材放入本模块可读取的明确目录并提供对应 decision_id 即可继续。系统不会自动采用案例库素材、不会生成 placeholder，也不会修改 `source_import`。
