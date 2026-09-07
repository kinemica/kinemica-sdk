import { randomUUID } from "node:crypto";
import { KinemicaDevice, type DeviceEvidenceMediaType } from "@kinemica/sdk";

// Run in a Node.js server or device process. Construct this operation once and
// preserve it in your application if delivery becomes uncertain.
export function prepareObservation(
  bytes: Uint8Array,
  mediaType: DeviceEvidenceMediaType,
) {
  return {
    bytes: new Uint8Array(bytes),
    mediaType,
    observedAt: new Date().toISOString(),
    uploadKey: `snapshot:${randomUUID()}`,
    eventKey: `observation:${randomUUID()}`,
  };
}

export async function submitObservation(
  device: KinemicaDevice,
  operation: ReturnType<typeof prepareObservation>,
  signal?: AbortSignal,
) {
  const options = signal ? { signal } : undefined;
  const evidence = await device.evidence.upload(
    {
      bytes: operation.bytes,
      mediaType: operation.mediaType,
      observedAt: operation.observedAt,
      idempotencyKey: operation.uploadKey,
    },
    options,
  );
  return device.events.submit(
    {
      kind: "PERSON_DETECTED",
      observedAt: operation.observedAt,
      evidenceIds: [evidence.evidenceId],
      idempotencyKey: operation.eventKey,
    },
    options,
  );
}

// Your application may explicitly call submitObservation again with the SAME
// operation after an uncertain response. This example schedules no retry.
// The configured server workflow determines the returned review work.
