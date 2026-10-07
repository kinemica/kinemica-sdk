import type {
  DeviceEventResult,
  KinemicaDevice,
  RequestOptions,
} from "@kinemica/sdk";

/** One reading supplied by application-owned sensor software; no Pi/driver dependency. */
export interface TemperatureSample {
  readonly celsius: number;
  readonly observedAt: string;
  /** Stable for this reading. Keep the original payload and key for deliberate replay. */
  readonly idempotencyKey: string;
}

/**
 * Runs in trusted Node.js sensor/gateway software, never browser JavaScript.
 * Main must first configure TEMPERATURE_OBSERVED for this paired device using
 * the existing event-binding contract; otherwise Platform returns 409
 * device_event_unconfigured. This is not an arbitrary generic-ingest endpoint.
 */
export async function reportTemperature(
  device: KinemicaDevice,
  sample: TemperatureSample,
  options?: RequestOptions,
): Promise<DeviceEventResult> {
  // Exactly one SDK request. No retries, polling, routing or execution here.
  // The returned policy decision is NOT authority to command a robot.
  return device.events.submit(
    {
      kind: "TEMPERATURE_OBSERVED",
      observedAt: sample.observedAt,
      metadata: { value: sample.celsius, unit: "celsius" },
      idempotencyKey: sample.idempotencyKey,
    },
    options,
  );
}
