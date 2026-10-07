/**
 * Transport-neutral integration contracts, NOT a deployed execution API.
 * These types do not validate messages, authenticate a sender or authorize work.
 * See docs/WORKER_CONTRACT.md before implementing a transport or executor.
 */
export type WorkerScalarValue = string | number | boolean | null;

/** JSON only. Runtime boundaries must also reject non-finite numbers and bound size/depth. */
export type WorkerJsonValue =
  | WorkerScalarValue
  | readonly WorkerJsonValue[]
  | { readonly [key: string]: WorkerJsonValue };

export type WorkerJsonObject = Readonly<Record<string, WorkerJsonValue>>;

/** A compile-time skill map; not a registry, runtime validator or capability grant. */
export type WorkerSkillCatalog = Readonly<
  Record<
    string,
    {
      readonly version: string;
      readonly parameters: WorkerJsonObject;
      readonly result: WorkerJsonObject;
    }
  >
>;

/** Immutable identity assigned/commissioned by Platform, never selected by a sensor. */
export interface WorkerExecutionBinding {
  readonly workerId: string;
  readonly connectionId: string;
  readonly mode: "SIMULATED" | "PHYSICAL";
  readonly configurationVersion: string;
}

/** Identifies an agreed, immutable runtime schema. Not a URL to fetch or code to run. */
export interface WorkerSchemaReference {
  readonly id: string;
  readonly version: string;
}

/** Describes support, not permission. Changing a schema requires a new skill version. */
export type WorkerSkillDescriptor<
  Skills extends WorkerSkillCatalog = WorkerSkillCatalog,
> = {
  [Name in keyof Skills & string]: {
    readonly skill: Name;
    readonly skillVersion: Skills[Name]["version"];
    readonly description: string;
    readonly parametersSchema: WorkerSchemaReference;
    readonly resultSchema: WorkerSchemaReference;
    readonly requiredCapabilityIds: readonly string[];
    /** Descriptive limits/interlocks; never client-defined policy or safety certification. */
    readonly safetyConstraints: readonly string[];
    /** Cooperative stop is not an emergency stop or proof of a safe physical state. */
    readonly cancellation: "COOPERATIVE" | "UNSUPPORTED";
  };
}[keyof Skills & string];

/** Server-issued execution identity/fence. Possession of these strings grants no authority. */
export interface WorkerExecutionReference {
  readonly commandId: string;
  readonly attemptId: string;
  readonly claimId: string;
  /** Opaque server-assigned digest; echo exactly, never recompute over a translated message. */
  readonly specificationHash: string;
  readonly correlationId: string;
}

/**
 * A claimed invocation delivered by an authenticated Platform transport AFTER routing,
 * policy and any required human approval. A well-typed object is not permission to execute.
 */
export type WorkerSkillInvocation<
  Skills extends WorkerSkillCatalog = WorkerSkillCatalog,
> = {
  [Name in keyof Skills & string]: WorkerExecutionReference & {
    readonly contractVersion: "kinemica.worker.v1";
    readonly workId: string;
    readonly taskId: string;
    readonly binding: WorkerExecutionBinding;
    readonly specification: {
      readonly skill: Name;
      readonly skillVersion: Skills[Name]["version"];
      readonly parameters: Skills[Name]["parameters"];
    };
    /** Audit reference, NOT a bearer credential or a caller-supplied ALLOW decision. */
    readonly authorizationId: string;
    readonly version: number;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly reportDueAt: string;
    readonly idempotencyKey: string;
  };
}[keyof Skills & string];

/** Execution failures, deliberately separate from HTTP errors and policy outcomes. */
export type WorkerExecutionFailureCode =
  | "INVALID_PARAMETERS"
  | "UNSUPPORTED_SKILL"
  | "CONFIGURATION_MISMATCH"
  | "NOT_READY"
  | "SAFETY_STOP"
  | "EXECUTION_FAILED"
  | "DEADLINE_EXCEEDED"
  | "OUTCOME_UNKNOWN";

export interface WorkerExecutionFailure {
  readonly code: WorkerExecutionFailureCode;
  /** Bounded, non-secret explanation; no raw driver errors, credentials or sensor contents. */
  readonly message: string;
}

type ReportOutcome<Result extends WorkerJsonObject> =
  | {
      readonly event: "ACKNOWLEDGE" | "STARTED";
      readonly result?: never;
      readonly failure?: never;
      readonly telemetry?: never;
      readonly cancellationId?: never;
    }
  | {
      readonly event: "PROGRESS";
      /** Bounded scalar snapshot, not a stream, command channel or authority signal. */
      readonly telemetry: Readonly<Record<string, WorkerScalarValue>>;
      readonly result?: never;
      readonly failure?: never;
      readonly cancellationId?: never;
    }
  | {
      readonly event: "SUCCEEDED";
      /** Executor assertion only; never task verification, human acceptance or job closeout. */
      readonly result: Result;
      readonly failure?: never;
      readonly telemetry?: never;
      readonly cancellationId?: never;
    }
  | {
      readonly event: "BLOCKED";
      readonly failure: WorkerExecutionFailure & {
        readonly code: Exclude<WorkerExecutionFailureCode, "OUTCOME_UNKNOWN">;
      };
      /** Optional factual observations; a failure can still produce evidence. */
      readonly result?: Result;
      readonly telemetry?: never;
      readonly cancellationId?: never;
    }
  | {
      readonly event: "UNKNOWN";
      readonly failure: WorkerExecutionFailure & {
        readonly code: "OUTCOME_UNKNOWN";
      };
      readonly result?: Result;
      readonly telemetry?: never;
      readonly cancellationId?: never;
    }
  | {
      /** Executor confirms it has stopped; not a safety-rated assertion or task completion. */
      readonly event: "STOPPED";
      readonly cancellationId?: string;
      readonly result?: Result;
      readonly failure?: never;
      readonly telemetry?: never;
    };

/**
 * One bounded report, bound by Platform to the immutable invocation and authenticated worker.
 * Runtime validation MUST also match skill/version/result schema to that invocation.
 */
export type WorkerExecutionReport<
  Skills extends WorkerSkillCatalog = WorkerSkillCatalog,
> = {
  [Name in keyof Skills & string]: WorkerExecutionReference & {
    readonly contractVersion: "kinemica.worker.v1";
    readonly skill: Name;
    readonly skillVersion: Skills[Name]["version"];
    readonly expectedVersion: number;
    readonly observedAt: string;
    readonly idempotencyKey: string;
    readonly summary: string;
    /** Opaque Kinemica evidence IDs already authorized for THIS execution, never paths/URLs. */
    readonly evidenceIds: readonly string[];
  } & ReportOutcome<Skills[Name]["result"]>;
}[keyof Skills & string];

/** A Platform request to stop a claimed attempt, not acknowledgement that it has stopped. */
export interface WorkerCancellationRequest extends WorkerExecutionReference {
  readonly contractVersion: "kinemica.worker.v1";
  readonly cancellationId: string;
  readonly issuedAt: string;
  readonly idempotencyKey: string;
  readonly reason: string;
}
