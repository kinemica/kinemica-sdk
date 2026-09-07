# Kinemica TypeScript SDK

Kinemica is a work-execution system for physical jobs performed by AI agents, people and machines. `@kinemica/sdk` provides a typed interface to Kinemica's Developer API while Kinemica retains server-side authority over permissions, policy and audit.

The `0.3.x` series targets server-side Node.js 22 or newer, including Node.js processes on Raspberry Pi and industrial/robot computers. It preserves the v0.1 and v0.2 APIs and supports bounded image evidence for connected devices. Kinemica retains authority for identity, workspace scope, permissions, deterministic policy, audit and persistence.

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

API keys are server secrets. The SDK sends the key only as `Authorization: Bearer <API_KEY>`. Use a narrowly scoped Developer API key for the project client and a device credential for `KinemicaDevice`. A device credential or privileged database secret is rejected as a project API key. Keep the configured API origin trusted: it receives the credential. Redirects are never followed. Only explicit loopback hosts permit HTTP.

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

All resource methods accept `{ signal }` as a second argument for caller cancellation; pairing accepts `signal` in its options. The default timeout is 10 seconds, covers headers and the response body, and can be configured from 1 to 300,000 milliseconds. A pre-aborted signal sends no request. Cancellation ends the caller's wait; it cannot undo a server commit. A custom `fetch` implementation must honor the supplied signal to release its own underlying resources.

## Connected devices

An OWNER first registers the device in Kinemica and gives the node its short-lived, one-time pairing code. The node exchanges that code for one device-scoped credential:

```ts
import { KinemicaDevice } from "@kinemica/sdk";

const device = await KinemicaDevice.pair(
  process.env.KINEMICA_DEVICE_PAIRING_CODE!,
);

// Persist once in the device's protected secret store; never log this value.
await saveDeviceCredential(device.credential);
```

On normal startup, restore only that device credential. Heartbeats, evidence and events require explicit idempotency keys and the SDK makes exactly one request:

```ts
import { randomUUID } from "node:crypto";
import { KinemicaDevice } from "@kinemica/sdk";

const device = new KinemicaDevice({
  credential: process.env.KINEMICA_DEVICE_CREDENTIAL!,
  // Optional: allow time for the configured server-side image review.
  timeoutMs: 30_000,
});

await device.heartbeat({
  idempotencyKey: `heartbeat:${randomUUID()}`,
});

// `snapshot` is a Uint8Array or Node.js Buffer produced by device software.
const observedAt = new Date().toISOString();
const evidence = await device.evidence.upload({
  bytes: snapshot,
  mediaType: "image/jpeg",
  observedAt,
  originalName: "loading-bay.jpg",
  idempotencyKey: `snapshot:${randomUUID()}`,
});

const event = await device.events.submit({
  kind: "PERSON_DETECTED",
  observedAt,
  confidence: 0.94,
  evidenceIds: [evidence.evidenceId],
  metadata: { zone: "loading_bay" },
  idempotencyKey: `person-detected:${randomUUID()}`,
});

console.log(event.work.status, event.work.jobId);
```

The evidence endpoint accepts valid JPEG, PNG or WebP images from 1 through 3,000,000 bytes, with dimensions no larger than 4096 × 4096. The SDK checks byte size and declared MIME type; the server validates image bytes, dimensions, observation time, ownership and persistence. The optional `originalName` is a display name carried in an HTTP header: prefer printable ASCII, with no control characters. It is never read as a filesystem or Storage path. No arbitrary evidence metadata is accepted.

Use UTC `new Date().toISOString()` timestamps. The current server accepts evidence observed within the previous 24 hours and no more than five minutes into the future. Keep the node clock synchronized. Evidence upload returns `evidenceId`, `deviceId`, `mediaType`, `sizeBytes`, `width`, `height`, `contentDigest`, `observedAt`, `uploadedAt`, `requestId` and `replayed`. Upload acceptance records evidence; it does not establish successful work completion.

