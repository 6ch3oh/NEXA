export function buildCopyableSummary({ brief, forecast, allocation, resources }) {
  const lines = [
    `项目：${brief.project_name}`,
    '',
    '预计 Token：',
    `乐观 ${forecast.optimistic_path.total_tokens}`,
    `预计 ${forecast.expected_path.total_tokens}`,
    `保守 ${forecast.conservative_path.total_tokens}`,
    '',
    '模型与角色建议（仅建议）：',
    ...allocation.allocations.map((item)=>`${item.execution_role} / ${item.recommended_model_class}：${item.estimated_calls} calls，${item.estimated_tokens} tokens`),
    '',
    `API Token 资源：${resources.api_token_billed.total_tokens} tokens / ${resources.api_token_billed.calls} calls`,
    `订阅资源占用：${resources.subscription_quota.total_tokens} tokens / ${resources.subscription_quota.calls} calls / ${resources.subscription_quota.task_count} tasks`,
    '',
    '主要风险：',
    ...(forecast.conservative_path.risk_drivers.length?forecast.conservative_path.risk_drivers:['未识别额外风险分支']),
    '',
    `预测依据：项目语义工作图；历史数据状态 ${forecast.historical_data_status}`,
    `当前预测置信度：${forecast.forecast_confidence}`,
    '价格/额度：需由 03-01 PricingSnapshot / EntitlementSnapshot 提供；本摘要不执行任务、不切换模型、不消费额度。',
  ];
  return lines.join('\n');
}
