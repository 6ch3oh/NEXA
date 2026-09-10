import { FormEvent, type ReactElement, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ownerRead } from "./data-provider";
import {
  ActorBadge, CostDisplay, EmptyState, ErrorState, formatDate, formatInteger,
  LoadingState, MetricCard, PageTitle, Pager, Panel, RefLink, StatusBadge,
  TierBadge, TokenDisplay,
} from "./components";
import type {
  CustomerDetail, CustomerPage, KnowledgePage, ModelUsageItem, Overview,
  RequestDetail, RequestListItem, RequestPage, TierUsageItem,
} from "./types";

type ReadState<T> = { data: T | null; loading: boolean; error: Error | null };

function useOwnerRead<T>(operation: string, params: Record<string, string | number | null | undefined>): ReadState<T> {
  const key = useMemo(() => JSON.stringify(params), [params]);
  const [state, setState] = useState<ReadState<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    ownerRead<T>(operation, JSON.parse(key)).then(
      (data) => active && setState({ data, loading: false, error: null }),
      (reason) => active && setState({ data: null, loading: false, error: reason instanceof Error ? reason : new Error("读取失败") }),
    );
    return () => { active = false; };
  }, [operation, key]);
  return state;
}

function DataBoundary<T>({ state, children }: { state: ReadState<T>; children: (data: T) => ReactElement }) {
  if (state.loading && !state.data) return <LoadingState />;
  if (state.error) return <ErrorState error={state.error} />;
  if (!state.data) return <EmptyState />;
  return children(state.data);
}

function RequestRows({ items, showActor = false }: { items: RequestListItem[]; showActor?: boolean }) {
  if (!items.length) return <EmptyState />;
  return (
    <div className="table-scroll"><table><thead><tr>
      <th>请求</th>{showActor && <th>身份</th>}<th>用户 / 档位</th><th>能力</th><th>状态</th><th>模型</th><th>Token</th><th>成本</th><th>审核</th><th>时间</th>
    </tr></thead><tbody>{items.map((item) => <tr key={item.request_id}>
      <td><Link className="primary-link" to={`/requests/${encodeURIComponent(item.request_id)}`}>{item.request_id}</Link><small>{item.result_summary || "暂无结果摘要"}</small></td>
      {showActor && <td><ActorBadge value={item.actor_type} /></td>}
      <td><span>{item.customer_id}</span><TierBadge value={item.user_tier} /></td>
      <td><code>{item.capability_id}</code></td><td><StatusBadge value={item.status} /></td>
      <td>{item.resolved_models_summary.length ? item.resolved_models_summary.join(" · ") : "—"}</td>
      <td><TokenDisplay summary={item.token_summary} /></td><td><CostDisplay summary={item.cost_summary} compact /></td>
      <td><StatusBadge value={item.knowledge_review_state} /></td><td>{formatDate(item.created_at)}</td>
    </tr>)}</tbody></table></div>
  );
}

export function OverviewPage() {
  const state = useOwnerRead<Overview>("getOverview", { preset: "TODAY", timezone: "Asia/Shanghai", recent_limit: 10 });
  return <><PageTitle eyebrow="OWNER / 今日运营" title="总览" description="先看业务是否在正常运转，再进入用户和请求定位细节。" aside={<span className="date-chip">Asia/Shanghai · 今日</span>} />
    <DataBoundary state={state}>{(data) => <>
      <section className="metrics-grid">
        <MetricCard label="今日用户" value={formatInteger(data.unique_customer_count)} note="CUSTOMER 去重" tone="cyan" />
        <MetricCard label="今日请求" value={formatInteger(data.request_counts.total_requests)} note={`${data.customer_request_count} CUSTOMER · ${data.owner_request_count} OWNER`} />
        <MetricCard label="成功" value={formatInteger(data.request_counts.succeeded)} note={`${data.request_counts.partial_success} 次部分成功`} tone="green" />
        <MetricCard label="失败" value={formatInteger(data.request_counts.failed)} note={`${data.request_counts.rejected} 次拒绝`} tone="red" />
        <MetricCard label="AI Token" value={formatInteger(data.token_summary.total_tokens_known)} note={data.token_summary.token_unknown_count ? `${data.token_summary.token_unknown_count} 次 Token 未知` : "已知调用 Token"} />
        <MetricCard label="AI 成本" value={<CostDisplay summary={data.cost_summary} compact />} note={
          data.cost_summary.cost_completeness === "MIXED_CURRENCY"
            ? `多币种分别显示 · 未计算合计${data.cost_summary.unknown_cost_invocation_count ? ` · ${data.cost_summary.unknown_cost_invocation_count} 次未知` : ""}`
            : data.cost_summary.cost_completeness === "PARTIAL"
              ? `${data.cost_summary.unknown_cost_invocation_count} 次成本未知`
              : data.cost_summary.cost_completeness === "COMPLETE" ? "成本完整" : "没有可用成本记录"
        } tone="violet" />
        <MetricCard label="待审核" value={formatInteger(data.knowledge_review.not_reviewed + data.knowledge_review.pending_review)} note={`${data.knowledge_review.pending_review} 项已进入待审核`} tone="amber" />
      </section>
      <Panel title="最近动态" subtitle="用户、档位、能力、状态、实际模型与时间一屏可见">
        <RequestRows items={data.recent_requests} showActor />
      </Panel>
    </>}</DataBoundary>
  </>;
}