An event can reference at most four evidence IDs. The server verifies that every ID belongs to the exact authenticated device and workspace. Evidence-backed events configured for review return an episode and work status; ordinary v0.2 policy events still return their `decision` unchanged. The SDK never manufactures a policy result.

An OWNER must configure the relevant event workflow in Kinemica before use. A valid credential with an unconfigured event receives `KinemicaConflictError` with `code: "device_event_unconfigured"`; pairing alone does not configure policy or review work. `AWAITING_HUMAN_DECISION` means review work was created, `EXISTING_EPISODE` identifies bounded duplicate detection, and `QUEUED` means the server accepted work for processing. `jobId` can be `null`; none of these states is an instruction to operate hardware. Replayed events identify the original accepted event but review status/job metadata need not be identical to the first response; use the returned server values.

Event `kind` is an uppercase identifier of 3–64 characters. Optional `confidence` is 0–1. Event metadata contains at most 24 lowercase-keyed scalar values (string up to 256 characters, finite number, boolean or null), within the SDK's 4,096-byte bound. Never put credentials or sensitive personal data in metadata.

The server derives the device and workspace from the device credential. Callers cannot select a workspace, task, worker, policy rule or decision. `ALLOW`, `BLOCK` and `REQUIRE_APPROVAL` are Kinemica’s recorded domain decisions; submitting evidence or an event does not dispatch or control hardware.

Exact replays of heartbeat, evidence or event idempotency keys return `replayed: true`; reusing a key with changed content returns `KinemicaConflictError`. Because a network failure can hide whether the server committed a request, the SDK never retries automatically. The caller may deliberately retry the exact same request with the same idempotency key.

Pairing codes and device credentials are secrets. Pairing codes expire after ten minutes and are single-use. Device credentials can be revoked by a workspace OWNER. Never put a Supabase key, service-role credential, user session, or project Developer API key on a device.

Pair once, save the credential explicitly in a protected secret store, then construct the client from that saved credential on restart. The SDK does not write files, update environment variables or store credentials automatically. `device.credential` is an explicit secret accessor; never log it or serialize it yourself. A paired client exposes `deviceId`, `name`, `credentialExpiresAt` and `pairingRequestId`; these fields are `undefined` on a client restored from just a credential. The server still determines identity in every request. After expiration or revocation, stop submitting and have the OWNER issue a fresh pairing code. If pairing times out after the code was consumed and no credential was received, obtain a new pairing code; the SDK cannot recover the lost credential.

## Idempotency and uncertain delivery

Allocate one key per logical operation, using 8–96 characters from `A-Z a-z 0-9 . _ : -` and starting with a letter or digit. Use different keys for upload and event submission. Keep the same payload, bytes, timestamp, name, metadata and key for a deliberate replay of that operation. Generate new keys only for genuinely new observations. In particular, do not call `new Date()` or `randomUUID()` inside a retry loop for the same observation. A new heartbeat should receive a new key; replaying an old heartbeat is not a new liveness observation.

There are no automatic retries, timers for heartbeat scheduling, queues, offline sync or retry helpers. An expired credential, rejected evidence, or scope error requires correction. A conflict must be investigated before creating another logical operation. For a network error, timeout, 429 or 5xx response, delivery may be uncertain: preserve the operation and let your application deliberately decide when to replay it. Server idempotency prevents duplicates within its contract; it does not make pairing recoverable or authorize any physical action.

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

```ts
import {
  KinemicaError,
  KinemicaAuthenticationError,
  KinemicaConflictError,
  KinemicaConnectionError,
  KinemicaRateLimitError,
} from "@kinemica/sdk";

try {
  await device.heartbeat({ idempotencyKey: `heartbeat:${randomUUID()}` });
} catch (error) {
  if (error instanceof KinemicaAuthenticationError) {
    // Stop submissions; arrange a new pairing through the workspace OWNER.
  } else if (error instanceof KinemicaConflictError) {
    // Inspect code: unconfigured workflow vs. conflicting idempotency payload.
  } else if (
    error instanceof KinemicaConnectionError ||
    error instanceof KinemicaRateLimitError
  ) {
    // Preserve pending operation state; your application decides whether to replay.
  }
  if (error instanceof KinemicaError) {
    console.error({
      name: error.name,
      status: error.status,
      code: error.code,
      requestId: error.requestId,
    });
  }
  throw error;
}
```

