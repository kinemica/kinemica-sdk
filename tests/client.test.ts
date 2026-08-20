import {
  Kinemica,
  KinemicaApiError,
  KinemicaAuthenticationError,
  KinemicaConflictError,
  KinemicaConnectionError,
  KinemicaForbiddenError,
  KinemicaNotFoundError,
  KinemicaRateLimitError,
  KinemicaRequestAbortedError,
  KinemicaServiceUnavailableError,
  KinemicaTimeoutError,
  KinemicaValidationError,
} from "../src/index.js";
import { describe, expect, it, vi } from "vitest";

const apiKey = `kin_test_${"a".repeat(43)}`;
const baseUrl = "https://preview.example/api/v1";
const productionBaseUrl = "https://app.kinemica.com/api/v1";

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

function workResponse(): unknown {
  return {
    data: {
      id: "job_123",
      title: "Inspect reported site condition",
      status: "READY",
      version: 2,
      updatedAt: "2026-08-17T10:00:00.000Z",
      tasks: [
        {
          id: "task_456",
          title: "Inspect corridor",
          outcome: "Record a verified inspection result.",
          status: "PROPOSED",
          risk: "LOW",
          version: 0,
          locationId: "location_123",
          permittedActions: ["inspect_corridor"],
          requiredCapabilityIds: [],
          assignedWorker: { id: "worker_789", name: "Rover 01", type: "ROBOT" },
          policyDecision: null,
          approvalStatus: null,
          evidence: {
            requiredTypes: [],
            submittedTypes: [],
            latestVerification: null,
            complete: true,
          },
          unresolvedExceptionCount: 0,
        },
      ],
      unresolvedExceptions: [],
      completion: {
        completedTasks: 0,
        totalTasks: 1,
        allEvidencePresent: true,
        verified: false,
      },
    },
    requestId: "request_001",
  };
}

function authorizationResponse(
  outcome: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL",
  replayed = false,
): unknown {
  return {
    data: {
      id: `decision_${outcome.toLowerCase()}`,
      outcome,
      ruleId:
        outcome === "ALLOW"
          ? "KIN-STATE-001"
          : outcome === "BLOCK"
            ? "KIN-CAP-001"
            : "KIN-APP-001",
      policyVersion: 1,
      action: "evaluate_assignment",
      reason: `Expected ${outcome} decision.`,
      remediation: outcome === "ALLOW" ? null : "Change the relevant facts.",
      evaluatedAt: "2026-08-17T10:00:00.000Z",
    },
    requestId: "request_001",
    replayed,
  };
}

function errorResponse(
  status: number,
  code:
    | "authentication"
    | "validation"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "rate_limited"
    | "service_unavailable",
  message = "Safe API error.",
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        requestId: "request_error_001",
        ...(code === "validation"
          ? { details: [{ field: "workerId", message: "Invalid string" }] }
          : {}),
      },
    },
    status,
  );
}

