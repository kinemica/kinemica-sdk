import {
  KinemicaApiError,
  KinemicaAuthenticationError,
  KinemicaConflictError,
  KinemicaConnectionError,
  KinemicaDevice,
  KinemicaTimeoutError,
  KinemicaValidationError,
} from "../src/index.js";
import { describe, expect, it, vi } from "vitest";

const credential = `kin_device_${"A".repeat(43)}`;
const baseUrl = "https://preview.example/api/v1";
const productionBaseUrl = "https://app.kinemica.com/api/v1";
const now = "2026-09-06T10:00:00.000Z";

function mockFetch(implementation: typeof fetch): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Kinemica-Request-Id": "request_header_001",
    },
  });
}

function requestJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return JSON.parse(init.body) as unknown;
}

function pairingResponse(): unknown {
  return {
    data: {
      deviceId: "device_camera_001",
      name: "Loading bay camera",
      credential,
      expiresAt: "2027-09-06T10:00:00.000Z",
    },
    requestId: "request_pair_001",
  };
}

function heartbeatResponse(replayed = false): unknown {
  return {
    data: {
      deviceId: "device_camera_001",
      status: "ONLINE",
      lastSeenAt: now,
      serverTime: now,
    },
    requestId: "request_heartbeat_001",
    replayed,
  };
}

function eventResponse(
  outcome: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL",
  replayed = false,
): unknown {
  return {
    data: {
      eventId: "device_event_001",
      deviceId: "device_camera_001",
      kind: "PERSON_DETECTED",
      receivedAt: now,
      decision: {
        id: "decision_device_001",
        outcome,
        ruleId: outcome === "ALLOW" ? "KIN-STATE-001" : "KIN-CAP-001",
        policyVersion: 1,
        reason: `Expected ${outcome} decision.`,
        remediation: outcome === "ALLOW" ? null : "Change the relevant facts.",
      },
    },
    requestId: "request_event_001",
    replayed,
  };
}

function errorResponse(message: string): Response {
  return jsonResponse(
    {
      error: {
        code: "authentication",
        message,
        requestId: "request_error_001",
      },
    },
    401,
  );
}

