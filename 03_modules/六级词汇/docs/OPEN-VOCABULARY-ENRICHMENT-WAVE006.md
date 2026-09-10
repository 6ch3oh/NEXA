# Wave 006 开放英语学习资料施工记录

状态：`IMPLEMENTED / LOCAL_ONLY / ATTRIBUTED`

## 产物

- 主词库：`data/ecdict-qualified/current/vocabulary-library.json`，5,311 条，保持不变。
- 新增 sidecar：`data/ecdict-qualified/current/vocabulary-enrichment-wave006.json`。
- sidecar 大小：14,431,065 bytes。
- sidecar SHA-256：`963d1743fcc3c35901f8936cbaa5b4fb53fc7a32dbbb74848ad45e6507e088c9`。
- 生成器：`scripts/build-open-vocabulary-enrichment.mjs`。
- 来源与许可：根目录 `LICENSES_AND_ATTRIBUTIONS.md`。

## 字段覆盖

| 字段 | 有资料词条数 | 来源 |
| --- | ---: | --- |
| US IPA | 5,279 | CMUdict ARPAbet，经固定 NEXA 映射转换 |
| 英文多义项 | 5,288 | Open English WordNet 2025 |
| 真实例句 | 4,300 | Open English WordNet 2025，保留 sense/synset 来源 |
| 关联常用短语 | 2,567 | Open English WordNet 同义 synset 中的多词成员 |
| UniMorph 词形 | 3,255 | UniMorph English |
| 派生词 | 4,590 | OEWN 形态派生 + 通过 OEWN 词头存在性过滤的 UniMorph 派生 |
| 近义词 | 4,766 | Open English WordNet synset |
| 反义词 | 1,123 | Open English WordNet sense relation |
| 用法标签 | 144 | Open English WordNet adjective position |

缺失字段不会填充猜测值；页面统一显示“该项资料暂缺”。中文释义只沿用现有 ECDICT 字段，没有把 OEWN 英文释义机器翻译成中文。

## 产品接入

- 学习中心完整词卡和 Hover/键盘聚焦预览均读取同一 sidecar。
- 首页知识卡读取同一 `HomeLearningSummary` 投影，显示英美音、音标、义项、例句、短语、词形、派生词、同反义词、用法标签与来源许可。
- 美音 IPA 来自 CMUdict 的可审计机械转换；发音按钮仍调用本地 Windows SAPI，不发出运行时网络请求。
- 资料 sidecar 缺失或无对应词条时，保留原词库和原功能，不导致学习中心整体失败。

## 存储与网络边界

- 下载前 E: 盘剩余 221,715,185,664 bytes。
- 已下载源文件合计约 38.8MB；解压阶段总 staging 111,228,514 bytes，远低于 4GB 临时上限。
- sidecar 生成和验证后已删除 72,404,635-byte OEWN 临时解压目录；当前 staging 保留量 38,825,767 bytes。
- 最终生产 sidecar 14.43MB，远低于 300MB 上限。
- 运行时网络依赖仍为 0。
- 没有商业词典抓取、整套语音下载或外部 AI 调用。

## 自动验证

- `tests/open-vocabulary-enrichment-wave006.test.mjs` 校验 5,311 条目标覆盖、300MB 上限、固定来源 SHA、许可身份、示例词字段、来源链和低质量派生过滤。
- 学习模块聚焦测试 16/16 通过。
- Core 学习桥与首页投影聚焦测试 20/20 通过。
- 学习模块语法检查 143 files 通过。
- 本地 HTTP smoke：`abandon` 返回 US `əbˈændən`、UK `ә'bændәn`、8 个义项、6 个例句、2 个关联短语、3 个词形、3 个经筛选派生词及 4 个来源身份；首页投影同步返回开放资料。