Local validation errors have no HTTP status. Both `KinemicaTimeoutError` and `KinemicaRequestAbortedError` extend `KinemicaConnectionError`. A broken response stream is a connection error; invalid JSON or an incompatible successful schema is `KinemicaApiError`. Non-JSON HTTP failures still map by status: 401 authentication, 403 forbidden, 404 not found, 409 conflict, 429 rate limited, 503 service unavailable; 500/502 use `KinemicaApiError`. Unknown error schemas use a generic safe error with the HTTP status and a valid request ID when available. Validation details are capped at 16 entries. Do not log request options, custom transport traces or credential-store contents.

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
bounded evidence / review work / policy decision / audit
```

The SDK does not read a camera, include OpenCV or Picamera, stream video, control a robot, or implement policy. Raspberry Pi software can submit a bounded observation after its own camera software detects one. See the [Raspberry Pi conceptual example](https://github.com/kinemica/kinemica-sdk/blob/main/examples/raspberry-pi-concept.ts), [evidence operation example](https://github.com/kinemica/kinemica-sdk/blob/main/examples/evidence.ts) and [project client example](https://github.com/kinemica/kinemica-sdk/blob/main/examples/basic.ts).

For a browser camera demo, browser JavaScript sends a bounded snapshot to **your application's authenticated server endpoint**. That server checks the user/session, CSRF/origin protection, authorization for the configured device, and upload limits before invoking this SDK with a server-held device credential. The browser must never receive the device credential or choose the server's credential, workspace, Storage path or evidence owner. Keep camera capture in the application's browser code and SDK calls in a Node.js server process. A Node.js process physically running on an edge device is supported; browser bundles and non-Node edge runtimes are not tested targets.

## Types and version compatibility

The package is ESM-only: use `import`, or dynamic `import()` from CommonJS. There is no `require()` export. Node.js 22 and 24 are tested, with strict TypeScript 5.9 using NodeNext and Bundler resolution. Public types are exported from `@kinemica/sdk`; deep imports are intentionally blocked. Public source files are included solely to make source/declaration maps useful.

Without evidence IDs, `events.submit()` retains its v0.2 `DeviceEventResult` return type. A non-empty literal/readonly tuple of IDs infers `DeviceReviewEventResult`. A variable typed as `SubmitDeviceEventParams` or `readonly string[]` returns the union `DeviceEventSubmissionResult`; narrow it with `"work" in event` or `"decision" in event`. Unknown additional server fields are ignored. Unknown policy outcomes, states or incompatible required fields fail closed as API errors; the SDK never maps an unknown outcome to ALLOW or treats missing completion fields as success.

Patch releases repair compatible behavior and security; minor releases may add capabilities. Public signatures from v0.1–v0.3 remain supported. An intentional security tightening rejects misplaced device/privileged credentials, non-string identifiers and invalid HTTP-header characters before transport. Review the [changelog](https://github.com/kinemica/kinemica-sdk/blob/main/CHANGELOG.md), pin an exact version for a deployed node, and test upgrades against your configured workflows.

## Current limitations

- The project client remains limited to `work.retrieve()` and assignment-focused `actions.authorize()`.
- The device client is limited to one-time pairing, heartbeat, bounded image evidence and bounded event submission.
- There is no work creation, generic file upload, dispatch, approval recording, robot control, browser client, CLI, webhook or retry framework.
- No public physical-mutation API exists yet; authorization evaluates and records policy but does not assign or dispatch.
- Kinemica remains a prototype and is not approved for live safety-critical work.

## Development

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:package
pnpm pack
```

Live Production verification is a separate secure release gate using disposable synthetic data and temporary credentials; no live key belongs in CI or this repository.

## License

Apache-2.0.
