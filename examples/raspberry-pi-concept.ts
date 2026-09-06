import { randomUUID } from "node:crypto";

import { KinemicaDevice } from "../src/index.js";

export async function pairOnce(
  pairingCode: string,
  saveCredential: (credential: string) => Promise<void>,
): Promise<void> {
  const device = await KinemicaDevice.pair(pairingCode);
  await saveCredential(device.credential);
}

// Camera/OpenCV/Picamera software detects an event before this function runs.
// The SDK does not read cameras, stream video or control hardware.
export async function reportPersonDetected(
  deviceCredential: string,
  confidence: number,
  snapshot: Uint8Array,
): Promise<void> {
  const device = new KinemicaDevice({ credential: deviceCredential });

  await device.heartbeat({
    idempotencyKey: `heartbeat:${randomUUID()}`,
  });

  const observedAt = new Date().toISOString();
  const evidence = await device.evidence.upload({
    bytes: snapshot,
    mediaType: "image/jpeg",
    observedAt,
    originalName: "person-detected.jpg",
    idempotencyKey: `snapshot:${randomUUID()}`,
  });

  const event = await device.events.submit({
    kind: "PERSON_DETECTED",
    observedAt,
    confidence,
    evidenceIds: [evidence.evidenceId],
    metadata: { zone: "loading_bay" },
    idempotencyKey: `person-detected:${randomUUID()}`,
  });

  // Kinemica returns server-owned review work, not a hardware command.
  console.log(event.work.status, event.work.jobId);
}