const customerDefaults = { search: "", tier: "", activity: "ALL" };
export function CustomersPage() {
  const [draft, setDraft] = useState(customerDefaults);
  const [filters, setFilters] = useState(customerDefaults);
  const [offset, setOffset] = useState(0);
  const params = useMemo(() => ({ ...filters, limit: 50, offset }), [filters, offset]);
  const state = useOwnerRead<CustomerPage>("listCustomers", params);
  const submit = (event: FormEvent) => { event.preventDefault(); setOffset(0); setFilters(draft); };
  return <><PageTitle eyebrow="CUSTOMER 运营" title="用户" description="观察用户档位、活跃度、请求质量、Token 与成本完整度。" />
    <form className="filter-bar" onSubmit={submit} aria-label="用户筛选"><label>搜索用户<input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="customer_id" /></label>
      <label>档位<select value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}><option value="">全部档位</option>{["FREE", "BASIC", "PRO", "PREMIUM"].map(x => <option key={x}>{x}</option>)}</select></label>
      <label>活跃状态<select value={draft.activity} onChange={(e) => setDraft({ ...draft, activity: e.target.value })}><option value="ALL">全部</option><option value="ACTIVE">活跃</option><option value="INACTIVE">不活跃</option></select></label><button type="submit">应用筛选</button></form>
    <Panel title="用户列表" subtitle="按最近活动排序 · 服务端筛选与分页"><DataBoundary state={state}>{(data) => <>{!data.items.length ? <EmptyState /> : <div className="table-scroll"><table><thead><tr><th>用户</th><th>档位</th><th>首次 / 最近</th><th>请求</th><th>成功 / 失败</th><th>调用</th><th>Token</th><th>成本</th><th>完整度</th><th>待审核</th></tr></thead><tbody>{data.items.map(item => <tr key={item.customer_id}><td><Link className="primary-link" to={`/customers/${encodeURIComponent(item.customer_id)}`}>{item.customer_id}</Link><small><span className={item.is_active ? "active-dot" : "inactive-dot"} />{item.is_active ? "活跃" : "不活跃"}</small></td><td><TierBadge value={item.user_tier} /></td><td>{formatDate(item.first_seen_at)}<small>{formatDate(item.last_seen_at)}</small></td><td>{formatInteger(item.request_count)}</td><td>{item.success_count} / {item.failed_count}</td><td>{formatInteger(item.invocation_count)}</td><td>{formatInteger(item.known_token_total)}</td><td><CostDisplay summary={item.cost_summary} compact /></td><td><span className="completeness">{item.cost_summary.cost_completeness}</span></td><td>{item.pending_review_count}</td></tr>)}</tbody></table></div>}<Pager page={data.page} onOffset={setOffset} /></>}</DataBoundary></Panel>
  </>;
}

