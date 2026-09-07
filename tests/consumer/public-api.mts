/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- negative public API compilation assertions */
import { Buffer } from "node:buffer";
import {
  Kinemica,
  KinemicaDevice,
  KinemicaError,
  KinemicaTimeoutError,
  type AuthorizationDecision,
  type DeviceEventResult,
  type DeviceReviewEventResult,
  type DeviceEventSubmissionResult,
  type SubmitDeviceEventParams,
  type DeviceEvidenceUpload,
  type DeviceHeartbeat,
  type Work,
} from "@kinemica/sdk";

// This compiles against source during typecheck and against installed declarations
// in a completely separate consumer in test:package. It never sends requests.
export async function publicApiTypes(
  project: Kinemica,
  device: KinemicaDevice,
  params: SubmitDeviceEventParams,
) {
  const work: Work = await project.work.retrieve("job_123", {
    signal: new AbortController().signal,
  });
  const decision: AuthorizationDecision = await project.actions.authorize({
    workId: work.id,
    taskId: "task_123",
    workerId: "worker_123",
    action: "assign_worker",
    idempotencyKey: "assignment-001",
  });
  const heartbeat: DeviceHeartbeat = await device.heartbeat({
    idempotencyKey: "heartbeat-001",
  });
  const evidence: DeviceEvidenceUpload = await device.evidence.upload({
    bytes: Buffer.from([1, 2, 3]),
    mediaType: "image/png",
    observedAt: new Date().toISOString(),
    idempotencyKey: "evidence-001",
  });
  const ordinary: DeviceEventResult = await device.events.submit({
    kind: "PERSON_DETECTED",
    observedAt: evidence.observedAt,
    idempotencyKey: "event-normal-001",
  });
  const reviewed: DeviceReviewEventResult = await device.events.submit({
    kind: "PERSON_DETECTED",
    observedAt: evidence.observedAt,
    evidenceIds: [evidence.evidenceId],
    idempotencyKey: "event-review-001",
  });
  const readonlyIds = [evidence.evidenceId] as const;
  const readonlyReview: DeviceReviewEventResult = await device.events.submit({
    kind: "PERSON_DETECTED",
    observedAt: evidence.observedAt,
    evidenceIds: readonlyIds,
    idempotencyKey: "event-readonly-001",
  });
  const dynamic: DeviceEventSubmissionResult =
    await device.events.submit(params);
  if ("work" in dynamic) {
    const status: string = dynamic.work.status;
    void status;
  } else {
    const outcome: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL" =
      dynamic.decision.outcome;
    void outcome;
  }
  // @ts-expect-error A policy event has no review-work field.
  void ordinary.work;
  // @ts-expect-error A review event has no policy decision.
  void reviewed.decision;
  void device.events.submit({
    kind: "PERSON_DETECTED",
    observedAt: evidence.observedAt,
    idempotencyKey: "event-scope-001",
    // @ts-expect-error Workspace selection is not a public event field.
    workspaceId: "workspace_123",
  });
  void device.evidence.upload({
    // @ts-expect-error Evidence bytes do not accept a filesystem/storage path.
    bytes: "/etc/passwd",
    mediaType: "image/png",
    observedAt: evidence.observedAt,
    idempotencyKey: "evidence-path-001",
  });
  // @ts-expect-error No dispatch API exists.
  void project.work.dispatch("job_123");
  // @ts-expect-error No local authorization API exists on the device.
  void device.actions.authorize({});
  const error: KinemicaError = new KinemicaTimeoutError("Timed out");
  return {
    work,
    decision,
    heartbeat,
    evidence,
    ordinary,
    reviewed,
    readonlyReview,
    dynamic,
    error,
  };
}
