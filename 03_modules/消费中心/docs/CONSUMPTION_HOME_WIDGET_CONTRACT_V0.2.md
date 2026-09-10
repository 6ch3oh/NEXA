# Consumption Home Summary V0.2 (Wave004)

V0.2 is an additive, read-only projection selected with:

```js
adapter.getSummary({ contractVersion: '0.2', recentLimit: 5 })
```

The existing V0.1 response remains unchanged when `contractVersion` is omitted.

## Truth and availability

- `availability.status` is `available`, `no_data`, or `partial`.
- An empty repository is `no_data / NO_RECORDS`; totals remain `null` instead of implying an observed spend.
- A single-currency period exposes `currency`, `month_expense_cents`, and `today_expense_cents`.
- A multi-currency period is `partial / MULTI_CURRENCY`; scalar totals are `null`, while `totals_by_currency` and `category_distribution` remain separated by currency. Values from different currencies are never added together.
- `freshness` describes the latest business record date only. It is not a synchronization or source-health signal.

## Home fields

- Complete `category_distribution`: `category_id`, `category_name`, `amount_cents`, `currency`, `percentage`.
- Five to eight deterministic newest-first `recent_transactions`: date, merchant/title, category, amount, currency, direction, and platform.
- A safe static source descriptor and `generated_at`.
- Product empty state when no record exists.

The Home projection excludes canonical record IDs, source IDs, dedupe keys, raw extensions, repository paths, and exception text. It never writes or mutates the injected ExpenseRepository.
