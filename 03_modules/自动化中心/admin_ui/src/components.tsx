import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import type { CostSummary, PageInfo, TokenSummary } from "./types";

const statusLabels: Record<string, string> = {
  RECEIVED: "已接收",
  VALIDATING: "校验中",
  ACCEPTED: "已受理",
  RUNNING: "进行中",
  SUCCEEDED: "成功",
  PARTIAL_SUCCESS: "部分成功",
  FAILED: "失败",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  SUCCESS: "成功",
  ERROR: "失败",
  NOT_REVIEWED: "未审核",
  PENDING_REVIEW: "待审核",
  NOT_APPLICABLE: "不适用",
  AVAILABLE: "可用",
  PARTIAL: "部分可用",
  NOT_AVAILABLE: "暂无",
};

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("zh-CN");
}

function formatMoney(amount: number, currency: string): string {
  const symbols: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€" };
  return `${symbols[currency] || `${currency} `}${amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

export function CostDisplay({ summary, compact = false }: { summary: CostSummary; compact?: boolean }) {
  if (summary.cost_completeness === "UNAVAILABLE") {
    return <span className="cost cost--unknown">成本未知</span>;
  }
  if (summary.cost_completeness === "MIXED_CURRENCY") {
    return (
      <span className="cost cost--mixed" aria-label="多币种成本，不合并">
        {summary.currency_subtotals.map((item) => (
          <span key={item.currency}>{item.currency} {formatMoney(item.amount, item.currency)}</span>
        ))}
        {!compact && <small>多币种分别显示 · 未计算合计</small>}
      </span>
    );
  }
  const amount = summary.known_cost_subtotal;
  const currency = summary.cost_currency || "USD";
  if (summary.cost_completeness === "PARTIAL") {
    return (
      <span className="cost cost--partial">
        已知 {amount === null ? "—" : formatMoney(amount, currency)} · 部分成本未知
        {!compact && <small>另有 {summary.unknown_cost_invocation_count} 次成本未知</small>}
      </span>
    );
  }
  return <span className="cost cost--complete">{amount === null ? "—" : formatMoney(amount, currency)}</span>;
}

export function TokenDisplay({ summary }: { summary: TokenSummary }) {
  return (
    <span className="token-display">
      {formatInteger(summary.total_tokens_known)}
      {summary.token_unknown_count > 0 && <small> · {summary.token_unknown_count} 次未知</small>}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const tone = ["SUCCEEDED", "SUCCESS", "AVAILABLE", "ACCEPTED"].includes(value)
    ? "success"
    : ["FAILED", "ERROR", "REJECTED", "CANCELLED"].includes(value)
      ? "danger"
      : ["RUNNING", "VALIDATING", "PENDING_REVIEW", "PARTIAL_SUCCESS", "PARTIAL"].includes(value)
        ? "warning"
        : "neutral";
  return <span className={`badge badge--${tone}`}>{statusLabels[value] || value}</span>;
}

export function TierBadge({ value }: { value: string }) {
  return <span className={`tier tier--${value.toLowerCase()}`}>{value}</span>;
}

export function ActorBadge({ value }: { value: "OWNER" | "CUSTOMER" }) {
  return <span className={`actor actor--${value.toLowerCase()}`}>{value}</span>;
}

export function PageTitle({ eyebrow, title, description, aside }: {
  eyebrow: string; title: string; description: string; aside?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {aside && <div className="heading-aside">{aside}</div>}
    </header>
  );
}

export function Panel({ title, subtitle, children, className = "" }: {
  title: string; subtitle?: string; children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
      {children}
    </section>
  );
}

export function MetricCard({ label, value, note, tone = "default" }: {
  label: string; value: ReactNode; note?: ReactNode; tone?: string;
}) {
  return <article className={`metric-card metric-card--${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

export function EmptyState({ children = "当前范围内没有记录" }: { children?: ReactNode }) {
  return <div className="empty-state"><span>○</span><p>{children}</p></div>;
}

export function LoadingState() { return <div className="loading-state"><span /><p>正在读取运营数据…</p></div>; }
export function ErrorState({ error }: { error: Error }) { return <div className="error-state"><strong>读取失败</strong><p>{error.message}</p></div>; }

export function Pager({ page, onOffset }: { page: PageInfo; onOffset: (offset: number) => void }) {
  const current = Math.floor(page.offset / page.limit) + 1;
  return (
    <div className="pager">
      <span>第 {current} 页 · 每页 {page.limit} 条</span>
      <div>
        <button type="button" disabled={page.offset === 0} onClick={() => onOffset(Math.max(0, page.offset - page.limit))}>上一页</button>
        <button type="button" disabled={!page.has_more || page.next_offset === null} onClick={() => page.next_offset !== null && onOffset(page.next_offset)}>下一页</button>
      </div>
    </div>
  );
}

const navItems = [
  ["/", "总览", "概"], ["/customers", "用户", "客"], ["/requests", "请求", "请"],
  ["/knowledge-review", "知识审核", "审"], ["/model-usage", "模型使用", "模"], ["/tier-usage", "用户档位", "档"],
];

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/"><span className="brand-mark">N</span><span><strong>NEXA</strong><small>OWNER 运营台</small></span></Link>
        <nav>{navItems.map(([to, label, icon]) => <NavLink key={to} end={to === "/"} to={to} className={({ isActive }) => isActive ? "active" : ""}><i>{icon}</i><span>{label}</span></NavLink>)}</nav>
        <div className="sidebar-foot"><span className="live-dot" /><div><strong>只读模式</strong><small>无业务写操作</small></div></div>
      </aside>
      <div className="workspace">
        <div className="demo-banner"><strong>演示数据</strong><span>NONPROD DEMO DATASET · 不代表真实运营情况</span><span className="read-only-pill">READ ONLY</span></div>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function RefLink({ value }: { value: string | null }) {
  return value ? <code className="ref-value">{value}</code> : <span>—</span>;
}