function client(
  fetchImplementation: typeof fetch,
  timeoutMs?: number,
): Kinemica {
  return new Kinemica({
    apiKey,
    baseUrl,
    fetch: mockFetch(fetchImplementation),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

describe("client construction", () => {
  it("requires a non-empty API key and accepts a valid base URL override", () => {
    expect(() => new Kinemica({ apiKey: "", baseUrl })).toThrow(
      KinemicaValidationError,
    );
    expect(() => new Kinemica({ apiKey, baseUrl: "" })).toThrow(
      KinemicaValidationError,
    );
    expect(
      () => new Kinemica({ apiKey, baseUrl: "http://example.com/api/v1" }),
    ).toThrow(KinemicaValidationError);
    expect(
      () => new Kinemica({ apiKey, baseUrl: "http://localhost:3000/api/v1" }),
    ).not.toThrow();
  });

  it("uses the Production Developer API when baseUrl is omitted", async () => {
    const fetch = mockFetch(async (input) => {
      expect(input).toBe(`${productionBaseUrl}/work/job_123`);
      return jsonResponse(workResponse());
    });
    const kinemica = new Kinemica({ apiKey, fetch });

    await expect(kinemica.work.retrieve("job_123")).resolves.toMatchObject({
      id: "job_123",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("validates a sensible timeout", () => {
    expect(() => new Kinemica({ apiKey, baseUrl, timeoutMs: 0 })).toThrow(
      KinemicaValidationError,
    );
    expect(() => new Kinemica({ apiKey, baseUrl, timeoutMs: 300_001 })).toThrow(
      KinemicaValidationError,
    );
  });
});

describe("work.retrieve", () => {
  it("sends Bearer authentication and returns the bounded public work model", async () => {
    const fetch = mockFetch(async (input, init) => {
      expect(input).toBe(`${baseUrl}/work/job_123`);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${apiKey}`);
      expect(init?.method).toBe("GET");
      return jsonResponse(workResponse());
    });
    const kinemica = new Kinemica({ apiKey, baseUrl: `${baseUrl}/`, fetch });

    const work = await kinemica.work.retrieve("job_123");

    expect(work.id).toBe("job_123");
    expect(work.tasks[0]?.assignedWorker?.type).toBe("ROBOT");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects invalid local input without a request", async () => {
    const fetch = mockFetch(async () => jsonResponse(workResponse()));
    const kinemica = new Kinemica({ apiKey, baseUrl, fetch });
    await expect(kinemica.work.retrieve("../foreign")).rejects.toBeInstanceOf(
      KinemicaValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("actions.authorize", () => {
  it.each(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"] as const)(
    "returns %s as a successful domain decision",
    async (outcome) => {
      const kinemica = client(async () =>
        jsonResponse(authorizationResponse(outcome)),
      );
      const decision = await kinemica.actions.authorize({
        workId: "job_123",
        taskId: "task_456",
        workerId: "worker_789",
        action: "assign_worker",
        idempotencyKey: `decision-${outcome.toLowerCase()}`,
      });
      expect(decision.outcome).toBe(outcome);
      expect(decision).toBeInstanceOf(Object);
    },
  );

  it("sends the exact wire body and Idempotency-Key header", async () => {
    const fetch = mockFetch(async (input, init) => {
      expect(input).toBe(`${baseUrl}/actions/authorize`);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("idempotency-key")).toBe("assignment-check-001");
      if (typeof init?.body !== "string")
        throw new Error("Expected a JSON request body.");
      expect(JSON.parse(init.body)).toEqual({
        workId: "job_123",
        taskId: "task_456",
        workerId: "worker_789",
        action: "assign_worker",
      });
      return jsonResponse(authorizationResponse("ALLOW", true));
    });
    const kinemica = new Kinemica({ apiKey, baseUrl, fetch });
    const result = await kinemica.actions.authorize({
      workId: "job_123",
      taskId: "task_456",
      workerId: "worker_789",
      action: "assign_worker",
      idempotencyKey: "assignment-check-001",
    });
    expect(result.replayed).toBe(true);
    expect(result.requestId).toBe("request_001");
  });

  it("rejects malformed authorization input before a request", async () => {
    const fetch = mockFetch(async () =>
      jsonResponse(authorizationResponse("ALLOW")),
    );
    const kinemica = new Kinemica({ apiKey, baseUrl, fetch });
    await expect(
      kinemica.actions.authorize({
        workId: "job_123",
        taskId: "task_456",
        workerId: "worker_789",
        action: "assign_worker",
        idempotencyKey: "short",
      }),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not retry authorization after a network failure", async () => {
    const fetch = mockFetch(async () => {
      throw new Error("socket closed");
    });
    const kinemica = new Kinemica({ apiKey, baseUrl, fetch });
    await expect(
      kinemica.actions.authorize({
        workId: "job_123",
        taskId: "task_456",
        workerId: "worker_789",
        action: "assign_worker",
        idempotencyKey: "no-retry-0001",
      }),
    ).rejects.toBeInstanceOf(KinemicaConnectionError);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("API errors", () => {
  it.each([
    [401, "authentication", KinemicaAuthenticationError],
    [400, "validation", KinemicaValidationError],
    [403, "forbidden", KinemicaForbiddenError],
    [404, "not_found", KinemicaNotFoundError],
    [409, "conflict", KinemicaConflictError],
    [429, "rate_limited", KinemicaRateLimitError],
    [503, "service_unavailable", KinemicaServiceUnavailableError],
  ] as const)(
    "maps HTTP %s/%s to a predictable SDK error",
    async (status, code, ErrorType) => {
      const kinemica = client(async () => errorResponse(status, code));
      const result = kinemica.work.retrieve("job_123");
      await expect(result).rejects.toBeInstanceOf(ErrorType);
      await expect(result).rejects.toMatchObject({
        status,
        code,
        requestId: "request_error_001",
      });
    },
  );

  it("rejects malformed JSON and malformed success responses", async () => {
    const malformedJson = client(
      async () => new Response("<html>", { status: 200 }),
    );
    await expect(malformedJson.work.retrieve("job_123")).rejects.toMatchObject({
      message: "Kinemica returned malformed JSON.",
    });

    const malformedWork = client(async () =>
      jsonResponse({ data: {}, requestId: "request_001" }),
    );
    await expect(malformedWork.work.retrieve("job_123")).rejects.toMatchObject({
      message: "Kinemica returned an incompatible work response.",
    });
  });

  it("never includes the API key in API or network error messages", async () => {
    const echoed = client(async () =>
      errorResponse(401, "authentication", `Rejected ${apiKey}`),
    );
    const apiError = await echoed.work
      .retrieve("job_123")
      .catch((error: unknown) => error);
    expect(apiError).toBeInstanceOf(KinemicaApiError);
    expect(String(apiError)).not.toContain(apiKey);

    const network = client(async () => {
      throw new Error(`network failure with ${apiKey}`);
    });
    const networkError = await network.work
      .retrieve("job_123")
      .catch((error: unknown) => error);
    expect(networkError).toBeInstanceOf(KinemicaConnectionError);
    expect(String(networkError)).not.toContain(apiKey);
  });
});

describe("timeout and cancellation", () => {
  it("returns a predictable timeout error", async () => {
    const kinemica = client(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      5,
    );
    await expect(kinemica.work.retrieve("job_123")).rejects.toBeInstanceOf(
      KinemicaTimeoutError,
    );
  });

  it("supports caller-provided AbortSignal", async () => {
    const controller = new AbortController();
    const kinemica = client(async (_input, init) => {
      controller.abort();
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        if (init?.signal?.aborted)
          reject(new DOMException("Aborted", "AbortError"));
      });
      return jsonResponse(workResponse());
    });
    await expect(
      kinemica.work.retrieve("job_123", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(KinemicaRequestAbortedError);
  });

  it("maps ordinary transport failures without leaking causes", async () => {
    const kinemica = client(async () => {
      throw new Error("DNS failure");
    });
    await expect(kinemica.work.retrieve("job_123")).rejects.toMatchObject({
      message: "Kinemica could not be reached.",
    });
  });
});
