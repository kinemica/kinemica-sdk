import type {
  ApprovalStatus,
  AuthorizationDecision,
  EvidenceVerificationOutcome,
  ExceptionStatus,
  KinemicaApiErrorCode,
  KinemicaValidationDetail,
  PolicyDecision,
  PolicyOutcome,
  RiskLevel,
  TaskStatus,
  Work,
  WorkerReference,
  WorkerType,
  WorkStatus,
} from "./types.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const actionPattern = /^[a-z][a-z0-9_]{1,95}$/;
const ruleIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

const policyOutcomes = ["ALLOW", "BLOCK", "REQUIRE_APPROVAL"] as const;
const workerTypes = ["AI_AGENT", "HUMAN", "ROBOT"] as const;
const workStatuses = [
  "DRAFT",
  "PLANNING",
  "REVIEW",
  "READY",
  "ACTIVE",
  "AWAITING_REVIEW",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;
const taskStatuses = [
  "PROPOSED",
  "BLOCKED",
  "AWAITING_APPROVAL",
  "READY",
  "DISPATCHED",
  "IN_PROGRESS",
  "SUBMITTED",
  "VERIFIED",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
] as const;
const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const approvalStatuses = ["REQUESTED", "GRANTED", "DENIED", "EXPIRED"] as const;
const verificationOutcomes = ["PASS", "FAIL", "UNCERTAIN"] as const;
const exceptionStatuses = ["OPEN", "UNDER_REVIEW", "ESCALATED"] as const;
const apiErrorCodes = [
  "authentication",
  "validation",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "service_unavailable",
  "internal_error",
] as const;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function boundedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const result = string(value, label);
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`${label} has an incompatible length.`);
  }
  return result;
}

function identifier(value: unknown, label: string): string {
  const result = string(value, label);
  if (!identifierPattern.test(result))
    throw new Error(`${label} is not a valid identifier.`);
  return result;
}

function action(value: unknown, label: string): string {
  const result = string(value, label);
  if (!actionPattern.test(result))
    throw new Error(`${label} is not a valid action.`);
  return result;
}

function enumeration<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${label} contains an unsupported value.`);
  }
  return value as T[number];
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result === 0) throw new Error(`${label} must be positive.`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`${label} must be a boolean.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      result,
    )
  ) {
    throw new Error(`${label} must be an ISO 8601 timestamp.`);
  }
  return result;
}

function nullable<T>(
  value: unknown,
  parse: (candidate: unknown) => T,
): T | null {
  return value === null ? null : parse(value);
}

