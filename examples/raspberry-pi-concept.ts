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
): Promise<void> {
  const device = new KinemicaDevice({ credential: deviceCredential });

  await device.heartbeat({
    idempotencyKey: `heartbeat:${randomUUID()}`,
  });

  const event = await device.events.submit({
    kind: "PERSON_DETECTED",
    observedAt: new Date().toISOString(),
    confidence,
    metadata: { zone: "loading_bay" },
    idempotencyKey: `person-detected:${randomUUID()}`,
  });

  // This is Kinemica's server-side policy result, not a hardware command.
  console.log(event.decision.outcome, event.decision.ruleId);
}
