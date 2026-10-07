# Hybrid worker contract v1

Status: **unreleased, transport-neutral TypeScript contracts**. The current npm release is
`@kinemica/sdk@0.3.1`; it does not contain these types. This source addition is eligible for a
future minor release. It adds no HTTP endpoint, executor, polling loop, validator, credential
store, policy engine or controller. Production behavior is unchanged.

Use the exported types from `@kinemica/sdk` when working from a build of this source revision.
Do not use a deep import. `contractVersion: "kinemica.worker.v1"` identifies this contract, not
an existing machine wire protocol or a statement that a public execution API is deployed.

## Two separate boundaries

Sensor software reports an observation through the existing `KinemicaDevice` API. Platform
interprets and routes that observation, applies policy, and obtains any required human approval.
Only a separately authenticated execution transport may deliver a worker invocation afterward.
An observation, a capability description, a schema-valid message or a policy-decision reference
alone is never permission to execute.

The existing public methods remain unchanged:

- Project: `work.retrieve()` and assignment-focused `actions.authorize()`.
- Device: `KinemicaDevice.pair()`, `heartbeat()`, `evidence.upload()` and `events.submit()`.

There is no public worker registration, skill publication, execution claim, invocation, report,
cancellation or telemetry endpoint in this SDK. Do not construct undocumented URLs from these
type names. An SDK `AbortSignal` cancels an HTTP wait; it does not cancel physical work.

## Types and ownership

| Type                             | Purpose                                                                                                                            | Authority boundary                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WorkerSkillCatalog`             | Maps each skill name to its literal version and parameter/result types.                                                            | Compile-time correlation, not a registry or capability grant.                                               |
| `WorkerExecutionBinding`         | `workerId`, `connectionId`, `mode`, `configurationVersion`.                                                                        | Platform commissions this immutable binding; callers do not select a workspace or switch mode.              |
| `WorkerSchemaReference`          | Immutable schema `id` and `version`.                                                                                               | Main and the adapter install the matching runtime schemas locally. No fetching or executing a supplied URL. |
| `WorkerSkillDescriptor<Catalog>` | Skill/version, parameter/result schema references, required capabilities, descriptive safety constraints and cancellation support. | Describes implementation support, not permission, certified safety or a worker capability grant.            |
| `WorkerSkillInvocation<Catalog>` | A claimed, fenced invocation with exact typed parameters.                                                                          | Accepted only from the authenticated Platform transport after routing and authorization.                    |
| `WorkerExecutionReport<Catalog>` | One factual report for the same skill and immutable invocation.                                                                    | Worker assertion; Platform validates, records and determines subsequent state.                              |
| `WorkerCancellationRequest`      | A bound request to stop one claimed attempt.                                                                                       | Request only; it is not confirmation that a worker or physical mechanism stopped.                           |
| `WorkerExecutionFailure`         | Bounded execution failure category and safe explanation.                                                                           | Not an HTTP error, policy result or automatic retry instruction.                                            |

`SIMULATED` and `PHYSICAL` share the message structure but require separately commissioned
connections and implementations. A future physical arm or mobile robot can implement an agreed
skill without exposing joints, coordinates, drivers or a specific computer model. An existing
simulator does not become a physical controller by changing a string.

Schema references are immutable agreements, not JSON Schema documents or runtime validators.
Changing the parameter/result schema requires a new skill version and coordinated validation on
both sides. Unsupported versions fail closed. Runtime validation remains necessary even when both
programs compile against the same TypeScript types. Descriptive `safetyConstraints` cannot alter
server policy, grant capabilities, replace controller interlocks or certify safe operation.

Give each catalog entry one literal skill version. Use separate catalogs for different versions
of the same skill; a union of versions and unrelated parameter/result types in a single entry
would lose their compile-time correlation. Schemas must still match that version at runtime.

## Invocation and report correspondence

An invocation includes:

- `contractVersion: "kinemica.worker.v1"`;
- `workId`, `taskId` and the commissioned `binding`;
- `commandId`, `attemptId`, `claimId`, `specificationHash` and `correlationId`;
- `specification: { skill, skillVersion, parameters }`;
- `authorizationId`, an audit reference, never a bearer credential or caller-authored ALLOW;
- current `version`, `issuedAt`, `expiresAt`, `reportDueAt` and `idempotencyKey`.

A report echoes command/attempt/claim, specification hash and correlation, plus the exact skill
and skill version. It supplies `expectedVersion`, `observedAt`, a stable `idempotencyKey`, a safe
`summary`, and an `evidenceIds` array. Platform must resolve these references to the authenticated
connection's immutable invocation and match its binding, specification and result schema. A
matching TypeScript shape or guessed identifier does not establish that correspondence.

The specification hash is opaque and server-assigned. Echo it exactly; do not recalculate it over
this transport-neutral representation or over a translated private command. Correlation IDs are
diagnostic links, not authorization. Version checks and claim fencing belong to the authenticated
transport and server, not to SDK-local state.

| Report event  | Payload                                                       | Meaning                                                                    |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ACKNOWLEDGE` | No result, failure or telemetry.                              | The worker acknowledges this invocation, not completion.                   |
| `STARTED`     | No result, failure or telemetry.                              | The worker reports starting this attempt.                                  |
| `PROGRESS`    | Required bounded scalar `telemetry`; no result or failure.    | A snapshot, not an unbounded stream or command channel.                    |
| `SUCCEEDED`   | Required skill-typed `result`; no failure.                    | Executor-reported success only.                                            |
| `BLOCKED`     | Required `failure`; optional skill-typed factual `result`.    | Known execution obstacle/failure; not a policy `BLOCK` decision.           |
| `UNKNOWN`     | `failure.code: "OUTCOME_UNKNOWN"`; optional factual `result`. | The outcome is uncertain; no new motion or automatic takeover is implied.  |
| `STOPPED`     | Optional factual `result` and `cancellationId`; no failure.   | The executor reports stopping; not a safety-rated stop or task completion. |