export function CustomerDetailPage() {
  const { customerId = "" } = useParams();
  const [offset, setOffset] = useState(0);
  const state = useOwnerRead<CustomerDetail>("getCustomer", { customer_id: customerId, limit: 50, offset });
  return <><PageTitle eyebrow="CUSTOMER 详情" title={customerId} description="仅展示该 CUSTOMER 的观察档位、用量与历史请求。" aside={<Link className="back-link" to="/customers">← 返回用户</Link>} />
    <DataBoundary state={state}>{(data) => <>
      <Panel title="基本情况"><div className="detail-grid"><div><span>customer_id</span><strong>{data.customer_id}</strong></div><div><span>当前观察档位</span><TierBadge value={data.current_observed_tier} /></div><div><span>首次使用</span><strong>{formatDate(data.first_seen_at)}</strong></div><div><span>最近活动</span><strong>{formatDate(data.last_seen_at)}</strong></div></div></Panel>
      <section className="metrics-grid metrics-grid--compact"><MetricCard label="请求总数" value={data.total_requests} /><MetricCard label="成功" value={data.succeeded} tone="green" /><MetricCard label="失败" value={data.failed} tone="red" /><MetricCard label="AI 调用" value={data.invocation_count} /><MetricCard label="Token" value={<TokenDisplay summary={data.token_summary} />} /><MetricCard label="已知成本" value={<CostDisplay summary={data.cost_summary} compact />} note={data.cost_summary.cost_completeness} /><MetricCard label="待审核" value={data.pending_review_count} tone="amber" /></section>
      <Panel title="历史请求" subtitle="只读取引用与安全摘要"><RequestRows items={data.recent_requests.items} /><Pager page={data.recent_requests.page} onOffset={setOffset} /></Panel>
    </>}</DataBoundary>
  </>;
}

const requestDefaults = { actor: "", customer_id: "", tier: "", status: "", capability: "", provider: "", model: "", review: "", preset: "LAST_30_DAYS", from: "", to: "" };
export function RequestsPage() {
  const [draft, setDraft] = useState(requestDefaults); const [filters, setFilters] = useState(requestDefaults); const [offset, setOffset] = useState(0);
  const params = useMemo(() => ({ ...filters, from: filters.preset === "CUSTOM" && filters.from ? new Date(filters.from).toISOString() : "", to: filters.preset === "CUSTOM" && filters.to ? new Date(filters.to).toISOString() : "", timezone: "Asia/Shanghai", limit: 50, offset }), [filters, offset]);
  const state = useOwnerRead<RequestPage>("listRequests", params);
  const field = (key: keyof typeof draft, value: string) => setDraft({ ...draft, [key]: value });
  const submit = (event: FormEvent) => { event.preventDefault(); setOffset(0); setFilters(draft); };
  return <><PageTitle eyebrow="OWNER / CUSTOMER" title="请求" description="按业务身份、用户、模型与审核状态定位一次真实业务请求。" />
    <form className="filter-bar filter-bar--wide" onSubmit={submit} aria-label="请求筛选">
      <label>身份<select value={draft.actor} onChange={e => field("actor", e.target.value)}><option value="">全部</option><option>OWNER</option><option>CUSTOMER</option></select></label><label>用户<input value={draft.customer_id} onChange={e => field("customer_id", e.target.value)} placeholder="精确 customer_id" /></label><label>档位<select value={draft.tier} onChange={e => field("tier", e.target.value)}><option value="">全部</option>{["FREE","BASIC","PRO","PREMIUM","OWNER"].map(x => <option key={x}>{x}</option>)}</select></label><label>状态<select value={draft.status} onChange={e => field("status", e.target.value)}><option value="">全部</option>{["SUCCEEDED","PARTIAL_SUCCESS","FAILED","REJECTED","RUNNING"].map(x => <option key={x}>{x}</option>)}</select></label><label>能力<input value={draft.capability} onChange={e => field("capability", e.target.value)} placeholder="capability" /></label><label>Provider<input value={draft.provider} onChange={e => field("provider", e.target.value)} placeholder="provider" /></label><label>模型<input value={draft.model} onChange={e => field("model", e.target.value)} placeholder="model" /></label><label>审核<select value={draft.review} onChange={e => field("review", e.target.value)}><option value="">全部</option>{["NOT_REVIEWED","PENDING_REVIEW","ACCEPTED","REJECTED","NOT_APPLICABLE"].map(x => <option key={x}>{x}</option>)}</select></label><label>日期范围<select value={draft.preset} onChange={e => field("preset", e.target.value)}><option value="TODAY">今天</option><option value="YESTERDAY">昨天</option><option value="LAST_7_DAYS">近 7 天</option><option value="LAST_30_DAYS">近 30 天</option><option value="CUSTOM">自定义</option></select></label>{draft.preset === "CUSTOM" && <><label>开始<input type="datetime-local" value={draft.from} onChange={e => field("from", e.target.value)} /></label><label>结束<input type="datetime-local" value={draft.to} onChange={e => field("to", e.target.value)} /></label></>}<button type="submit">应用筛选</button>
    </form>
    <Panel title="请求列表" subtitle="默认 50 条 · 最大 500 · 查询服务分页"><DataBoundary state={state}>{(data) => <><RequestRows items={data.items} showActor /><Pager page={data.page} onOffset={setOffset} /></>}</DataBoundary></Panel>
  </>;
}

