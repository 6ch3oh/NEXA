# NEXA Tier Model Binding Contract v0.1

Status: `FROZEN_CONTRACT / OWNER_CONTROLLED`

## Binding chain

`USER_TIER -> MODEL_PROFILE -> LITELLM_ALIAS`

The caller knows `USER_TIER` and a stable workflow capability. It does not know a
provider brand or physical model. Automation Center resolves the request using two
explicit OWNER-maintained records:

### TierModelBinding

- `user_tier`
- `workflow_capability`
- `model_profile_id`
- `enabled`

### ModelProfile

- `profile_id`
- `display_name`
- `litellm_alias`
- `enabled`
- `user_tiers`
- optional `fallback_profile`
- optional `max_cost_per_request`
- optional `daily_budget`
- optional `monthly_budget`
- optional `rate_limit`
- `notes`

## v0.1 non-production examples

Before an OWNER change:

- `BASIC + knowledge.collect -> knowledge.basic -> nexa-knowledge-basic-alias-a`
- `PRO + knowledge.collect -> knowledge.pro -> nexa-knowledge-pro-alias-b`

After an explicit OWNER change:

- `PRO + knowledge.collect -> knowledge.pro -> nexa-knowledge-pro-alias-c`

Only the `knowledge.pro.litellm_alias` value changes. The user tier, capability,
profile ID, notes, request schema, and caller business function remain unchanged.

## OWNER control and forbidden automation

Only a user/OWNER-approved configuration write may change a binding or alias.
The resolver performs a deterministic lookup; it must not inspect or act on:

- price or rate changes;
- StarBench scores;
- AI asset costs or token spend;
- external information-radar findings;
- an AI-generated recommendation.

There is no autonomous strategy, scoring, cheapest-model choice, or automatic
provider switch in this contract.

## Fallback and invalid state

Fallback is `OFF`. Every profile has `fallback_profile: null`, and the LiteLLM
non-production config has empty fallback lists. Unknown, missing, disabled, or
inconsistent bindings fail closed without reaching LiteLLM.

## Future console projection

A future Automation Center console may display all reserved tiers (`FREE`,
`BASIC`, `PRO`, `PREMIUM`, `OWNER`) for a capability and let OWNER explicitly save
a profile/alias. This contract does not implement that UI, a commercial user
database, or a subscription system.