describe("KinemicaDevice pairing", () => {
  it("pairs without bearer authentication and returns a usable scoped client", async () => {
    const fetch = mockFetch(async (input, init) => {
      expect(input).toBe(`${productionBaseUrl}/devices/pair`);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.get("content-type")).toBe("application/json");
      expect(requestJson(init)).toEqual({
        pairingCode: "2345-6789-ABCD-EFGH",
      });
      return jsonResponse(pairingResponse(), 201);
    });

    const device = await KinemicaDevice.pair(" 2345-6789-ABCD-EFGH ", {
      fetch,
    });

    expect(device.deviceId).toBe("device_camera_001");
    expect(device.name).toBe("Loading bay camera");
    expect(device.credential).toBe(credential);
    expect(device.credentialExpiresAt).toBe("2027-09-06T10:00:00.000Z");
    expect(device.pairingRequestId).toBe("request_pair_001");
    expect(JSON.stringify(device)).not.toContain(credential);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps invalid or expired pairing codes to opaque authentication errors", async () => {
    const fetch = mockFetch(async () =>
      errorResponse("The pairing code is invalid or expired."),
    );

    await expect(
      KinemicaDevice.pair("2345-6789-ABCD-EFGH", { baseUrl, fetch }),
    ).rejects.toMatchObject({
      name: "KinemicaAuthenticationError",
      status: 401,
      requestId: "request_error_001",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed pairing input without making a request", async () => {
    const fetch = mockFetch(async () => jsonResponse(pairingResponse(), 201));
    await expect(
      KinemicaDevice.pair("too-short", { baseUrl, fetch }),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose a reflected pairing code in an API error", async () => {
    const pairingCode = "2345-6789-ABCD-EFGH";
    const fetch = mockFetch(async () =>
      errorResponse(`Rejected pairing code ${pairingCode}`),
    );
    const error = await KinemicaDevice.pair(pairingCode, {
      baseUrl,
      fetch,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KinemicaAuthenticationError);
    expect(String(error)).not.toContain(pairingCode);
  });
});

describe("KinemicaDevice heartbeat", () => {
  it("accepts only a device-scoped credential", () => {
    expect(
      () => new KinemicaDevice({ credential: `kin_live_${"A".repeat(43)}` }),
    ).toThrow(KinemicaValidationError);
  });

  it("uses only the device credential and returns server-owned liveness", async () => {
    const fetch = mockFetch(async (input, init) => {
      expect(input).toBe(`${baseUrl}/devices/heartbeat`);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${credential}`);
      expect(headers.get("idempotency-key")).toBe("heartbeat-camera-0001");
      expect(requestJson(init)).toEqual({});
      return jsonResponse(heartbeatResponse(true));
    });
    const device = new KinemicaDevice({ credential, baseUrl, fetch });

    await expect(
      device.heartbeat({ idempotencyKey: "heartbeat-camera-0001" }),
    ).resolves.toMatchObject({
      deviceId: "device_camera_001",
      status: "ONLINE",
      replayed: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps a revoked credential to authentication failure", async () => {
    const fetch = mockFetch(async () =>
      errorResponse("Authentication required."),
    );
    const device = new KinemicaDevice({ credential, baseUrl, fetch });

    await expect(
      device.heartbeat({ idempotencyKey: "heartbeat-revoked-0001" }),
    ).rejects.toBeInstanceOf(KinemicaAuthenticationError);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("KinemicaDevice events", () => {
  it.each(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"] as const)(
    "returns the server-owned %s policy decision",
    async (outcome) => {
      const fetch = mockFetch(async (input, init) => {
        expect(input).toBe(`${baseUrl}/devices/events`);
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${credential}`);
        expect(headers.get("idempotency-key")).toBe(
          `event-${outcome.toLowerCase()}-0001`,
        );
        expect(requestJson(init)).toEqual({
          kind: "PERSON_DETECTED",
          observedAt: now,
          confidence: 0.94,
          metadata: { zone: "corridor" },
        });
        return jsonResponse(eventResponse(outcome), 201);
      });
      const device = new KinemicaDevice({ credential, baseUrl, fetch });

      const event = await device.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        confidence: 0.94,
        metadata: { zone: "corridor" },
        idempotencyKey: `event-${outcome.toLowerCase()}-0001`,
      });

      expect(event.decision.outcome).toBe(outcome);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("preserves exact replay and never retries automatically", async () => {
    const replayFetch = mockFetch(async () =>
      jsonResponse(eventResponse("ALLOW", true), 201),
    );
    const replayDevice = new KinemicaDevice({
      credential,
      baseUrl,
      fetch: replayFetch,
    });
    await expect(
      replayDevice.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        idempotencyKey: "event-replay-0001",
      }),
    ).resolves.toMatchObject({ replayed: true });
    expect(replayFetch).toHaveBeenCalledOnce();

    const failedFetch = mockFetch(async () => {
      throw new Error("socket closed");
    });
    const failedDevice = new KinemicaDevice({
      credential,
      baseUrl,
      fetch: failedFetch,
    });
    await expect(
      failedDevice.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        idempotencyKey: "event-no-retry-0001",
      }),
    ).rejects.toBeInstanceOf(KinemicaConnectionError);
    expect(failedFetch).toHaveBeenCalledOnce();
  });

  it("maps a changed payload under one idempotency key to conflict", async () => {
    const fetch = mockFetch(async () =>
      jsonResponse(
        {
          error: {
            code: "conflict",
            message:
              "The idempotency key was already used for a different request.",
            requestId: "request_conflict_001",
          },
        },
        409,
      ),
    );
    const device = new KinemicaDevice({ credential, baseUrl, fetch });
    await expect(
      device.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        idempotencyKey: "event-conflict-0001",
      }),
    ).rejects.toBeInstanceOf(KinemicaConflictError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed and authority-bearing events without a request", async () => {
    const fetch = mockFetch(async () =>
      jsonResponse(eventResponse("ALLOW"), 201),
    );
    const device = new KinemicaDevice({ credential, baseUrl, fetch });

    await expect(
      device.events.submit({
        kind: "person-detected",
        observedAt: now,
        idempotencyKey: "event-invalid-0001",
      }),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    await expect(
      device.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        idempotencyKey: "event-authority-0001",
        workspaceId: "workspace_attacker",
        policyDecision: "ALLOW",
      } as never),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    await expect(
      device.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        metadata: { note: "x".repeat(257) },
        idempotencyKey: "event-metadata-0001",
      }),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("handles timeouts once and never leaks the device credential", async () => {
    const timeoutFetch = mockFetch(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const timedDevice = new KinemicaDevice({
      credential,
      baseUrl,
      fetch: timeoutFetch,
      timeoutMs: 5,
    });
    await expect(
      timedDevice.events.submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        idempotencyKey: "event-timeout-0001",
      }),
    ).rejects.toBeInstanceOf(KinemicaTimeoutError);
    expect(timeoutFetch).toHaveBeenCalledOnce();

    const echoedFetch = mockFetch(async () =>
      errorResponse(`Rejected credential ${credential}`),
    );
    const echoedDevice = new KinemicaDevice({
      credential,
      baseUrl,
      fetch: echoedFetch,
    });
    const error = await echoedDevice.events
      .submit({
        kind: "PERSON_DETECTED",
        observedAt: now,
        idempotencyKey: "event-secret-0001",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KinemicaApiError);
    expect(String(error)).not.toContain(credential);
    expect(JSON.stringify(echoedDevice)).not.toContain(credential);
  });
});
