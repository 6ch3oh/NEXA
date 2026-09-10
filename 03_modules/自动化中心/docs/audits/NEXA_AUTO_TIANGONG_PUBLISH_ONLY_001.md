# NEXA-AUTO-TIANGONG-PUBLISH-ONLY-001

## Status

`STOPPED / API_SEMANTIC_CONFLICT / PUBLISH_IS_ACTIVATE`

The user authorized Publish only and explicitly prohibited Activate and Workflow execution. The latest disk Evidence identifies Workflow `ymYh8t76VP3jGPbr`, installed revision `cc645caf-2d26-4750-979d-4f924e01b7cf`, and approved Candidate SHA-256 `002C8F5520B803FECE8387B3D2BC60E7055D9505B4A40131F87D76EACBC02FC9`.

## Local provider preflight

The live local Public API OpenAPI was read without authentication from `http://127.0.0.1:5678/api/v1/docs/swagger-ui-init.js`. It exposes no independent Workflow publish path. The sole operation whose summary is `Publish a workflow` is:

- method: `POST`
- path: `/workflows/{id}/activate`
- operationId: `activateWorkflow`
- required scope: `workflow:activate`
- optional request body: `versionId`, `name`, `description`
- provider description: `Publish a workflow. In n8n v1, this action was termed activating a workflow.`

The minimum revision-bound body would be `{"versionId":"cc645caf-2d26-4750-979d-4f924e01b7cf"}`. It was not sent.

## Decision

This provider combines Publish and Activate into one operation. Calling it under a contract that authorizes Publish but prohibits Activate and requires `ACTIVATE = 0` would exceed authorization and make the acceptance criteria internally impossible. No API key was requested, no authenticated preflight was started, and no controller was created or executed.

The task must remain stopped until the controller explicitly resolves the provider-specific combined semantics. Either the combined n8n Publish/Activate operation must be authorized with its actual state implications, or Activate remains prohibited and Publish cannot be performed on this instance.

## Side effects

- Publish: `0`
- Activate: `0`
- Workflow execution: `0`
- Production definition write: `0`
- Credential persisted: `0`
- Secret exposed: `0`
- Rollback ready: `true`

Machine-readable Evidence: `fixtures/tiangong_run_prep/publish_only_preflight.blocked.json`.

`Definition Update != Publish != Activate != Execute` remains the control-plane contract, but the provider's actual Publish operation is named and implemented as `activateWorkflow`; that conflict requires explicit controller resolution before any production call.
