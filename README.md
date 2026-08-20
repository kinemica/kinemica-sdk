# Kinemica TypeScript SDK

Kinemica is a work-execution system for physical jobs performed by AI agents, people and machines. `@kinemica/sdk` provides a typed interface to Kinemica's Developer API while Kinemica retains server-side authority over permissions, policy and audit.

Version `0.1.0` targets server-side Node.js and exposes the two operations in the live Production Developer API. Kinemica remains the server-side authority for identity, workspace scope, permissions, deterministic policy, audit and persistence.

## Installation

```sh
pnpm add @kinemica/sdk
```

Or with npm:

```sh
npm install @kinemica/sdk
```

## Client

```ts
import { Kinemica } from "@kinemica/sdk";

const kinemica = new Kinemica({
  apiKey: process.env.KINEMICA_API_KEY!,
  timeoutMs: 10_000,
});

const work = await kinemica.work.retrieve("job_123");

const decision = await kinemica.actions.authorize({
  workId: work.id,
  taskId: "task_456",
  workerId: "worker_789",
  action: "assign_worker",
  idempotencyKey: "assignment-check-001",
});
```

The SDK uses `https://app.kinemica.com/api/v1` by default. Supply `baseUrl` only to target an authorised Preview, local or test environment. Non-local HTTP URLs are rejected.

API keys are server secrets. The SDK sends the key only as `Authorization: Bearer <API_KEY>`. It does not create, list or revoke keys and never places credentials in URLs or error messages. Version 0.1 is for server-side Node.js use and does not support browser clients.

## Retrieve work

```ts
const work = await kinemica.work.retrieve("job_123");

console.log(work.status, work.tasks, work.unresolvedExceptions);
```

`work.retrieve()` returns Kinemica's bounded public work model. It does not expose database rows, private policy facts, tenant columns, audit hashes or infrastructure identifiers.

## Authorize a candidate assignment

```ts
const decision = await kinemica.actions.authorize({
  workId: work.id,
  taskId: "task_456",
  workerId: "worker_789",
  action: "assign_worker",
  idempotencyKey: "assignment-check-001",
});

switch (decision.outcome) {
  case "ALLOW":
    console.log("Assignment permitted");
    break;
  case "BLOCK":
    console.log("Assignment blocked", decision.reason, decision.remediation);
    break;
  case "REQUIRE_APPROVAL":
    console.log("Supervisor approval required", decision.reason);
    break;
}
```

`ALLOW`, `BLOCK` and `REQUIRE_APPROVAL` are successful deterministic domain decisions. `actions.authorize()` does not assign or dispatch a worker. `decision.replayed` identifies an exact durable replay, and `decision.requestId` supports correlation.

An `Idempotency-Key` is required for every authorization. Reusing it with the exact payload returns the original decision with `replayed: true`; reusing it with a changed payload throws `KinemicaConflictError`. The SDK makes one request and does not retry automatically.

Both methods accept `{ signal }` as a second argument for caller cancellation. The default timeout is 10 seconds and can be configured from 1 to 300,000 milliseconds.

## Errors

API failures use a small hierarchy rooted at `KinemicaError`:

- `KinemicaAuthenticationError`
- `KinemicaValidationError`
- `KinemicaForbiddenError`
- `KinemicaNotFoundError`
- `KinemicaConflictError`
- `KinemicaRateLimitError`
- `KinemicaServiceUnavailableError`
- `KinemicaApiError`
- `KinemicaConnectionError`, `KinemicaTimeoutError` and `KinemicaRequestAbortedError`

Where available, API errors expose safe `status`, `code`, `requestId` and bounded validation `details`. They do not expose raw response bodies or database/provider internals.

## Raspberry Pi and camera software

```text
USB/Pi camera
    ↓
camera software detects an event
    ↓
@kinemica/sdk
    ↓
Kinemica Developer API
    ↓
bounded work / policy decision / audit
```

The SDK does not read a camera, include OpenCV or Picamera, control a robot, or implement policy. Raspberry Pi software can retrieve relevant Kinemica work and request authorization for a candidate assignment. See [`examples/raspberry-pi-concept.ts`](examples/raspberry-pi-concept.ts).

## Current limitations

- Only `work.retrieve()` and assignment-focused `actions.authorize()` exist.
- There is no work creation, evidence submission, dispatch, approval recording, robot control, browser client, CLI, webhook or retry framework.
- No public physical-mutation API exists yet; authorization evaluates and records policy but does not assign or dispatch.
- Kinemica remains a prototype and is not approved for live safety-critical work.

## Development

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

Live Production verification is a separate secure release gate using disposable synthetic data and temporary credentials; no live key belongs in CI or this repository.

## License

Apache-2.0.
