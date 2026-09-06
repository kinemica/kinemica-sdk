import { HttpClient, type KinemicaTransportOptions } from "./client.js";
import { KinemicaApiError, KinemicaValidationError } from "./errors.js";
import type {
  DeviceEventResult,
  DeviceHeartbeat,
  DeviceHeartbeatParams,
  RequestOptions,
  SubmitDeviceEventParams,
} from "./types.js";
import {
  parseDeviceEventResponse,
  parseDeviceHeartbeatResponse,
  parseDevicePairingResponse,
  validateDeviceConfidence,
  validateDeviceCredential,
  validateDeviceEventKind,
  validateDeviceMetadata,
  validateDeviceObservedAt,
  validateIdempotencyKey,
  validatePairingCode,
} from "./validation.js";

export interface KinemicaDeviceOptions extends KinemicaTransportOptions {
  readonly credential: string;
}

export interface KinemicaDevicePairOptions extends KinemicaTransportOptions {
  readonly signal?: AbortSignal;
}

interface PairedDeviceDetails {
  readonly deviceId: string;
  readonly name: string;
  readonly expiresAt: string;
  readonly requestId: string;
}

function transportOptions(
  options: KinemicaDevicePairOptions,
): KinemicaTransportOptions {
  return {
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
}

export class DeviceEventsResource {
  constructor(private readonly client: HttpClient) {}

  async submit(
    params: SubmitDeviceEventParams,
    options?: RequestOptions,
  ): Promise<DeviceEventResult> {
    try {
      const keys = Object.keys(params);
      if (
        keys.some(
          (key) =>
            ![
              "kind",
              "observedAt",
              "confidence",
              "metadata",
              "idempotencyKey",
            ].includes(key),
        )
      ) {
        throw new Error("Unsupported device event field.");
      }
      validateDeviceEventKind(params.kind);
      validateDeviceObservedAt(params.observedAt);
      validateDeviceConfidence(params.confidence);
      validateDeviceMetadata(params.metadata);
      validateIdempotencyKey(params.idempotencyKey);
    } catch {
      throw new KinemicaValidationError("The device event is invalid.");
    }

    const response = await this.client.request({
      method: "POST",
      path: "/devices/events",
      headers: { "Idempotency-Key": params.idempotencyKey },
      body: {
        kind: params.kind,
        observedAt: params.observedAt,
        ...(params.confidence === undefined
          ? {}
          : { confidence: params.confidence }),
        metadata: params.metadata ?? {},
      },
      ...(options ? { options } : {}),
    });
    try {
      return parseDeviceEventResponse(response);
    } catch {
      throw new KinemicaApiError(
        "Kinemica returned an incompatible device event response.",
      );
    }
  }
}

export class KinemicaDevice {
  readonly events: DeviceEventsResource;
  readonly deviceId: string | undefined;
  readonly name: string | undefined;
  readonly credentialExpiresAt: string | undefined;
  readonly pairingRequestId: string | undefined;
  readonly #credential: string;
  readonly #client: HttpClient;

  constructor(options: KinemicaDeviceOptions, paired?: PairedDeviceDetails) {
    try {
      validateDeviceCredential(options.credential);
    } catch {
      throw new KinemicaValidationError("credential is invalid.");
    }
    this.#credential = options.credential;
    this.#client = new HttpClient(options, this.#credential);
    this.events = new DeviceEventsResource(this.#client);
    this.deviceId = paired?.deviceId;
    this.name = paired?.name;
    this.credentialExpiresAt = paired?.expiresAt;
    this.pairingRequestId = paired?.requestId;
  }

  static async pair(
    pairingCode: string,
    options: KinemicaDevicePairOptions = {},
  ): Promise<KinemicaDevice> {
    let validatedCode: string;
    try {
      validatedCode = validatePairingCode(pairingCode);
    } catch {
      throw new KinemicaValidationError("pairingCode is invalid.");
    }
    const transport = transportOptions(options);
    const response = await new HttpClient(transport).request({
      method: "POST",
      path: "/devices/pair",
      body: { pairingCode: validatedCode },
      sensitiveValues: [validatedCode],
      ...(options.signal ? { options: { signal: options.signal } } : {}),
    });
    try {
      const paired = parseDevicePairingResponse(response);
      return new KinemicaDevice(
        { credential: paired.credential, ...transport },
        {
          deviceId: paired.deviceId,
          name: paired.name,
          expiresAt: paired.expiresAt,
          requestId: paired.requestId,
        },
      );
    } catch {
      throw new KinemicaApiError(
        "Kinemica returned an incompatible device pairing response.",
      );
    }
  }

  get credential(): string {
    return this.#credential;
  }

  async heartbeat(
    params: DeviceHeartbeatParams,
    options?: RequestOptions,
  ): Promise<DeviceHeartbeat> {
    try {
      if (Object.keys(params).some((key) => key !== "idempotencyKey")) {
        throw new Error("Unsupported heartbeat field.");
      }
      validateIdempotencyKey(params.idempotencyKey);
    } catch {
      throw new KinemicaValidationError("The heartbeat request is invalid.");
    }
    const response = await this.#client.request({
      method: "POST",
      path: "/devices/heartbeat",
      headers: { "Idempotency-Key": params.idempotencyKey },
      body: {},
      ...(options ? { options } : {}),
    });
    try {
      return parseDeviceHeartbeatResponse(response);
    } catch {
      throw new KinemicaApiError(
        "Kinemica returned an incompatible device heartbeat response.",
      );
    }
  }
}