export function RequestDetailPage() {
  const { requestId = "" } = useParams(); const state = useOwnerRead<RequestDetail>("getRequest", { request_id: requestId });
  return <><PageTitle eyebrow="REQUEST 详情" title={requestId} description="只展示安全元数据、受控调用摘要和结果引用；不会展开正文或 Artifact。" aside={<Link className="back-link" to="/requests">← 返回请求</Link>} />
    <DataBoundary state={state}>{(data) => <>
      <Panel title="请求"><div className="detail-grid"><div><span>业务身份</span><ActorBadge value={data.actor_type} /></div><div><span>用户 / 档位</span><strong>{data.customer_id}</strong><TierBadge value={data.user_tier} /></div><div><span>能力</span><code>{data.capability_id}</code></div><div><span>状态</span><StatusBadge value={data.status} /></div><div><span>创建</span><strong>{formatDate(data.created_at)}</strong></div><div><span>开始 / 完成</span><strong>{formatDate(data.started_at)} / {formatDate(data.completed_at)}</strong></div></div></Panel>
      <Panel title="输入" subtitle="仅元数据与逻辑引用，不自动加载大型正文"><div className="detail-grid"><div><span>类型</span><strong>{data.input_type}</strong></div><div><span>安全摘要</span><strong>{data.input_summary || "—"}</strong></div><div><span>来源 URL</span><RefLink value={data.source_url} /></div><div><span>输入引用</span><RefLink value={data.input_ref} /></div></div></Panel>
      <Panel title={`AI 调用 · ${data.invocation_count}`} subtitle={data.invocations_truncated ? "列表已按 500 条安全上限截断" : "全部调用按发生时间展示"}>{!data.invocations.length ? <EmptyState>该请求没有 AI 调用记录</EmptyState> : <div className="invocation-list">{data.invocations.map((item, index) => <article key={item.invocation_id} className="invocation-card"><header><span>调用 {index + 1}</span><StatusBadge value={item.status} /><time>{formatDate(item.occurred_at)}</time></header><div><dl><dt>Model Profile</dt><dd>{item.model_profile}</dd><dt>Provider / 实际模型</dt><dd>{item.provider} / {item.model}</dd><dt>Token</dt><dd>输入 {formatInteger(item.input_tokens)} · 输出 {formatInteger(item.output_tokens)} · 总计 {formatInteger(item.total_tokens)}</dd><dt>成本</dt><dd>{item.cost_amount === null ? "成本未知" : `${item.cost_currency} ${item.cost_amount}`} · {item.cost_source}</dd><dt>延迟</dt><dd>{item.latency_ms === null ? "未知" : `${item.latency_ms} ms`}</dd><dt>安全错误</dt><dd className={item.safe_error ? "safe-error" : ""}>{item.safe_error || "—"}</dd></dl></div></article>)}</div>}</Panel>
      <Panel title="Result" subtitle="只展示引用，不读取结果正文"><div className="detail-grid"><div><span>状态</span><StatusBadge value={data.result_status} /></div><div><span>摘要</span><strong>{data.result_summary || "—"}</strong></div><div><span>Result ref</span><RefLink value={data.result_ref} /></div><div><span>Markdown ref</span><RefLink value={data.markdown_ref} /></div><div className="detail-span"><span>Artifact refs</span>{data.artifact_refs.length ? data.artifact_refs.map(ref => <RefLink key={ref} value={ref} />) : "—"}{data.artifact_refs_truncated && <small>引用列表已截断</small>}</div><div><span>知识审核</span><StatusBadge value={data.knowledge_review.state} /><small>只读 · 本版本不提供接受或拒绝</small></div></div></Panel>
    </>}</DataBoundary>
  </>;
}

