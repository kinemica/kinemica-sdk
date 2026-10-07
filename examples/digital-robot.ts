import type {
  WorkerExecutionReport,
  WorkerSkillDescriptor,
  WorkerSkillInvocation,
} from "@kinemica/sdk";

// Application-owned schemas/types, not a built-in SDK skill. Named locations are
// commissioned by Platform; they are not coordinates, joints or gripper commands.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a closed mapped-type catalog must not add an open string index signature
export type TransferPartSkills = {
  readonly transfer_part: {
    readonly version: "1";
    readonly parameters: {
      readonly partId: string;
      readonly sourceSlot: string;
      readonly destinationSlot: string;
    };
    readonly result: {
      readonly partId: string;
      readonly sourceSlot: string;
      readonly destinationSlot: string;
      readonly objectState:
        | "AT_DESTINATION"
        | "AT_SOURCE"
        | "MISSING"
        | "UNKNOWN";
    };
  };
};

export const transferPartDescriptor = {
  skill: "transfer_part",
  skillVersion: "1",
  description: "Transfer one identified part between commissioned named slots.",
  parametersSchema: { id: "transfer-part.parameters", version: "1" },
  resultSchema: { id: "transfer-part.result", version: "1" },
  requiredCapabilityIds: ["transfer_part"],
  safetyConstraints: [
    "Only commissioned parts, named slots and configuration are supported.",
    "Controller interlocks and local stopping remain mandatory.",
  ],
  cancellation: "COOPERATIVE",
} as const satisfies WorkerSkillDescriptor<TransferPartSkills>;

/**
 * Pure report formatting AFTER the twin has produced a terminal or uncertain
 * outcome, never for an intermediate progress sample. Does not run
 * a simulator, command a robot, validate untrusted JSON or establish authority.
 *
 * The adapter must separately authenticate/validate the invocation, journal it,
 * reconcile replays and obtain fresh ACK/START receipts before any execution.
 * Current private ARM wire messages require their existing strict codec; do not
 * send these transport-neutral objects directly to that transport.
 */
export function digitalRobotReport(
  invocation: WorkerSkillInvocation<TransferPartSkills>,
  observation: TransferPartSkills["transfer_part"]["result"],
  receipt: {
    readonly expectedVersion: number;
    readonly observedAt: string;
    readonly idempotencyKey: string;
    readonly evidenceIds: readonly string[];
  },
): WorkerExecutionReport<TransferPartSkills> {
  if (invocation.binding.mode !== "SIMULATED") {
    throw new Error("This report example supports the digital twin only.");
  }
  const requested = invocation.specification.parameters;
  if (
    observation.partId !== requested.partId ||
    observation.sourceSlot !== requested.sourceSlot ||
    observation.destinationSlot !== requested.destinationSlot
  ) {
    throw new Error("Twin observation does not match the requested transfer.");
  }
  const common = {
    contractVersion: "kinemica.worker.v1" as const,
    commandId: invocation.commandId,
    attemptId: invocation.attemptId,
    claimId: invocation.claimId,
    specificationHash: invocation.specificationHash,
    correlationId: invocation.correlationId,
    skill: invocation.specification.skill,
    skillVersion: invocation.specification.skillVersion,
    expectedVersion: receipt.expectedVersion,
    observedAt: receipt.observedAt,
    idempotencyKey: receipt.idempotencyKey,
    evidenceIds: [...receipt.evidenceIds],
    // Structural typing permits richer controller objects. Copy only the public
    // result fields; never serialize an entire driver/observation object.
    result: {
      partId: observation.partId,
      sourceSlot: observation.sourceSlot,
      destinationSlot: observation.destinationSlot,
      objectState: observation.objectState,
    },
  };

  switch (observation.objectState) {
    case "AT_DESTINATION":
      return {
        ...common,
        event: "SUCCEEDED",
        summary:
          "Digital twin reports the part at the destination; review remains required.",
      };
    case "AT_SOURCE":
    case "MISSING":
      return {
        ...common,
        event: "BLOCKED",
        summary: "Digital twin did not observe the requested transfer outcome.",
        failure: {
          code: "EXECUTION_FAILED",
          message: "Reconcile the observed part state before any new attempt.",
        },
      };
    case "UNKNOWN":
      return {
        ...common,
        event: "UNKNOWN",
        summary: "Digital twin cannot determine the part state.",
        failure: {
          code: "OUTCOME_UNKNOWN",
          message:
            "Outcome is uncertain; do not automatically repeat execution.",
        },
      };
  }
}
