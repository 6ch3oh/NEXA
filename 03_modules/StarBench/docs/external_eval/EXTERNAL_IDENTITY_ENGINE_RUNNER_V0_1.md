# External Identity Engine Runner V0.1

Status: `LOCAL_MOCK_ONLY`

## Authority boundary

```text
StarBench request -> controlled Runner -> staged pinned KBF -> localhost mock
  -> KBF native artifact -> existing External Identity Engine Port
  -> StarBench Canonical Identity Observation
```

KBF remains an external engine. The Runner controls execution but does not
normalize identity evidence. The existing Port remains the only normalization
boundary and StarBench remains canonical authority. Officiality inference is
`NOT_ALLOWED`.

## Frozen execution contract

- Runner version: `0.1.0`
- Engine commit: `b789b4b7abe119e28ec6260142564b2189ff5449`
- Mode: `LOCAL_MOCK_ONLY`; `REAL_PROVIDER` is disabled
- Endpoint: plain HTTP `127.0.0.1` or `localhost`, explicit port, fixed
  `/v1/chat/completions` path
- Interpreter/entry: frozen local Python 3.13 executable and staged pinned
  `scripts/kbf_test.py`; parameterized arguments and `shell=false`
- Credential: literal synthetic `test-only-placeholder`; no environment,
  `.env`, Credential Manager, or secret-store lookup
- Workspace: validated run id below `tests/runtime/external-identity`; KBF is
  copied after immutable source hashes pass and the candidate is never written
- Result: fixed `artifacts/kbf-result.json`
- Token budget: `TBD_BY_MEASUREMENT`; mock usage is never provider cost

The child receives only an allowlisted environment needed for interpreter
resolution, UTF-8, bytecode suppression, localhost timeout, request count, and
request budget. stdout/stderr are capped and sensitive patterns are redacted.

## Budget and early stop

Request count is enforced inside the local transport shim before transport.
Runtime timeout terminates KBF. One regular result file is permitted, with
bounded per-file and total bytes. Unsafe endpoint, command/output overrides,
path traversal, source hash change, non-zero exit, missing/oversized result,
hash mismatch, and Port normalization failure all stop without a real-provider
retry.

## Mock behavior scope

The actual subprocess acceptance run proves KBF can query a localhost mock,
produce a native `UNDETERMINED` artifact, and reach
`INSUFFICIENT_EVIDENCE` through the existing Port. The environment lacks the
upstream SciPy dependency used for decisive KBF statistics. Therefore V0.1 does
not claim that the mock produced genuine `SAME` or `DIFF`; those semantic paths
remain covered by the frozen native result fixtures from Port V0.1.

No remote network, real Provider, real credential, paid token, KBF source
change, Forecast/Seal change, or estimator change belongs to Runner V0.1.
