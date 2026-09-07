# Public SDK readiness audit — 7 September 2026

## Assessment and release decision

The SDK remains a small Node.js typed client, not an authority or execution engine. Its project and device surfaces are coherent and cover the currently released API. The audit identified reproducible transport and diagnostic defects worth a **0.3.1 patch**, not an additive 0.4.0 release. No method, argument, exported domain type, server endpoint or policy capability was added.

## Findings and remediation

| Area                   | Finding in 0.3.0                                                                                                              | Patch behavior                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancellation           | Abort/timeout during the body read became a malformed-JSON error; a pre-aborted signal still reached custom fetch.            | Preserve typed cancellation through body reads and send nothing for pre-aborted calls.                                                                         |
| Custom transport       | A fetch implementation ignoring its signal could keep the caller waiting indefinitely.                                        | Bound the SDK wait; document that custom transports must release their own resources.                                                                          |
| Credential diagnostics | Reflected credentials could remain in error details/request IDs, or escape through a custom transport's SDK-shaped exception. | Sanitize messages/details/results, reject unsafe request IDs, and discard raw transport exceptions. The explicit paired-credential accessor remains available. |
| Response failures      | Invalid success schemas lost status/request ID; non-JSON failures lost status-specific error classes.                         | Preserve safe metadata and map HTTP status even when an error body is not JSON.                                                                                |
| Input boundary         | Identifier coercion accepted undefined; misplaced credential classes and invalid HTTP filenames were not rejected early.      | Validate actual types, credential separation and representable filenames before sending.                                                                       |
| Evidence/events        | Mutable binary views and incompatible/ambiguous event result variants were insufficiently guarded.                            | Copy the bounded upload view and validate the response variant against the submitted operation.                                                                |
| Package                | Source/declaration maps referenced absent files.                                                                              | Ship only public SDK sources alongside generated artifacts and validate all map targets.                                                                       |
| Release pipeline       | Registry propagation checks used an ineffective cache flag; release-ref validation was incomplete.                            | Use isolated install caches, require the exact version tag on main ancestry, and verify the packed artifact before trusted publication.                        |
| Developer guidance     | Pairing recovery, explicit replay, server/browser boundaries and version support needed detail.                               | Add focused examples and lifecycle/security/error documentation without adding runtime helpers.                                                                |

The credential findings concern defense against reflected or malformed diagnostics; the audit did not observe leaked credentials in normal Production responses. Private vulnerability reporting is enabled for the repository.

## Verification

- The original public API tests remain, with regressions for malformed JSON/schemas, typed HTTP errors, reflected secrets, response metadata, aborts, timeout cleanup, input validation, evidence ownership failures, idempotency and overload behavior.
- Real loopback HTTP tests cover redirect refusal, incomplete bodies, caller cancellation, deadlines and a sliced Node Buffer upload.
- On the unchanged 0.3.0 baseline, 17 of the initial 19 transport regression cases fail. The remaining two already passed; this comparison distinguishes fixes from additional coverage.
- Strict public-consumer type tests exercise v0.1/v0.2/v0.3 calls, inference and rejected authority/filesystem arguments with both NodeNext and Bundler resolution, without source aliases or skipped declaration checking in the clean consumer.
- Package inspection checks the allowlist, ESM import/export boundary, repository metadata, zero runtime dependencies, source maps and absence of test/internal/secret files. CI covers Node 22/24 and Linux/macOS/Windows package consumers.
- The installed 0.3.1 tarball passed 38 bounded Production SDK calls: work retrieval, all three server policy outcomes, exact replay/conflict, insufficient scope, opaque cross-workspace lookup, 429, pairing/reused code, heartbeat, legacy device decisions, evidence upload/replay, malformed image, evidence-backed review work, event replay/conflict, cross-device/workspace evidence rejection and revoked credentials. Exactly one HTTP attempt occurred per call, with no 5xx response. Durable project decisions/audit records were checked independently.
- All synthetic scopes, evidence objects and users were removed and all test credentials revoked. An initial harness run used IDs outside the fixture-cleanup helper's accepted pattern; those exact test scopes were separately removed and absence verified before the corrected run.

## Compatibility and authority

All existing public methods and successful valid response shapes remain. Unknown additive response fields are discarded. Unknown policy outcomes or incompatible required fields fail closed; the SDK never substitutes a decision or a completed-work state. Invalid inputs and malformed server/custom-fetch responses may now fail earlier or carry a more accurate existing error class.

Device credentials remain separate from Developer API keys. Workspace, device ownership, policy, evidence paths, audit and review work remain server-owned. The SDK does not persist secrets, log requests, schedule heartbeats, stream video, control hardware, or retry automatically. Browser examples put SDK calls behind the application's authenticated Node.js server and never put a device credential in browser JavaScript.

## Remaining limits

- This is not a real-hardware endurance, camera-driver or robot-control test. Browser bundles, non-Node edge runtimes and CommonJS `require` are not supported targets. Node 22/24 and TypeScript 5.9 are explicitly verified.
- A timeout/abort cannot roll back a committed server operation. Lost pairing responses require operator-issued re-pairing; applications own protected credential storage and deliberate replay of an unchanged operation.
- Custom fetch and a configured API origin are trusted application components. Redaction is defense in depth, not a sandbox for malicious application code or arbitrary confidential business text.
- Success/error bodies are read into memory; the platform's bounded response contract remains important. The SDK does not add an undocumented response-size limit that could reject previously valid work responses.
- A useful future capability is device identity/status retrieval, **only after the platform exposes an appropriate device-scoped endpoint**. It could improve restart/revocation diagnostics without moving authority into the SDK.

The release workflow uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [provenance](https://docs.npmjs.com/generating-provenance-statements/). Publication remains conditional on green CI and repeat verification of the fresh public-registry installation.
