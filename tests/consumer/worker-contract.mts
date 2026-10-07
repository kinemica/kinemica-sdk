/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- negative public API compilation assertions */
import type {
  Kinemica,
  KinemicaDevice,
  SubmitDeviceEventParams,
  WorkerCancellationRequest,
  WorkerExecutionBinding,
  WorkerExecutionFailure,
  WorkerExecutionReference,
  WorkerExecutionReport,
  WorkerJsonObject,
  WorkerSchemaReference,
  WorkerSkillCatalog,
  WorkerSkillDescriptor,
  WorkerSkillInvocation,
} from "@kinemica/sdk";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a closed mapped-type catalog must not add an open string index signature
type Skills = {
  readonly move_item: {
    readonly version: "1";
    readonly parameters: { readonly destination: string };
    readonly result: { readonly arrived: boolean };
  };
  readonly inspect_item: {
    readonly version: "2";
    readonly parameters: { readonly sampleCount: number };
    readonly result: { readonly observationCount: number };
  };
};

// Compile-only consumer assertions. This function is never invoked; it does not
// receive work, authenticate messages, execute hardware or contact any service.
export function workerContractTypes(
  project: Kinemica,
  device: KinemicaDevice,
  observation: SubmitDeviceEventParams,
  catalog: Skills,
) {
  const skillCatalog: WorkerSkillCatalog = catalog;
  const schema: WorkerSchemaReference = { id: "move.parameters", version: "1" };
  const descriptor = {
    skill: "move_item",
    skillVersion: "1",
    description: "Move one already-selected item to a named destination.",
    parametersSchema: schema,
    resultSchema: { id: "move.result", version: "1" },
    requiredCapabilityIds: ["capability_move_item"],
    safetyConstraints: [
      "Commissioned workspace only; interlocks remain active.",
    ],
    cancellation: "COOPERATIVE",
  } as const satisfies WorkerSkillDescriptor<Skills>;
  const simulated: WorkerExecutionBinding = {
    workerId: "worker_123",
    connectionId: "connection_123",
    mode: "SIMULATED",
    configurationVersion: "1",
  };
  // A separately commissioned connection, never a toggle on the same identity.
  const physical: WorkerExecutionBinding = {
    workerId: "worker_physical_123",
    connectionId: "connection_physical_123",
    mode: "PHYSICAL",
    configurationVersion: "physical-cell-1",
  };
  const execution: WorkerExecutionReference = {
    commandId: "command_123",
    attemptId: "attempt_123",
    claimId: "claim_123",
    specificationHash: "a".repeat(64),
    correlationId: "correlation_123",
  };
  const common = {
    ...execution,
    contractVersion: "kinemica.worker.v1",
    workId: "job_123",
    taskId: "task_123",
    binding: simulated,
    authorizationId: "authorization_123",
    version: 1,
    issuedAt: "2026-10-07T10:00:00.000Z",
    expiresAt: "2026-10-07T10:01:00.000Z",
    reportDueAt: "2026-10-07T10:00:45.000Z",
    idempotencyKey: "invocation-123",
  } as const;
  const move = {
    ...common,
    specification: {
      skill: "move_item",
      skillVersion: "1",
      parameters: { destination: "tray_a" },
    },
  } as const satisfies WorkerSkillInvocation<Skills>;
  const inspect = {
    ...common,
    binding: physical,
    specification: {
      skill: "inspect_item",
      skillVersion: "2",
      parameters: { sampleCount: 3 },
    },
  } as const satisfies WorkerSkillInvocation<Skills>;
  const invocation: WorkerSkillInvocation<Skills> = move;
  const reportBase = {
    ...execution,
    contractVersion: "kinemica.worker.v1",
    skill: "move_item",
    skillVersion: "1",
    expectedVersion: 1,
    observedAt: "2026-10-07T10:00:05.000Z",
    idempotencyKey: "report-123",
    summary: "Bounded executor report; not a work closeout.",
    evidenceIds: ["evidence_123"],
  } as const;
  const failure = {
    code: "SAFETY_STOP",
    message: "The local interlock prevented movement.",
  } as const satisfies WorkerExecutionFailure;
  const unknownFailure = {
    code: "OUTCOME_UNKNOWN",
    message: "Restart occurred before the effect could be reconciled.",
  } as const satisfies WorkerExecutionFailure;
  const result = { arrived: true } as const;
  const reports: readonly WorkerExecutionReport<Skills>[] = [
    { ...reportBase, event: "ACKNOWLEDGE" },
    { ...reportBase, event: "STARTED" },
    { ...reportBase, event: "PROGRESS", telemetry: { progress: 0.5 } },
    { ...reportBase, event: "SUCCEEDED", result },
    { ...reportBase, event: "BLOCKED", failure },
    { ...reportBase, event: "BLOCKED", failure, result: { arrived: false } },
    { ...reportBase, event: "UNKNOWN", failure: unknownFailure },
    { ...reportBase, event: "UNKNOWN", failure: unknownFailure, result },
    { ...reportBase, event: "STOPPED" },
    { ...reportBase, event: "STOPPED", cancellationId: "cancel_123", result },
    {
      ...reportBase,
      skill: "inspect_item",
      skillVersion: "2",
      event: "SUCCEEDED",
      result: { observationCount: 3 },
    },
  ];
  const cancellation: WorkerCancellationRequest = {
    ...execution,
    contractVersion: "kinemica.worker.v1",
    cancellationId: "cancel_123",
    issuedAt: "2026-10-07T10:00:10.000Z",
    idempotencyKey: "cancellation-123",
    reason: "Operator requested a cooperative stop.",
  };
  const acceptDescriptor = (value: WorkerSkillDescriptor<Skills>) => value;
  const acceptInvocation = (value: WorkerSkillInvocation<Skills>) => value;
  const acceptReport = (value: WorkerExecutionReport<Skills>) => value;
  const acceptJson = (value: WorkerJsonObject) => value;

  // @ts-expect-error Skill versions are correlated with the selected skill.
  acceptDescriptor({ ...descriptor, skillVersion: "2" });
  // @ts-expect-error Descriptor strings describe support, not a policy outcome.
  acceptDescriptor({ ...descriptor, outcome: "ALLOW" });
  acceptInvocation({
    ...move,
    specification: {
      skill: "move_item",
      skillVersion: "1",
      // @ts-expect-error Invocation parameters must match the selected skill.
      parameters: { sampleCount: 3 },
    },
  });
  acceptInvocation({
    ...move,
    // @ts-expect-error Invocation version must match the selected skill.
    specification: { ...move.specification, skillVersion: "2" },
  });
  // @ts-expect-error Sensor observations are not execution requests.
  acceptInvocation(observation);
  // @ts-expect-error Workers cannot select a workspace through this contract.
  acceptInvocation({ ...move, workspaceId: "workspace_123" });
  // @ts-expect-error A policy outcome is not an execution grant.
  acceptInvocation({ ...move, outcome: "ALLOW" });
  // @ts-expect-error Credentials belong to transport, never message contents.
  acceptInvocation({ ...move, credential: "not-a-credential" });
  // @ts-expect-error Successful reports require a typed result.
  acceptReport({ ...reportBase, event: "SUCCEEDED" });
  // @ts-expect-error Another skill's result is not a valid move result.
  acceptReport({
    ...reportBase,
    event: "SUCCEEDED",
    result: { observationCount: 3 },
  });
  // @ts-expect-error Report skill/version correlation must be preserved.
  acceptReport({
    ...reportBase,
    skillVersion: "2",
    event: "SUCCEEDED",
    result,
  });
  // @ts-expect-error An indeterminate effect cannot be reported as a known block.
  acceptReport({ ...reportBase, event: "BLOCKED", failure: unknownFailure });
  // @ts-expect-error UNKNOWN requires its own explicit failure classification.
  acceptReport({ ...reportBase, event: "UNKNOWN", failure });
  // @ts-expect-error Optional failed-execution observations still use the result schema.
  acceptReport({
    ...reportBase,
    event: "BLOCKED",
    failure,
    result: { observationCount: 3 },
  });
  // @ts-expect-error Optional uncertain-execution observations still use the result schema.
  acceptReport({
    ...reportBase,
    event: "UNKNOWN",
    failure: unknownFailure,
    result: { observationCount: 3 },
  });
  // @ts-expect-error Optional stopped-execution observations still use the result schema.
  acceptReport({
    ...reportBase,
    event: "STOPPED",
    result: { observationCount: 3 },
  });
  // @ts-expect-error Acknowledgement is not a result or completion assertion.
  acceptReport({ ...reportBase, event: "ACKNOWLEDGE", result });
  // @ts-expect-error A started report cannot include a failure.
  acceptReport({ ...reportBase, event: "STARTED", failure });
  // @ts-expect-error Progress requires a bounded telemetry snapshot.
  acceptReport({ ...reportBase, event: "PROGRESS" });
  acceptReport({
    ...reportBase,
    event: "PROGRESS",
    // @ts-expect-error Telemetry accepts scalar observations, not nested commands.
    telemetry: { command: { move: true } },
  });
  // @ts-expect-error A successful report cannot carry a failure.
  acceptReport({ ...reportBase, event: "SUCCEEDED", result, failure });
  // @ts-expect-error STOPPED is a confirmation, not a failure report.
  acceptReport({ ...reportBase, event: "STOPPED", failure });
  // @ts-expect-error A report does not authorize or close out work.
  acceptReport({ ...reportBase, event: "SUCCEEDED", result, verified: true });
  // @ts-expect-error Execution values must be JSON, never executable functions.
  acceptJson({ execute: () => true });
  acceptInvocation({
    ...move,
    specification: {
      ...move.specification,
      // @ts-expect-error Parameters must be serializable data, not a driver callback.
      parameters: { destination: () => "tray_a" },
    },
  });
  // @ts-expect-error Commissioned identity is immutable through this contract.
  physical.workerId = "worker_other";
  // @ts-expect-error The invocation identity is readonly.
  invocation.commandId = "command_other";
  // @ts-expect-error Evidence IDs are readonly.
  reportBase.evidenceIds.push("evidence_other");
  // @ts-expect-error Cancellation is an immutable message, not a local state setter.
  cancellation.cancellationId = "cancel_other";
  // @ts-expect-error No worker dispatch HTTP API was added to the project client.
  void project.workers.execute;
  // @ts-expect-error Sensor clients do not receive execution APIs.
  void device.executions;

  return {
    skillCatalog,
    schema,
    descriptor,
    move,
    inspect,
    reports,
    cancellation,
  };
}

// Discriminants preserve the skill-specific parameter and result types after
// messages are handed to consumer code as the full public union.
export function correlateWorkerMessages(
  invocation: WorkerSkillInvocation<Skills>,
  report: WorkerExecutionReport<Skills>,
) {
  if (invocation.specification.skill === "move_item") {
    const destination: string = invocation.specification.parameters.destination;
    const version: "1" = invocation.specification.skillVersion;
    void destination;
    void version;
    // @ts-expect-error An inspection parameter is not available for this skill.
    void invocation.specification.parameters.sampleCount;
  } else {
    const sampleCount: number = invocation.specification.parameters.sampleCount;
    const version: "2" = invocation.specification.skillVersion;
    void sampleCount;
    void version;
  }
  if (report.event === "SUCCEEDED") {
    if (report.skill === "move_item") {
      const arrived: boolean = report.result.arrived;
      void arrived;
      // @ts-expect-error A move result cannot be interpreted as an inspection result.
      void report.result.observationCount;
    } else {
      const observationCount: number = report.result.observationCount;
      void observationCount;
    }
  }
}
