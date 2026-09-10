# Calendar Local AI Public Contract V0.1

```text
CONTRACT_VERSION: 0.1.0
AUTHORITATIVE_PUBLIC_ENTRYPOINT: src/index.mjs
FACTORY: createCalendarLocalAiAdapter
DEFAULT_PROVIDER: NONE
DEFAULT_ENDPOINT: NONE
DEFAULT_MODEL: NONE
```

`CalendarLocalAiAdapter` is a provider-neutral boundary. It never discovers or
connects to Ollama, LM Studio, an OpenAI-compatible endpoint, or any network
address. Until the user supplies a provider, `getState()` returns
`unconfigured` and `runtime_connection: human_blocked`.

## Provider port

The injected provider implements:

```js
provider.generateProposal({
  contract_version,
  request,
  context,       // date/events/tasks/timezone only
  output_schema, // calendar-ai-proposal-v0.1
}, { signal })
```

The provider returns a summary, one to twenty-five structured command
operations, optional conflict explanations, and non-sensitive provider
metadata. Unknown context fields and provider metadata are dropped. The audit
record stores a SHA-256 digest of the request, never the prompt or credentials.

## Safety lifecycle

```text
natural-language request
-> structured draft
-> diff/conflict preview
-> explicit confirmation
-> existing Calendar command boundary
-> optional explicit undo
```

- `propose()` never calls the command executor.
- `confirm()` requires `confirmed: true` for every write.
- delete and other high-risk commands additionally require
  `highRiskConfirmed: true`.
- `cancel()` permanently prevents execution of a draft.
- `undo()` only accepts a confirmed proposal and requires another explicit
  confirmation.
- timeout, cancellation, malformed output, provider failure, write
  unavailability, and undo unavailability use stable public error codes and do
  not expose provider messages, paths, URLs, tokens, or stack traces.

This contract makes the local-model UI and adapter implementable while the
runtime connection remains intentionally human-blocked.