Results on blocked, unknown or stopped reports preserve partial observations and evidence; their
presence does not turn the report into success. No report carries an authoritative task-complete,
human-accepted, evidence-verified or job-closed field. Those remain Platform decisions. Platform's
queued, claimed, running, stop-requested and accepted read states are not a client-owned transition
engine. This contract intentionally supplies no function that advances them locally.

Failure codes are `INVALID_PARAMETERS`, `UNSUPPORTED_SKILL`, `CONFIGURATION_MISMATCH`, `NOT_READY`,
`SAFETY_STOP`, `EXECUTION_FAILED`, `DEADLINE_EXCEEDED` and `OUTCOME_UNKNOWN`. The last code is reserved
for `UNKNOWN`; the others describe `BLOCKED`. A deadline or transport failure after possible motion
must not be mislabeled as a known safe failure. Report an unknown outcome when appropriate and
reconcile it through Platform. `SAFETY_STOP` is a report category, not a certification claim.

## Cancellation, replay and uncertainty

Cancellation requests echo the immutable execution reference and include `cancellationId`,
`issuedAt`, `idempotencyKey` and `reason`. They target exactly one command/attempt/claim. A worker
with `COOPERATIVE` cancellation acts through its own reviewed controller and reports `STOPPED`
only once it has actually stopped; it can echo the cancellation ID. `UNSUPPORTED` must not be
converted into an optimistic stopped report. Local emergency stops and safety interlocks remain
outside the SDK and cannot depend on cloud availability.

Use one stable idempotency key per logical invocation, report or cancellation operation, and reuse
the exact body for a deliberate replay. A replay receipt is not permission to execute motion again.
Expired authority, a lost response, a stale version, a lost journal or an uncertain physical outcome
requires reconciliation, not a new key, automatic retry, automatic reassignment or lease takeover.
The adapter owns durable execution fencing and any journal; the SDK stores nothing automatically.
No cancellation acknowledgement, successful transport receipt or executor result closes a task.

## Runtime validation and normative bounds

These bounds apply **only to new `kinemica.worker.v1` messages**. They do not extend or change the
existing Developer API or device endpoint limits. TypeScript does not enforce them. A transport
must enforce the agreed runtime schemas, authorization, correspondence and all bounds before
adoption; an adapter must independently reject unsupported or mismatched inputs before execution.