function array<T>(
  value: unknown,
  label: string,
  parse: (candidate: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map(parse);
}

function stringArray(
  value: unknown,
  label: string,
  maximumLength: number,
): string[] {
  return array(value, label, (candidate, index) =>
    boundedString(candidate, `${label}[${index}]`, 1, maximumLength),
  );
}

function parsePolicyDecision(value: unknown, label: string): PolicyDecision {
  const record = object(value, label);
  const ruleId = string(record.ruleId, `${label}.ruleId`);
  if (!ruleIdPattern.test(ruleId))
    throw new Error(`${label}.ruleId is invalid.`);
  return {
    id: identifier(record.id, `${label}.id`),
    outcome: enumeration(
      record.outcome,
      policyOutcomes,
      `${label}.outcome`,
    ) as PolicyOutcome,
    ruleId,
    policyVersion: positiveInteger(
      record.policyVersion,
      `${label}.policyVersion`,
    ),
    action: action(record.action, `${label}.action`),
    reason: boundedString(record.reason, `${label}.reason`, 1, 2_000),
    remediation: nullable(record.remediation, (candidate) =>
      boundedString(candidate, `${label}.remediation`, 0, 2_000),
    ),
    evaluatedAt: timestamp(record.evaluatedAt, `${label}.evaluatedAt`),
  };
}

function parseWorker(value: unknown, label: string): WorkerReference {
  const record = object(value, label);
  return {
    id: identifier(record.id, `${label}.id`),
    name: boundedString(record.name, `${label}.name`, 1, 160),
    type: enumeration(record.type, workerTypes, `${label}.type`) as WorkerType,
  };
}

export function parseWorkResponse(value: unknown): Work {
  const envelope = object(value, "response");
  identifier(envelope.requestId, "response.requestId");
  const record = object(envelope.data, "response.data");
  return {
    id: identifier(record.id, "response.data.id"),
    title: boundedString(record.title, "response.data.title", 1, 160),
    status: enumeration(
      record.status,
      workStatuses,
      "response.data.status",
    ) as WorkStatus,
    version: integer(record.version, "response.data.version"),
    updatedAt: timestamp(record.updatedAt, "response.data.updatedAt"),
    tasks: array(record.tasks, "response.data.tasks", (candidate, index) => {
      const label = `response.data.tasks[${index}]`;
      const task = object(candidate, label);
      const evidence = object(task.evidence, `${label}.evidence`);
      return {
        id: identifier(task.id, `${label}.id`),
        title: boundedString(task.title, `${label}.title`, 1, 160),
        outcome: boundedString(task.outcome, `${label}.outcome`, 1, 4_000),
        status: enumeration(
          task.status,
          taskStatuses,
          `${label}.status`,
        ) as TaskStatus,
        risk: enumeration(task.risk, riskLevels, `${label}.risk`) as RiskLevel,
        version: integer(task.version, `${label}.version`),
        locationId: nullable(task.locationId, (value) =>
          identifier(value, `${label}.locationId`),
        ),
        permittedActions: stringArray(
          task.permittedActions,
          `${label}.permittedActions`,
          96,
        ),
        requiredCapabilityIds: array(
          task.requiredCapabilityIds,
          `${label}.requiredCapabilityIds`,
          (value, capabilityIndex) =>
            identifier(
              value,
              `${label}.requiredCapabilityIds[${capabilityIndex}]`,
            ),
        ),
        assignedWorker: nullable(task.assignedWorker, (value) =>
          parseWorker(value, `${label}.assignedWorker`),
        ),
        policyDecision: nullable(task.policyDecision, (value) =>
          parsePolicyDecision(value, `${label}.policyDecision`),
        ),
        approvalStatus: nullable(
          task.approvalStatus,
          (value) =>
            enumeration(
              value,
              approvalStatuses,
              `${label}.approvalStatus`,
            ) as ApprovalStatus,
        ),
        evidence: {
          requiredTypes: stringArray(
            evidence.requiredTypes,
            `${label}.evidence.requiredTypes`,
            64,
          ),
          submittedTypes: stringArray(
            evidence.submittedTypes,
            `${label}.evidence.submittedTypes`,
            64,
          ),
          latestVerification: nullable(
            evidence.latestVerification,
            (value) =>
              enumeration(
                value,
                verificationOutcomes,
                `${label}.evidence.latestVerification`,
              ) as EvidenceVerificationOutcome,
          ),
          complete: boolean(evidence.complete, `${label}.evidence.complete`),
        },
        unresolvedExceptionCount: integer(
          task.unresolvedExceptionCount,
          `${label}.unresolvedExceptionCount`,
        ),
      };
    }),
    unresolvedExceptions: array(
      record.unresolvedExceptions,
      "response.data.unresolvedExceptions",
      (candidate, index) => {
        const label = `response.data.unresolvedExceptions[${index}]`;
        const exception = object(candidate, label);
        return {
          id: identifier(exception.id, `${label}.id`),
          taskId: nullable(exception.taskId, (value) =>
            identifier(value, `${label}.taskId`),
          ),
          type: action(exception.type, `${label}.type`),
          severity: enumeration(
            exception.severity,
            riskLevels,
            `${label}.severity`,
          ) as RiskLevel,
          status: enumeration(
            exception.status,
            exceptionStatuses,
            `${label}.status`,
          ) as ExceptionStatus,
          summary: boundedString(
            exception.summary,
            `${label}.summary`,
            1,
            4_000,
          ),
        };
      },
    ),
    completion: (() => {
      const completion = object(record.completion, "response.data.completion");
      return {
        completedTasks: integer(
          completion.completedTasks,
          "response.data.completion.completedTasks",
        ),
        totalTasks: integer(
          completion.totalTasks,
          "response.data.completion.totalTasks",
        ),
        allEvidencePresent: boolean(
          completion.allEvidencePresent,
          "response.data.completion.allEvidencePresent",
        ),
        verified: boolean(
          completion.verified,
          "response.data.completion.verified",
        ),
      };
    })(),
  };
}

export function parseAuthorizationResponse(
  value: unknown,
): AuthorizationDecision {
  const envelope = object(value, "response");
  return {
    ...parsePolicyDecision(envelope.data, "response.data"),
    requestId: identifier(envelope.requestId, "response.requestId"),
    replayed: boolean(envelope.replayed, "response.replayed"),
  };
}

export interface ParsedApiError {
  readonly code: KinemicaApiErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly details?: readonly KinemicaValidationDetail[];
}

export function parseApiError(value: unknown): ParsedApiError | undefined {
  try {
    const envelope = object(value, "response");
    const error = object(envelope.error, "response.error");
    const details =
      error.details === undefined
        ? undefined
        : array(error.details, "response.error.details", (candidate, index) => {
            const detail = object(
              candidate,
              `response.error.details[${index}]`,
            );
            return {
              field: boundedString(
                detail.field,
                `response.error.details[${index}].field`,
                1,
                96,
              ),
              message: boundedString(
                detail.message,
                `response.error.details[${index}].message`,
                1,
                160,
              ),
            };
          });
    return {
      code: enumeration(
        error.code,
        apiErrorCodes,
        "response.error.code",
      ) as KinemicaApiErrorCode,
      message: boundedString(error.message, "response.error.message", 1, 240),
      requestId: identifier(error.requestId, "response.error.requestId"),
      ...(details ? { details } : {}),
    };
  } catch {
    return undefined;
  }
}

export function validateIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`${label} is invalid.`);
}

export function validateIdempotencyKey(value: string): void {
  if (
    value !== value.trim() ||
    value.length < 8 ||
    value.length > 96 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error("idempotencyKey is invalid.");
  }
}
