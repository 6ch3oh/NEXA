# Content Source and Safe Import V0.1

状态：`REAL_CONTENT_PENDING`

当前仓库没有经过授权核验的正式 CET-6 全量词库。`fixtures/` 中的词条和题目全部是 `TEST / SYNTHETIC`，不得用于正式内容声明。

## 来源合同

词汇包 Manifest 固定记录 `packageId / packageVersion / collectionId / entryCount / SHA-256 contentDigest / createdAt / provenance`。Provenance 记录：

- `OFFICIAL / THIRD_PARTY / USER_PROVIDED / SYNTHETIC / UNKNOWN_SOURCE`；
- 来源 URL、权利人、许可证、证据引用和获取时间；
- 是否允许本地保存、修改和再分发。

`OFFICIAL` 必须有 origin URL 与证据；`THIRD_PARTY` 必须有许可证标识与证据。`localStorage=false` 会在 dry-run 阶段拒绝。

## 导入事务边界

基础 Importer 顺序固定为：Manifest 验证 → Domain 严格校验 → digest/count 校验 → Store 冲突检测 → 质量报告 → `addMany` 原子提交 → Import Receipt。

Dry-run 的 `mutationCount` 固定为 0。Store 的 `addMany` 先验证全部 identity，再写入，因此任何失败都不产生部分 Store 导入。

本地正式 Library workflow 在配置 `createLocalVocabularyLibraryRestorePointManager` 后使用受保护流程：PRE_IMPORT safe point → 候选 Library 原子写入 → reload/hash/count/receipt 校验 → 最后才执行 Store `addMany`。失败时恢复并验证导入前 Library，返回 `IMPORT_ROLLED_BACK`；缺失或无法验证 safe point 时返回 `IMPORT_ROLLBACK_FAILED`。只有该真实能力启用的未来 Receipt 才记录 `rollbackSupported=true`，历史/未受保护 Receipt 继续真实保持 `false`。详见 [Library Restore / Rollback](LIBRARY-RESTORE-ROLLBACK.md)。

质量报告覆盖 US/UK 音标、英文释义、例句和 phrase sense 缺口；它不伪造缺失字段，也不把“能进入 Study Engine”表述为“内容可正式发布”。

## 通用内容导入

QUESTION_ANSWER / MULTIPLE_CHOICE 支持 JSON、CSV、Markdown 的 `validate / preview / import`。未知字段、重复 identity、CSV 未知/重复列、列数漂移、第三方来源缺许可证据均 fail closed。PDF、Excel 和 `.apkg` 未实现。

## 来源审计结论

2026-08-13 的公开网络检索没有找到同时满足“明确权利人、明确本地保存/修改/再分发权限、可核验内容范围”的 CET-6 正式词库，因此没有下载或导入任何真实词表。正式数据仍需项目方提供授权证据或由后续独立审计确认。
