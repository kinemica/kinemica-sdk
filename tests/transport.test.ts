import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  Kinemica,
  KinemicaDevice,
  KinemicaApiError,
  KinemicaAuthenticationError,
  KinemicaConnectionError,
  KinemicaConflictError,
  KinemicaForbiddenError,
  KinemicaNotFoundError,
  KinemicaRateLimitError,
  KinemicaServiceUnavailableError,
  KinemicaRequestAbortedError,
  KinemicaTimeoutError,
  KinemicaValidationError,
} from "../src/index.js";

const apiKey = `kin_live_${"x".repeat(43)}`;
const deviceCredential = `kin_device_${"y".repeat(43)}`;
const heartbeat = {
  data: {
    deviceId: "device_123",
    status: "ONLINE",
    lastSeenAt: "2026-09-07T00:00:00.000Z",
    serverTime: "2026-09-07T00:00:00.000Z",
  },
  requestId: "request_123",
  replayed: false,
};
const json = (value: unknown, status = 200, requestId = "request_header") =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "x-kinemica-request-id": requestId },
  });

describe("transport regressions", () => {
  it("does not call fetch for an already aborted request", async () => {
    const fetch = vi.fn(async () => json(heartbeat));
    const device = new KinemicaDevice({ credential: deviceCredential, fetch });
    await expect(
      device.heartbeat(
        { idempotencyKey: "heartbeat-aborted" },
        { signal: AbortSignal.abort(deviceCredential) },
      ),
    ).rejects.toBeInstanceOf(KinemicaRequestAbortedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["timeout", "caller"] as const)(
    "preserves %s cancellation while reading the response body",
    async (kind) => {
      const caller = new AbortController();
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"data":'));
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(new Error(deviceCredential)),
                  { once: true },
                );
                if (kind === "caller")
                  queueMicrotask(() => caller.abort(deviceCredential));
              },
            }),
            { headers: { "x-kinemica-request-id": "request_stream" } },
          );
        },
      );
      const device = new KinemicaDevice({
        credential: deviceCredential,
        fetch,
        timeoutMs: 10,
      });
      await expect(
        device.heartbeat(
          { idempotencyKey: "heartbeat-body" },
          { signal: caller.signal },
        ),
      ).rejects.toBeInstanceOf(
        kind === "caller" ? KinemicaRequestAbortedError : KinemicaTimeoutError,
      );
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("bounds waiting for a custom fetch that ignores cancellation", async () => {
    const fetch = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* deliberately never settles */
        }),
    );
    const client = new Kinemica({ apiKey, fetch, timeoutMs: 5 });
    await expect(client.work.retrieve("job_123")).rejects.toBeInstanceOf(
      KinemicaTimeoutError,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [400, KinemicaValidationError],
    [401, KinemicaAuthenticationError],
    [403, KinemicaForbiddenError],
    [404, KinemicaNotFoundError],
    [409, KinemicaConflictError],
    [429, KinemicaRateLimitError],
    [500, KinemicaApiError],
    [502, KinemicaApiError],
    [503, KinemicaServiceUnavailableError],
  ] as const)(
    "preserves HTTP %i taxonomy for non-JSON failures without retrying",
    async (status, ErrorType) => {
      const fetch = vi.fn(
        async () =>
          new Response(`<html>${apiKey}</html>`, {
            status,
            headers: { "x-kinemica-request-id": "request_failure" },
          }),
      );
      const error: unknown = await new Kinemica({ apiKey, fetch }).work
        .retrieve("job_123")
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ErrorType);
      expect(error).toMatchObject({ status, requestId: "request_failure" });
      expect(inspect(error)).not.toContain(apiKey);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    "redacts every diagnostic field, including malformed JSON=%s",
    async (malformed) => {
      const fetch = vi.fn(async () =>
        malformed
          ? new Response("invalid", {
              status: 400,
              headers: { "x-kinemica-request-id": apiKey },
            })
          : json(
              {
                error: {
                  code: "validation",
                  message: `Rejected ${apiKey}`,
                  requestId: apiKey,
                  details: [{ field: apiKey, message: apiKey }],
                },
              },
              400,
              apiKey,
            ),
      );
      const error: unknown = await new Kinemica({ apiKey, fetch }).work
        .retrieve("job_123")
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(KinemicaValidationError);
      expect(inspect(error, { depth: null })).not.toContain(apiKey);
      expect(JSON.stringify(error)).not.toContain(apiKey);
      expect(error).toMatchObject({ requestId: undefined });
    },
  );

  it("does not trust SDK-shaped errors thrown by custom fetch", async () => {
    const client = new Kinemica({
      apiKey,
      fetch: async () => {
        throw new KinemicaApiError(apiKey, { requestId: apiKey });
      },
    });
    const error: unknown = await client.work
      .retrieve("job_123")
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(KinemicaConnectionError);
    expect(inspect(error)).not.toContain(apiKey);
  });

  it("preserves request metadata on incompatible successful responses", async () => {
    const client = new Kinemica({
      apiKey,
      fetch: async () => json({ data: {}, requestId: "request_body" }),
    });
    await expect(client.work.retrieve("job_123")).rejects.toMatchObject({
      status: 200,
      requestId: "request_body",
    });
  });

  it("keeps device credentials distinct from project credentials", () => {
    expect(() => new Kinemica({ apiKey: deviceCredential })).toThrow(
      KinemicaValidationError,
    );
  });

  it("requires identifiers to be strings even from JavaScript callers", async () => {
    const fetch = vi.fn(async () => json({}));
    await expect(
      new Kinemica({ apiKey, fetch }).work.retrieve(undefined as never),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("URL, cancellation lifecycle and diagnostic bounds", () => {
  it.each([
    "http://example.com/api/v1",
    "https://user:pass@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#secret",
    "file:///tmp/socket",
    "http://localhost.evil.invalid",
    "not a URL",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    expect(() => new Kinemica({ apiKey, baseUrl })).toThrow(
      KinemicaValidationError,
    );
  });
  it("normalizes trailing slashes without changing the API prefix", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      expect(url).toBe(
        "https://preview.example/custom/api/v1/devices/heartbeat",
      );
      return json(heartbeat);
    });
    await new KinemicaDevice({
      credential: deviceCredential,
      baseUrl: "https://preview.example/custom/api/v1///",
      fetch,
    }).heartbeat({ idempotencyKey: "heartbeat-url-001" });
  });
  it("removes caller listeners after success and does not retain completed request timers", async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    let requestSignal: AbortSignal | null | undefined;
    const device = new KinemicaDevice({
      credential: deviceCredential,
      timeoutMs: 5,
      fetch: async (_input, init) => {
        requestSignal = init?.signal;
        return json(heartbeat);
      },
    });
    await device.heartbeat(
      { idempotencyKey: "heartbeat-listener-001" },
      { signal: caller.signal },
    );
    caller.abort();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(requestSignal?.aborted).toBe(false);
  });
  it("bounds validation details and strips diagnostic control characters", async () => {
    const details = Array.from({ length: 100 }, () => ({
      field: "bad\nfield",
      message: "invalid\u001b[31m",
    }));
    const client = new Kinemica({
      apiKey,
      fetch: async () =>
        json(
          {
            error: {
              code: "validation",
              message: "bad\u001bmessage",
              requestId: "request_details",
              details,
            },
          },
          400,
        ),
    });
    const error: unknown = await client.work
      .retrieve("job_123")
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(KinemicaValidationError);
    if (!(error instanceof KinemicaValidationError))
      throw new Error("Wrong error");
    expect(error.details).toHaveLength(16);
    expect(error.details?.[0]?.field).toBe("bad field");
    expect(error.message).toBe("bad message");
  });
  it("falls back safely for an unknown server error schema", async () => {
    const client = new Kinemica({
      apiKey,
      fetch: async () =>
        json(
          {
            error: {
              code: "future_code",
              message: apiKey,
              internal: "private",
            },
          },
          429,
        ),
    });
    await expect(client.work.retrieve("job_123")).rejects.toMatchObject({
      name: "KinemicaRateLimitError",
      code: "internal_error",
      status: 429,
      requestId: "request_header",
    });
  });
});
