# Hybrid Physical–Digital Proof Node: SDK boundary audit

Audit date: 7 October 2026. Baseline public package: `@kinemica/sdk@0.3.1`.
The authoritative implementation contract for the additive source types is
[WORKER_CONTRACT.md](WORKER_CONTRACT.md). This audit records inspected boundaries, not a new
deployment or evidence that the complete hybrid workflow runs in Production.

## Existing public SDK

| Surface                      | Reuse                                                                                       | Missing by design                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Kinemica.work.retrieve`     | Read one scoped work record and its server-owned state.                                     | No work creation or client-authored completion.                                 |
| `Kinemica.actions.authorize` | Record a candidate assignment policy decision.                                              | An ALLOW response does not assign, dispatch or grant a robot execution lease.   |
| `KinemicaDevice.pair`        | One-time enrollment into a preselected device/workspace; device credential only.            | No caller-supplied worker/workspace authority.                                  |
| `device.heartbeat`           | Server-owned liveness.                                                                      | Not capability/readiness proof or robot telemetry.                              |
| `device.evidence.upload`     | Bounded immutable device snapshot and opaque evidence ID.                                   | Not arbitrary task evidence, filesystem upload or cross-device delegation.      |
| `device.events.submit`       | Structured kind/timestamp/confidence/scalar metadata, with same-device evidence references. | Requires server configuration; observation acceptance does not imply execution. |

The existing transport already supplies bounded timeouts, caller cancellation, typed errors,
explicit idempotency and no automatic retries. No transport or validation behavior needs changing
to introduce a transport-neutral source contract. Existing ESM/Node.js support, zero runtime
dependencies and public v0.1/v0.2/v0.3 method signatures remain intact.

## Inspected Platform and ARM abstractions

Platform source inspected at `2adc0c3ef6a0250771d384a0ba95ddc50d3591d4`, with unrelated local
changes left untouched. Relevant source paths below are relative to `kinemica-platform`:

- `packages/domain/src/entities.ts`: Worker, Capability, WorkerCapability, ConnectedDevice,
  WorkerCommand, RobotTelemetry and audit correlation/causation. Device identity and worker
  assignment authority are deliberately separate.
- `packages/application/src/ports.ts`: the internal `WorkerAdapter` interface, including readiness,
  dispatch, status, cancellation and evidence. It is server composition, not a public HTTP API.
- `packages/domain/src/machine-execution.ts`: strict machine v1 skill, command, report, state and
  result schemas. Current skill is `transfer_part` v1 with named part/source/destination parameters.
- `packages/worker-adapters/src/durable-machine.ts`: a queued receipt is not motion, executor
  SUCCEEDED is not task completion, cancellation requests stop, and unapproved pause/resume/return
  skills are rejected.
- `apps/app/app/api/v1/devices/_lib/contracts.ts` and `service.ts`: bounded generic event syntax,
  but an existing server policy/review binding is required. Evidence-bearing events without the
  configured review route are not a generic observation-ingest path.
- `apps/app/app/api/internal/machine/handler.ts`: existing private claim/report handlers, not
  public SDK endpoints.
- `packages/domain/src/machine-run.ts` and
  `apps/app/app/api/internal/machine/run/handler.ts`: separate private DEV preparation/claim
  protocols and environment gate. These must not become public demo-specific SDK methods.
- `docs/MACHINE_EXECUTION_CONTRACT.md`, `docs/CONNECTED_DEVICES.md` and
  `docs/DEV_KIT_OPERATOR.md`: authority, replay, cancellation, evidence and private wire obligations.

The separate `kinemica-arm` repository's `contract.py` and `executor.py` were also inspected
read-only. Its commissioned implementation uses exact wire field sets, existing canonical hashes,
`SIMULATED` mode, `transfer_part` v1 and fixed configuration/part/slot allowlists. It cannot consume
arbitrary skill names, new fields or PHYSICAL mode without its own coordinated implementation.
Its journal and historical attempts must not be replaced or reset by SDK migration.

## Design findings and chosen minimum

1. Reuse device events for observations. Add no observation endpoint and no implied route from a
   sensor event to robot motion. The temperature example documents required server configuration.
2. Reuse worker/connection/configuration identity and `SIMULATED | PHYSICAL` vocabulary. Add no
   new embodiment identifier or workspace selector. Mode is commissioned, not freely switchable.
3. Add only a typed skill catalog/descriptor, invocation, report, cancellation and failure contract.
   A catalog preserves skill/version/parameter/result correlation; descriptors identify locally
   installed immutable schemas rather than adding a runtime schema system or remote code loader.
4. Preserve command/attempt/claim references, opaque specification hash, versions, deadlines,
   idempotency, timestamps and correlation. These are binding data, not proof of trusted origin.
5. Separate progress, known failure, uncertain outcome, executor success and stopped reports.
   Preserve optional factual results on BLOCKED, UNKNOWN and STOPPED; current machine v1 can produce
   important missing-part or partial observations on those paths.
6. Use opaque authorized evidence IDs, not Storage paths or unrestricted URLs. Executor assertions
   cannot become independently verified evidence or human acceptance through a type cast.
7. Define an explicitly different contract version, `kinemica.worker.v1`. Do not relabel the new
   source types as wire-compatible with the strict existing private machine v1 protocol.

No local policy, authorization, orchestration, motion execution, auto-retry, stream, filesystem
upload or credential persistence is introduced. Descriptive safety constraints are not certified
interlocks. The digital example is a pure report formatter over a supplied observation, not an
implementation of a robot or evidence generator.

## Exact integration gaps

- The public `/api/v1` surface has no worker execution transport. There is no public claim,
  invocation, report, capability enrollment or cancellation endpoint to wrap in SDK methods.
- The existing bounded machine release checks do not support sensitive/approval-gated machine
  work. Main must implement any required broader reviewed approval path; the SDK cannot bypass it.
- A device-owned image is not automatically bound evidence for a robot task. Current internal
  task-evidence binding uses authorized server/owner operations. A future physical sensor grant
  must remain narrowly scoped to the exact task/worker/attempt.
- Current private machine reports lack the new telemetry structure and generic skill catalog.
  Translation must be explicit and reject unsupported data; do not silently drop safety-relevant
  fields or recalculate a private canonical specification hash over a new message shape.
- TypeScript does not enforce provenance, runtime schemas, boundedness, freshness or exactly-once
  physical behavior. Main/adapter implementation and runtime tests are required before adoption.
- No hardware run, hosted hybrid acceptance, Production change or new npm publication is part of
  this contract-only change.

## Compatibility and release decision

The change is additive and type-only. Published `0.3.1` remains unchanged. A future reviewed minor
release can expose these types, but no release is warranted solely to imply nonexistent network
functionality. Existing users need no migration. New consumers must use the exact reviewed source
revision/build until a release actually contains the contract.

ARM must keep its existing private v1 parser/hash/journal behavior and add a reviewed boundary
mapping if it adopts these types. Main must enforce the contract and preserve server authority.
Device should continue using the current public event/evidence API. Detailed consumer responsibilities
and normative limits are in [WORKER_CONTRACT.md](WORKER_CONTRACT.md).

## Verification expectations

The repository changes require public compile-time coverage for correlated skills/results,
forbidden workspace/authority fields, distinct observation and invocation shapes, cancellation,
failure payloads and v0.1–v0.3 compatibility. Examples must compile through the package's public
exports. Package smoke checks must verify declaration exports and zero new runtime dependencies.
Normal format, lint, typecheck, unit, build and CI gates remain required before merge. This audit
does not substitute documentation for actual test or CI results; the PR records those outcomes.
