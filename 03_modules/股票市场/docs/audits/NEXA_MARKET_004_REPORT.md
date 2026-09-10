# NEXA-MARKET-004 正式验收报告

## Task

任务 ID：`NEXA-MARKET-004`

任务名称：`Local Durable Repository V0.1`

施工模式：`TEMPORARY_CODEX_DIRECT_IMPLEMENTATION`

Codex：`GPT-5.6 Sol`

Reasoning：`High`

Codex 调用次数：`1 / 1`

OpenCode：`0`

DeepSeek：`0`

## Status

`PASS`

## Baseline

施工前股票市场完整离线测试：`84/84 PASS`

## Local Repository

状态：`PASS`

实现：

- `LocalWatchlistRepository`
- `LocalPositionRepository`
- `LocalObservationRepository`
- 共享底层 `LocalStateStore`

三种 Repository 实现现有 Protocol，不要求 Service 知道存储类型。调用方必须显式传入绝对路径，代码不依赖当前工作目录，也不在 Domain 中硬编码路径。

## Repository Contract Parity

状态：`PASS`

Watchlist、Position、Observation 的 add/get/list/replace/delete 核心行为分别在 InMemory 与 Local File 实现上运行同组测试。Local repositories 均通过现有 runtime-checkable Protocol。

为保持 Observation 历史不变量，InMemory 与 Local Observation Repository 的 replace 均只允许 tags 变化；修改 content、time、evidence、author 或 provenance 会返回 `False`。

## Storage Layout

单文件、三 section：

```json
{
  "schema_version": 1,
  "format_version": "nexa-market-state-json-v1",
  "watchlist": [],
  "positions": [],
  "observations": []
}
```

编码：`UTF-8`

Serialization：sorted JSON keys、固定缩进、尾随换行、record 按业务 identity 排序、Decimal 使用字符串、datetime 使用带时区 ISO-8601。

## Schema Versioning

状态：`PASS`

- `schema_version = 1`
- `format_version = nexa-market-state-json-v1`
- 缺失/额外顶层字段：`MALFORMED_STORE`
- schema/format 类型错误：`MALFORMED_STORE`
- 不支持的 schema/format：`UNSUPPORTED_VERSION`
- 重复 JSON object key：`MALFORMED_STORE`

## Future Version Fail-Closed

状态：`PASS`

任何不等于当前 schema 或 format 的版本均拒绝加载，不尝试猜测或自动兼容。`schema_version=999` fixture 已验证。

## Atomic Write

状态：`PASS`

Windows/Python 标准库流程：

1. 在正式文件同目录创建唯一临时文件；
2. 以 UTF-8 写入完整 deterministic payload；
3. `flush()`；
4. `os.fsync()`；
5. 关闭临时文件；
6. `os.replace()` 原子替换正式文件；
7. 失败时清理临时文件。

通过注入失败的 replace function 模拟替换故障。验证结果：抛出 `IO_FAILURE`、旧正式文件字节完全不变、可继续正常 reload，临时文件得到清理。

## Partial Record Recovery

状态：`PASS`

顶层格式和版本安全时，各 section 逐条严格解码：

- 合法记录加入 `RepositoryLoadResult.state`；
- 非法记录拒绝并产生 diagnostic；
- status 为 `PARTIALLY_INVALID`；
- loaded_count 与 rejected_count 明确；
- 单条坏记录不会吞掉其他合法记录。

为避免静默丢弃拒绝记录，`PARTIALLY_INVALID` store 只允许读取恢复，任何 mutation 均 fail closed 为 `RECORD_INVALID`，且原文件保持不变。

## Record Diagnostics

状态：`PASS`

每条 diagnostic 包含：

- section
- source array index
- 可安全获得的 record identity
- `RECORD_INVALID` 或 `IDENTITY_CONFLICT`
- 不含原始 secret value 的 reason

文件级错误通过独立 `RepositoryError(RepositoryFailure)` 表达，区分：

- `MALFORMED_STORE`
- `UNSUPPORTED_VERSION`
- `RECORD_INVALID`
- `IDENTITY_CONFLICT`
- `IO_FAILURE`

missing file 使用稳定 `RepositoryLoadStatus.NEW_STORE`，不作为 corruption exception。

## Identity Conflict Handling

状态：`PASS`

- Watchlist：以 `instrument_id` 检测重复；冲突组全部拒绝。
- Position：duplicate position_id 全部拒绝；同 instrument 的多个 OPEN positions 全部拒绝。
- Observation：duplicate observation_id 全部拒绝，即使内容完全相同也不选择其中一条。
- 不采用 first-wins 或 last-wins。
- 相同 symbol、不同 instrument_id/exchange 的 WatchlistItem 保持独立并可 round-trip。

## Round Trip

状态：`PASS`

已验证：

