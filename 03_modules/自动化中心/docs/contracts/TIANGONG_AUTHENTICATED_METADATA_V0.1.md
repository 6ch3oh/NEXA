# Tiangong Authenticated Metadata V0.1

Status: `IMPLEMENTED / CREDENTIAL_USER_ACTION_REQUIRED`

## Scope

This contract adds the secure read path from the frozen `CredentialRef` boundary to the Tiangong n8n Public API. It does not authorize Workflow execution, Form submission, activation, update, publish, or artifact-content reads.

## Auth surface

The live loopback instance returned HTTP 401 for `GET /api/v1/workflows/{id}` with the safe diagnostic that the `X-N8N-API-KEY` header is required. The supported mechanism is therefore an n8n Public API key passed only by `AuthenticatedLoopbackTransport`.

The credential reference is `tiangong-n8n-api-key`. A runtime-only `ExternalCredentialProviderPort` resolves it through an opaque callback and immediately passes the value to the transport consumer. There is no Secret getter, Secret DTO, environment scan, config file, fixture, report field, or persisted value.

## Transport policy

- Provider: `n8n-tiangong-primary`
- Exact origin: `http://127.0.0.1:5678`
- Exact path: `/api/v1/workflows/ymYh8t76VP3jGPbr`
- Method: GET only
- Redirects: disabled
- Query, fragment, user-info, alternate host/port/path: rejected
- Response limit: 1 MiB by default
- Error response bodies: discarded
- Successful response containing the supplied Secret: rejected

## Metadata authority

Only a successful authenticated provider response can confirm membership, production revision, active state, updated timestamp, and Form trigger surface. The canonical JSON remains a separate source:

- Canonical revision: `802897a6-0644-4927-9bad-3ecc34d8a28b`
- Canonical SHA-256: `B99305226761E7566B4C2F4266222BE1EC2EC401FAE917D068F4D19C2D753514`

A differing production revision produces `REVISION_DIVERGENCE`; neither side is modified.

## Readiness

Without the runtime credential callback, the public product state is `CREDENTIAL_USER_ACTION_REQUIRED` and run readiness is explicitly `AUTH_REQUIRED`. After successful Metadata observation with an active Workflow and confirmed Form surface, the product projection can become `TIANGONG_AUTHENTICATED_METADATA_READY` and `READY_FOR_USER_APPROVAL` while `execution_enabled=false` remains invariant.

## First pilot

The prepared first pilot uses a short, non-sensitive `source_text`, no `source_url`, no automatic retry, and no overwrite. Artifact collision stays `EXTERNAL_ARTIFACT_CHECK_REQUIRED` because this Goal does not authorize reading the external knowledge-base directory. The approval payload is generated only; it does not execute.

## Secret leak invariant

`FAKE_N8N_SECRET_VALUE_92831` is tested against repr, str, exceptions, diagnostics, result envelopes, Read API, Control API, and product projections. Any exposure is a test failure.

## One required user action

From the module root, run `python scripts\tiangong_metadata_smoke.py` in a trusted interactive terminal and paste the n8n API key at the hidden prompt. This is the only remaining credential action; the command performs one authenticated GET and emits only the sanitized projection.