| Field or structure                                                     | Required bound                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Complete message                                                       | At most 64 KiB of UTF-8 JSON.                                                                                                     |
| Each parameters/result object                                          | At most 16 KiB of UTF-8 JSON; maximum nesting depth 8, arrays 64 items, objects 32 properties.                                    |
| General text strings                                                   | At most 1,024 characters; no credentials or raw provider errors. Treat contents as untrusted data, never executable instructions. |
| `summary`, `message`, `reason`, `description`                          | Non-empty, at most 500 characters.                                                                                                |
| Skill, skill/configuration/schema version and schema ID                | 1–64 ASCII characters; alphanumeric first, then alphanumeric, `_`, `.` or `-`.                                                    |
| Opaque entity references, including correlation/cancellation/claim IDs | 1–160 ASCII characters; alphanumeric first, then alphanumeric, `_`, `.`, `:` or `-`.                                              |
| Idempotency key                                                        | 8–160 ASCII characters drawn from alphanumeric, `/`, `.`, `_`, `:` or `-`.                                                        |
| Specification digest                                                   | Exactly 64 lowercase hexadecimal characters.                                                                                      |
| Numeric data                                                           | Finite numbers only; version counters must be nonnegative safe integers.                                                          |
| Telemetry                                                              | At most 24 scalar fields and 4,096 UTF-8 JSON bytes; values are string, finite number, boolean or null.                           |
| Evidence                                                               | At most 100 existing, authorized evidence IDs; no URL, filesystem or Storage path.                                                |
| Descriptor constraints/capabilities                                    | At most 16 safety-constraint strings of at most 500 characters each; at most 32 capability references.                            |
| Timestamps                                                             | Real UTC ISO 8601 dates ending in `Z`; `expiresAt` must be later than `issuedAt`.                                                 |

For nested payload bounds, count the root parameters/result object as depth 1 and include each
nested object or array as another level. Text limits count Unicode code points. JSON byte limits
are separate from text limits: enforce the complete received-message limit before decoding and
the nested object limits on compact UTF-8 JSON. Runtime decoders must reject duplicate object keys,
non-JSON values, non-finite numbers and unsupported fields for the agreed version.

Platform checks issue/expiry/report deadlines against its current clock and immutable attempt.
Adapters check freshness against the reviewed transport contract before beginning work. Clock
skew, an expired deadline or a missing fresh acknowledgement does not authorize retries. A
transport needs explicit deadline/lease rules; this source contract does not silently invent them.
Evidence references must already be authorized for this exact execution. A device-owned image ID
does not by itself grant task/worker evidence authority.

## Exact handoff for Main, ARM and Device

**Device:** retain the current device-scoped SDK client and `events.submit()`. Report an immutable
physical observation, not a requested worker, skill, workspace or policy outcome. Use the existing
evidence upload for bounded snapshots. Main must configure an event binding before a kind can be
accepted; generic kind syntax is not a promise that arbitrary observations are automatically
routed. Without configuration the current API returns `device_event_unconfigured`.

**ARM:** use the shared skill descriptor and invocation/report types for a typed boundary around
an implementation. The digital twin supplies actual observed results; the SDK does not drive it.
Keep controller code, local checks, journaling, recordings and hardware details outside the SDK.
Preserve mode/configuration/fencing and reject unsupported skills. Existing strict machine wire v1
needs an explicit reviewed mapping; these new messages must not be posted directly to it. Do not
discard blocked/unknown observations, turn an assertion into verification, or replay motion.

**Main:** owns authenticated worker identity, immutable commission/binding, capability grants,
schema installation, event configuration, AI/human routing, policy and approvals. It also owns
execution delivery, fencing, current-state/version/deadline checks, idempotent receipts, scoped
evidence binding, audit, independent evidence verification, human acceptance and job closeout.
Publish and verify the public execution transport before adding corresponding SDK network methods.

Current integration gates are explicit: there is no deployed public execution transport; the
existing bounded machine foundation does not release sensitive/approval-gated machine work; and
device snapshot ownership is not a general sensor-to-task/robot evidence-binding grant. Those
require reviewed Platform work. No SDK type or example claims these gates have passed.

## Examples and compatibility

- [Physical sensor](https://github.com/kinemica/kinemica-sdk/blob/main/examples/physical-sensor.ts):
  `reportTemperature` submits a supplied measurement through the existing event API with a stable
  sample key. It includes no sensor driver or execution call. Configure the event in Platform first.
- [Digital robot](https://github.com/kinemica/kinemica-sdk/blob/main/examples/digital-robot.ts):
  a pure formatter turns an externally supplied twin observation into a typed report. It is not a
  robot controller, a transport, or proof that motion occurred.

All existing v0.1–v0.3 public client methods and return types remain unchanged. Existing device
credentials remain device-scoped; these types add no credential or workspace-selection API.
Existing private executors must retain their strict wire versions, field sets, hashes, journal
rules and commissioned limits until their own coordinated migration is reviewed. There is no
automatic migration and no claim of physical-hardware readiness or safety certification.