- Instrument reference
- WatchlistItem
- Position
- HistoricalObservation
- Provenance
- enum
- Decimal
- aware datetime
- tuple/list fields

完整链路：domain object → strict serializer → atomic file → strict deserializer → equal domain object。

## Unicode

状态：`PASS`

中文 note、tags、content 使用 UTF-8 原文保存，未被 ASCII escape；reload 后与原对象相等。

## Service Integration

状态：`PASS`

使用 Local repositories 运行现有 WatchlistService、PositionService、ObservationService；随后创建全新的 Repository 与 Service 实例，均能恢复并查询已保存状态。Service 文件修改数为 0，继续只依赖 Repository Protocol。

## Portfolio Integration

状态：`PASS`

USD、CNY、HKD manual positions 保存并 reload 后，直接输入现有 PortfolioSnapshotService；输出三个 currency buckets、global total 为 None、completeness 为 PARTIAL。未修改或重新实现 Portfolio/PnL。

## Position MANUAL Invariant

状态：`PASS`

`origin` 必须成功构造成 `PositionOrigin.MANUAL`。fixture 中注入 `BROKER` 会拒绝单条记录并产生 `RECORD_INVALID` diagnostic；不会进入恢复状态。

## Observation History Invariant

状态：`PASS`

- duplicate observation identity 整组拒绝，不覆盖历史。
- Repository replace 只允许 tags metadata 变化。
- conflicting content 不会被写入替换。

## Missing / Empty Store

- 文件不存在：`NEW_STORE`，loaded/rejected 均为 0，不自动视为损坏。
- `initialize()`：创建带完整版本头的合法空 store。
- 三 section 全空：合法。
- 删除全部记录后：仍是可重新加载的合法版本化空 store。
- zero-byte/truncated file：`MALFORMED_STORE`。

## Persistence

`LOCAL_VERSIONED_FILE`

未实现 backup manager、event sourcing、database、行情 cache 或复杂历史系统。

## Security

Third-party Dependencies Added：`0`

Network：`0`

未保存或读取 API Key、Password、Cookie、Account Token、Broker Credential、Brokerage Account、Payment 信息。额外/未知 record fields 会导致该记录拒绝，不能借 JSON 扩展字段注入未授权数据。

Repository errors 独立于 AdapterError 和 ServiceError。

## Yahoo Adapter

Yahoo Adapter Changed：`NO`

Final Provider Selected：`NO`

Yahoo Finance Chart JSON 继续仅为 `TEMPORARY_VALIDATION_PROVIDER`。

## Trading Boundary

Broker Capability Introduced：`NO`

Trading Capability Introduced：`NO`

未增加 Order、Broker Sync、Account Storage、FX、资金或执行能力。

## Tests

- Baseline：`84/84 PASS`
- Local Repository：`30/30 PASS`
- Total：`114/114 PASS`

覆盖：valid empty/populated、malformed JSON、missing schema、future schema、truncated file、duplicate JSON keys、invalid Watchlist/Position/Observation、illegal origin、duplicate identities、mixed recovery、Unicode、atomic failure、round-trip、parity、Service integration、Portfolio integration。

执行命令：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -B -m unittest discover -s tests -v
```

## Files Created

- `nexa_market/repositories/serialization.py`
- `nexa_market/repositories/local_file.py`
- `tests/test_local_repository.py`
- `tests/storage_fixtures/valid_empty.json`
- `tests/storage_fixtures/malformed_json.json`
- `tests/storage_fixtures/missing_schema.json`
- `tests/storage_fixtures/future_schema.json`
- `tests/storage_fixtures/truncated.json`
- `tests/storage_fixtures/duplicate_object_key.json`
- `tests/storage_fixtures/README.md`
- `docs/audits/NEXA_MARKET_004_REPORT.md`

## Files Modified

- `nexa_market/repositories/__init__.py`
- `nexa_market/repositories/memory.py`
- `README.md`

## Core Contract Changes

Contract Correction：`NONE`

`domain.py`、`pnl.py`、`adapters.py`、Services、Portfolio 与 Yahoo Adapter 均未修改。

InMemoryObservationRepository 仅收紧现有 replace 实现以保持与 Local Repository 相同的“只允许 tags 变化”历史不变量；Repository Protocol 未改变。

## Outside Scope

`NONE`

所有文件均位于 `<PROJECT_ROOT>\03_modules\股票市场`。

## 阻塞项

无。

## Next Recommendation

下一独立任务可建立显式的 partial-store 检查与人工修复/导出流程，让用户审阅 diagnostics 后决定如何处理拒绝记录。若未来出现多个进程同时写同一文件的真实需求，再增加跨进程锁或单写入者协调；V0.1 已通过同进程锁与原子 replace 保证单进程可靠性，不提前扩展成数据库平台。
