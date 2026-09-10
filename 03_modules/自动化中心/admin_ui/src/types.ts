export type CostCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "MIXED_CURRENCY";

export interface CurrencySubtotal {
  currency: string;
  amount: number;
  invocation_count: number;
}

export interface CostSummary {
  known_cost_subtotal: number | null;
  cost_currency: string | null;
  cost_completeness: CostCompleteness;
  unknown_cost_invocation_count: number;
  mixed_currency: boolean;
  currency_subtotals: CurrencySubtotal[];
}

export interface TokenSummary {
  input_tokens_known: number;
  output_tokens_known: number;
  total_tokens_known: number;
  token_unknown_count: number;
}

export interface PageInfo {
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

export interface RequestListItem {
  request_id: string;
  actor_type: "OWNER" | "CUSTOMER";
  customer_id: string;
  user_tier: string;
  capability_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  invocation_count: number;
  token_summary: TokenSummary;
  resolved_models_summary: string[];
  resolved_providers_summary: string[];
  cost_summary: CostSummary;
  result_status: string;
  result_summary: string | null;
  result_ref: string | null;
  markdown_ref: string | null;
  knowledge_review_state: string;
}

export interface Overview {
  window: { from_at: string; to_at: string; timezone_name: string; preset: string };
  unique_customer_count: number;
  owner_request_count: number;
  customer_request_count: number;
  request_counts: {
    total_requests: number;
    succeeded: number;
    partial_success: number;
    failed: number;
    rejected: number;
    running: number;
  };
  invocation_count: number;
  token_summary: TokenSummary;
  cost_summary: CostSummary;
  knowledge_review: {
    not_reviewed: number;
    pending_review: number;
    accepted: number;
    rejected: number;
  };
  recent_requests: RequestListItem[];
}

export interface CustomerListItem {
  customer_id: string;
  user_tier: string;
  first_seen_at: string;
  last_seen_at: string;
  request_count: number;
  success_count: number;
  failed_count: number;
  invocation_count: number;
  known_token_total: number;
  cost_summary: CostSummary;
  pending_review_count: number;
  is_active: boolean;
}

export interface CustomerPage {
  items: CustomerListItem[];
  page: PageInfo;
  active_since: string;
}

export interface RequestPage {
  items: RequestListItem[];
  page: PageInfo;
}

export interface CustomerDetail {
  customer_id: string;
  current_observed_tier: string;
  first_seen_at: string;
  last_seen_at: string;
  total_requests: number;
  succeeded: number;
  failed: number;
  invocation_count: number;
  token_summary: TokenSummary;
  cost_summary: CostSummary;
  pending_review_count: number;
  recent_requests: RequestPage;
}

export interface InvocationItem {
  invocation_id: string;
  model_profile: string;
  provider: string;
  model: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_amount: number | null;
  cost_currency: string | null;
  cost_source: string;
  latency_ms: number | null;
  safe_error: string | null;
  occurred_at: string;
}

export interface RequestDetail {
  request_id: string;
  actor_type: "OWNER" | "CUSTOMER";
  customer_id: string;
  user_tier: string;
  capability_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  input_type: string;
  input_summary: string | null;
  source_url: string | null;
  input_ref: string | null;
  invocations: InvocationItem[];
  invocation_count: number;
  invocations_truncated: boolean;
  cost_summary: CostSummary;
  result_status: string;
  result_summary: string | null;
  result_ref: string | null;
  markdown_ref: string | null;
  artifact_refs: string[];
  artifact_refs_truncated: boolean;
  knowledge_review: {
    state: string;
    destination_ref: string | null;
    future_allowed_actions: string[];
    write_enabled: false;
  };
}

export interface KnowledgeItem {
  request_id: string;
  customer_id: string;
  user_tier: string;
  input_summary: string | null;
  result_summary: string | null;
  resolved_models: string[];
  created_at: string;
  result_ref: string | null;
  markdown_ref: string | null;
  review_state: string;
}

export interface KnowledgePage { items: KnowledgeItem[]; page: PageInfo }

export interface ModelUsageItem {
  provider: string;
  model: string;
  request_count: number;
  invocation_count: number;
  known_tokens: number;
  cost_summary: CostSummary;
  failure_count: number;
  average_latency_ms: number | null;
  latency_sample_count: number;
  last_used_at: string;
}

export interface TierUsageItem {
  user_tier: string;
  unique_users: number;
  requests: number;
  invocations: number;
  known_tokens: number;
  cost_summary: CostSummary;
  success_rate: number | null;
  pending_review: number;
}