export function KnowledgeReviewPage() {
  const [offset, setOffset] = useState(0); const state = useOwnerRead<KnowledgePage>("listKnowledgeReviewQueue", { limit: 50, offset });
  return <><PageTitle eyebrow="READ ONLY" title="知识审核" description="定位待审核结果与引用；本版本不提供接受、拒绝或知识库写入。" aside={<span className="disabled-chip">写操作将在后续版本开放</span>} />
    <Panel title="待审核队列" subtitle="仅 CUSTOMER · 未审核或待审核"><DataBoundary state={state}>{(data) => <>{!data.items.length ? <EmptyState /> : <div className="table-scroll"><table><thead><tr><th>请求</th><th>用户 / 档位</th><th>输入摘要</th><th>结果摘要</th><th>模型</th><th>时间</th><th>Result / Markdown</th><th>状态</th></tr></thead><tbody>{data.items.map(item => <tr key={item.request_id}><td><Link className="primary-link" to={`/requests/${encodeURIComponent(item.request_id)}`}>{item.request_id}</Link></td><td>{item.customer_id}<TierBadge value={item.user_tier} /></td><td>{item.input_summary || "—"}</td><td>{item.result_summary || "—"}</td><td>{item.resolved_models.join(" · ") || "—"}</td><td>{formatDate(item.created_at)}</td><td><RefLink value={item.result_ref} /><RefLink value={item.markdown_ref} /></td><td><StatusBadge value={item.review_state} /></td></tr>)}</tbody></table></div>}<Pager page={data.page} onOffset={setOffset} /></>}</DataBoundary></Panel>
  </>;
}

export function ModelUsagePage() {
  const [tier, setTier] = useState(""); const state = useOwnerRead<ModelUsageItem[]>("getModelUsage", { tier, preset: "LAST_30_DAYS", timezone: "Asia/Shanghai", limit: 100 });
  return <><PageTitle eyebrow="实际调用" title="模型使用" description="按 Provider + Model 汇总真实用量，不评价模型质量。" aside={<label className="inline-filter">档位<select value={tier} onChange={e => setTier(e.target.value)}><option value="">全部</option>{["FREE","BASIC","PRO","PREMIUM","OWNER"].map(x => <option key={x}>{x}</option>)}</select></label>} />
    <Panel title="近 30 天模型用量"><DataBoundary state={state}>{(data) => !data.length ? <EmptyState /> : <div className="table-scroll"><table><thead><tr><th>Provider</th><th>模型</th><th>请求</th><th>Invocation</th><th>Token</th><th>成本</th><th>完整度</th><th>失败</th><th>平均延迟</th><th>最近使用</th></tr></thead><tbody>{data.map(item => <tr key={`${item.provider}:${item.model}`}><td><code>{item.provider}</code></td><td><strong>{item.model}</strong></td><td>{item.request_count}</td><td>{item.invocation_count}</td><td>{formatInteger(item.known_tokens)}</td><td><CostDisplay summary={item.cost_summary} compact /></td><td><span className="completeness">{item.cost_summary.cost_completeness}</span></td><td>{item.failure_count}</td><td>{item.average_latency_ms === null ? "—" : `${Math.round(item.average_latency_ms)} ms`}<small>{item.latency_sample_count} 个样本</small></td><td>{formatDate(item.last_used_at)}</td></tr>)}</tbody></table></div>}</DataBoundary></Panel>
  </>;
}

export function TierUsagePage() {
  const state = useOwnerRead<TierUsageItem[]>("getTierUsage", { preset: "LAST_30_DAYS", timezone: "Asia/Shanghai" });
  return <><PageTitle eyebrow="固定档位" title="用户档位" description="查看 FREE / BASIC / PRO / PREMIUM / OWNER 的实际用量；不触发模型切换。" />
    <Panel title="近 30 天档位用量"><DataBoundary state={state}>{(data) => <div className="tier-cards">{data.map(item => <article key={item.user_tier} className={`tier-card tier-card--${item.user_tier.toLowerCase()}`}><header><TierBadge value={item.user_tier} /><span>{item.unique_users} users</span></header><dl><div><dt>请求</dt><dd>{formatInteger(item.requests)}</dd></div><div><dt>AI 调用</dt><dd>{formatInteger(item.invocations)}</dd></div><div><dt>Token</dt><dd>{formatInteger(item.known_tokens)}</dd></div><div><dt>成功率</dt><dd>{item.success_rate === null ? "—" : `${(item.success_rate * 100).toFixed(1)}%`}</dd></div><div><dt>待审核</dt><dd>{item.pending_review}</dd></div></dl><footer><span>成本</span><CostDisplay summary={item.cost_summary} /></footer></article>)}</div>}</DataBoundary></Panel>
  </>;
}
