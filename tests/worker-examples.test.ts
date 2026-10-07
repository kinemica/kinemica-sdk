import { describe, expect, it, vi } from "vitest";
import {
  digitalRobotReport,
  transferPartDescriptor,
  type TransferPartSkills,
} from "../examples/digital-robot.js";
import { reportTemperature } from "../examples/physical-sensor.js";
import {
  KinemicaConflictError,
  KinemicaConnectionError,
  KinemicaDevice,
  KinemicaRequestAbortedError,
  KinemicaValidationError,
  type WorkerSkillInvocation,
} from "../src/index.js";

const observedAt = "2026-10-07T10:00:10.000Z";
const parameters = Object.freeze({
  partId: "part-a",
  sourceSlot: "source-1",
  destinationSlot: "output-1",
});
const invocation: WorkerSkillInvocation<TransferPartSkills> = Object.freeze({
  contractVersion: "kinemica.worker.v1",
  commandId: "command_1",
  attemptId: "attempt_1",
  claimId: "claim_1",
  specificationHash: "a".repeat(64),
  correlationId: "correlation_1",
  workId: "job_1",
  taskId: "task_1",
  binding: Object.freeze({
    workerId: "worker_1",
    connectionId: "device_1",
    mode: "SIMULATED",
    configurationVersion: "cell-1",
  }),
  specification: Object.freeze({
    skill: "transfer_part",
    skillVersion: "1",
    parameters,
  }),
  authorizationId: "authorization_1",
  version: 1,
  issuedAt: "2026-10-07T10:00:00.000Z",
  expiresAt: "2026-10-07T10:05:00.000Z",
  reportDueAt: "2026-10-07T10:01:30.000Z",
  idempotencyKey: "dispatch-transfer-1",
});
const receipt = Object.freeze({
  expectedVersion: 3,
  observedAt,
  idempotencyKey: "report-transfer-1",
  evidenceIds: Object.freeze(["evidence_bound_1"]),
});

describe("digital robot contract example (no execution)", () => {
  it.each([
    ["AT_DESTINATION", "SUCCEEDED"],
    ["AT_SOURCE", "BLOCKED"],
    ["MISSING", "BLOCKED"],
    ["UNKNOWN", "UNKNOWN"],
  ] as const)(
    "preserves %s as %s without claiming task completion",
    (objectState, event) => {
      const result = Object.freeze({ ...parameters, objectState });
      const report = digitalRobotReport(invocation, result, receipt);
      expect(report).toMatchObject({
        event,
        result,
        commandId: invocation.commandId,
        attemptId: invocation.attemptId,
        claimId: invocation.claimId,
        specificationHash: invocation.specificationHash,
        correlationId: invocation.correlationId,
        expectedVersion: receipt.expectedVersion,
        observedAt,
        idempotencyKey: receipt.idempotencyKey,
        evidenceIds: receipt.evidenceIds,
      });
      expect(report).not.toHaveProperty("authorizationId");
      expect(report).not.toHaveProperty("verificationStatus");
      expect(report).not.toHaveProperty("workStatus");
      expect(report).not.toHaveProperty("decision");
      if (report.event === "UNKNOWN") {
        expect(report.failure.code).toBe("OUTCOME_UNKNOWN");
      }
      // A pure formatter can repeat a report; this is not an execution/deduplication engine.
      expect(digitalRobotReport(invocation, result, receipt)).toEqual(report);
    },
  );

  it("does not enable physical execution through a mode toggle", () => {
    expect(() =>
      digitalRobotReport(
        { ...invocation, binding: { ...invocation.binding, mode: "PHYSICAL" } },
        { ...parameters, objectState: "AT_DESTINATION" },
        receipt,
      ),
    ).toThrow("digital twin only");
  });

  it.each(["partId", "sourceSlot", "destinationSlot"] as const)(
    "rejects a mismatching observed %s",
    (field) => {
      expect(() =>
        digitalRobotReport(
          invocation,
          {
            ...parameters,
            [field]: "unrelated",
            objectState: "AT_DESTINATION",
          },
          receipt,
        ),
      ).toThrow("does not match");
    },
  );

  it("does not copy unknown fields or secrets from an adapter object into reports", () => {
    const adapterObject = {
      ...invocation,
      credential: "private-adapter-secret",
    };
    const observation = {
      ...parameters,
      objectState: "AT_SOURCE" as const,
      credential: "private-controller-secret",
      driver: { debugState: "not-public" },
    };
    const report = digitalRobotReport(adapterObject, observation, receipt);
    expect(JSON.stringify(report)).not.toContain(adapterObject.credential);
    expect(JSON.stringify(report)).not.toContain(observation.credential);
    expect(report.result).not.toHaveProperty("driver");
    expect(transferPartDescriptor.skill).toBe(report.skill);
  });
});

const credential = `kin_device_${"A".repeat(43)}`;
const sample = Object.freeze({
  celsius: 22.5,
  observedAt,
  idempotencyKey: "temperature-sample-1",
});

describe("physical sensor example (mock transport only)", () => {
  it.each(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"] as const)(
    "reports one observation for %s; never dispatches",
    async (outcome) => {
      const transport = vi.fn<typeof fetch>(async (url, init) => {
        expect(url).toBe("https://app.kinemica.com/api/v1/devices/events");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
          sample.idempotencyKey,
        );
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON observation body.");
        }
        expect(JSON.parse(init.body)).toEqual({
          kind: "TEMPERATURE_OBSERVED",
          observedAt,
          metadata: { value: 22.5, unit: "celsius" },
        });
        return Response.json({
          data: {
            eventId: "event_1",
            deviceId: "device_1",
            kind: "TEMPERATURE_OBSERVED",
            receivedAt: observedAt,
            decision: {
              id: "decision_1",
              outcome,
              ruleId: "KIN-STATE-001",
              policyVersion: 1,
              reason: "Configured observation evaluated.",
              remediation: null,
            },
          },
          requestId: "request_sensor_1",
          replayed: false,
        });
      });
      const device = new KinemicaDevice({ credential, fetch: transport });
      const report = await reportTemperature(device, sample);
      expect(report.decision.outcome).toBe(outcome);
      expect(JSON.stringify(report)).not.toContain(credential);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it("does not retry an idempotency conflict or an unconfigured event", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: {
            code: "device_event_unconfigured",
            message: "Event is not configured.",
          },
          requestId: "request_conflict_1",
        },
        { status: 409 },
      ),
    );
    const device = new KinemicaDevice({ credential, fetch: transport });
    await expect(reportTemperature(device, sample)).rejects.toBeInstanceOf(
      KinemicaConflictError,
    );
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not retry a network failure", async () => {
    const transport = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const device = new KinemicaDevice({ credential, fetch: transport });
    await expect(reportTemperature(device, sample)).rejects.toBeInstanceOf(
      KinemicaConnectionError,
    );
    expect(transport).toHaveBeenCalledOnce();
  });

  it("preserves caller abort without sending the observation", async () => {
    const transport = vi.fn<typeof fetch>();
    const device = new KinemicaDevice({ credential, fetch: transport });
    await expect(
      reportTemperature(device, sample, { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(KinemicaRequestAbortedError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("retains existing finite sensor metadata validation", async () => {
    const transport = vi.fn<typeof fetch>();
    const device = new KinemicaDevice({ credential, fetch: transport });
    await expect(
      reportTemperature(device, { ...sample, celsius: Number.NaN }),
    ).rejects.toBeInstanceOf(KinemicaValidationError);
    expect(transport).not.toHaveBeenCalled();
  });
});
