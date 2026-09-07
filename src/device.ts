import { HttpClient, type KinemicaTransportOptions } from "./client.js";
import { KinemicaValidationError } from "./errors.js";
import { parseResponse } from "./response.js";
import type {
  DeviceEventResult,
  DeviceEventSubmissionResult,
  DeviceEvidenceUpload,
  DeviceHeartbeat,
  DeviceHeartbeatParams,
  RequestOptions,
  SubmitDeviceEventParams,
  UploadDeviceEvidenceParams,
} from "./types.js";
import {
  parseDeviceEvidenceResponse,
  parseDeviceEventResponse,
  parseDeviceHeartbeatResponse,
  parseDevicePairingResponse,
  validateDeviceConfidence,
  validateDeviceCredential,
  validateDeviceEvidenceBytes,
  validateDeviceEvidenceIds,
  validateDeviceEvidenceMediaType,
  validateDeviceEvidenceOriginalName,
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
    params: SubmitDeviceEventParams & { readonly evidenceIds?: undefined },
    options?: RequestOptions,
  ): Promise<DeviceEventResult>;
  async submit(
    params: SubmitDeviceEventParams & {
      readonly evidenceIds: readonly [string, ...string[]];
    },
    options?: RequestOptions,
  ): Promise<import("./types.js").DeviceReviewEventResult>;
  async submit(
    params: SubmitDeviceEventParams,
    options?: RequestOptions,
  ): Promise<DeviceEventSubmissionResult>;
  async submit(
    params: SubmitDeviceEventParams,
    options?: RequestOptions,
  ): Promise<DeviceEventSubmissionResult> {
    try {
      const keys = Object.keys(params);
      if (
        keys.some(
          (key) =>
            ![
              "kind",
              "observedAt",
              "confidence",
              "evidenceIds",
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
      validateDeviceEvidenceIds(params.evidenceIds);
      validateDeviceMetadata(params.metadata);
      validateIdempotencyKey(params.idempotencyKey);
    } catch {
      throw new KinemicaValidationError("The device event is invalid.");
    }

    const expectsReview = (params.evidenceIds?.length ?? 0) > 0;
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
        ...(params.evidenceIds === undefined
          ? {}
          : { evidenceIds: params.evidenceIds }),
        metadata: params.metadata ?? {},
      },
      ...(options ? { options } : {}),
    });
    return parseResponse(
      response,
      (value) => {
        const event = parseDeviceEventResponse(value);
        const isReview = "work" in event;
        if (expectsReview !== isReview)
          throw new Error("Unexpected event result variant.");
        return event;
      },
      "Kinemica returned an incompatible device event response.",
    );
  }
}

export class DeviceEvidenceResource {
  constructor(private readonly client: HttpClient) {}

  async upload(
    params: UploadDeviceEvidenceParams,
    options?: RequestOptions,
  ): Promise<DeviceEvidenceUpload> {
    try {
      if (
        Object.keys(params).some(
          (key) =>
            ![
              "bytes",
              "mediaType",
              "observedAt",
              "originalName",
              "idempotencyKey",
            ].includes(key),
        )
      ) {
        throw new Error("Unsupported device evidence field.");
      }
      validateDeviceEvidenceBytes(params.bytes);
      validateDeviceEvidenceMediaType(params.mediaType);
      validateDeviceObservedAt(params.observedAt);
      validateDeviceEvidenceOriginalName(params.originalName);
      validateIdempotencyKey(params.idempotencyKey);
    } catch {
      throw new KinemicaValidationError("The device evidence is invalid.");
    }

    const response = await this.client.request({
      method: "POST",
      path: "/devices/evidence",
      headers: {
        "Content-Type": params.mediaType,
        "Idempotency-Key": params.idempotencyKey,
        "X-Kinemica-Observed-At": params.observedAt,
        ...(params.originalName === undefined
          ? {}
          : { "X-Kinemica-Original-Name": params.originalName.trim() }),
      },
      rawBody: params.bytes,
      ...(options ? { options } : {}),
    });
    return parseResponse(
      response,
      parseDeviceEvidenceResponse,
      "Kinemica returned an incompatible device evidence response.",
    );
  }
}

export class KinemicaDevice {
  readonly events: DeviceEventsResource;
  readonly evidence: DeviceEvidenceResource;
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
    this.evidence = new DeviceEvidenceResource(this.#client);
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
      sensitiveValues: [
        validatedCode,
        validatedCode.replaceAll("-", "").toUpperCase(),
        validatedCode.replaceAll("-", "").toLowerCase(),
      ],
      ...(options.signal ? { options: { signal: options.signal } } : {}),
    });
    const paired = parseResponse(
      response,
      parseDevicePairingResponse,
      "Kinemica returned an incompatible device pairing response.",
    );
    return new KinemicaDevice(
      { credential: paired.credential, ...transport },
      {
        deviceId: paired.deviceId,
        name: paired.name,
        expiresAt: paired.expiresAt,
        requestId: paired.requestId,
      },
    );
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
    return parseResponse(
      response,
      parseDeviceHeartbeatResponse,
      "Kinemica returned an incompatible device heartbeat response.",
    );
  }
}
