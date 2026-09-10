# NEXA Model Error Taxonomy v0.1

Status: `FROZEN_CONTRACT / MODULE-LOCAL OFFLINE VALIDATED`

## Rule

Only the Automation Center adapter may inspect LiteLLM/provider exception details.
All upper layers consume `ModelErrorCategory`, the stable NEXA code, retryability,
a fixed safe message, optional HTTP status, and optional safe provider error ID.
They must not branch on a LiteLLM Python exception class name.

## Categories

| Category | Default retryable | Meaning |
| --- | ---: | --- |
| `INVALID_REQUEST` | false | Malformed or semantically invalid request. |
| `AUTHENTICATION_FAILED` | false | Provider credential authentication failed. |
| `PERMISSION_DENIED` | false | Authenticated identity lacks permission. |
| `RATE_LIMITED` | true | Provider rate or capacity limit. |
| `TIMEOUT` | true | Provider call timed out. |
| `PROVIDER_UNAVAILABLE` | true | Provider returned an unavailable/5xx condition. |
| `MODEL_UNAVAILABLE` | false | Requested physical model was not found/available. |
| `CONTENT_POLICY_BLOCKED` | false | Provider content policy blocked the request. |
| `CONTEXT_LIMIT_EXCEEDED` | false | Request exceeded model context capacity. |
| `NETWORK_ERROR` | true | Network connection prevented the request. |
| `INTERNAL_GATEWAY_ERROR` | false | NEXA adapter failed internally. |
| `UNKNOWN_PROVIDER_ERROR` | false | No safe known mapping exists. |

`retryable` is normalized advice only. This contract does not authorize or
implement automatic retry. A future policy must separately control attempts,
budgets, idempotency, and user-visible behavior.

## Mapping boundary

The adapter classifies the most specific semantic condition first, then stable
HTTP status where available. Examples include 429→`RATE_LIMITED`, 401→
`AUTHENTICATION_FAILED`, 403→`PERMISSION_DENIED`, 404→`MODEL_UNAVAILABLE`, and
provider 5xx→`PROVIDER_UNAVAILABLE`. Context/content conditions take precedence
over their generic 400 base class.

The implementation may adapt its internal LiteLLM mapping during a dependency
upgrade without changing the NEXA enum or downstream consumer logic.

## Safe projection

Every category maps to a fixed bounded `safe_message`. Raw `str(exception)`,
traceback, response body, headers, request body, and debug fields are never copied
into `ModelInvocationRecord`. Only allow-listed provider correlation headers may
be projected as `provider_error_id`; invalid values become `null`.

Secret-like content causes record validation failure. The offline acceptance
matrix includes a fake secret in an exception and proves it is absent from the
record and machine-readable evidence.
