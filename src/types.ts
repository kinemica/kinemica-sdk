export type PolicyOutcome = "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL";

export type WorkerType = "AI_AGENT" | "HUMAN" | "ROBOT";

export type WorkStatus =
  | "DRAFT"
  | "PLANNING"
  | "REVIEW"
  | "READY"
  | "ACTIVE"
  | "AWAITING_REVIEW"
  | "BLOCKED"
  | "COMPLETED"
  | "CANCELLED";

export type TaskStatus =
  | "PROPOSED"
  | "BLOCKED"
  | "AWAITING_APPROVAL"
  | "READY"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VERIFIED"
  | "FAILED"
  | "COMPLETED"
  | "CANCELLED";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ApprovalStatus = "REQUESTED" | "GRANTED" | "DENIED" | "EXPIRED";

export type EvidenceVerificationOutcome = "PASS" | "FAIL" | "UNCERTAIN";

export type ExceptionStatus = "OPEN" | "UNDER_REVIEW" | "ESCALATED";

export interface PolicyDecision {
  readonly id: string;
  readonly outcome: PolicyOutcome;
  readonly ruleId: string;
  readonly policyVersion: number;
  readonly action: string;
  readonly reason: string;
  readonly remediation: string | null;
  readonly evaluatedAt: string;
}

export interface WorkerReference {
  readonly id: string;
  readonly name: string;
  readonly type: WorkerType;
}

export interface TaskEvidenceSummary {
  readonly requiredTypes: readonly string[];
  readonly submittedTypes: readonly string[];
  readonly latestVerification: EvidenceVerificationOutcome | null;
  readonly complete: boolean;
}

export interface WorkTask {
  readonly id: string;
  readonly title: string;
  readonly outcome: string;
  readonly status: TaskStatus;
  readonly risk: RiskLevel;
  readonly version: number;
  readonly locationId: string | null;
  readonly permittedActions: readonly string[];
  readonly requiredCapabilityIds: readonly string[];
  readonly assignedWorker: WorkerReference | null;
  readonly policyDecision: PolicyDecision | null;
  readonly approvalStatus: ApprovalStatus | null;
  readonly evidence: TaskEvidenceSummary;
  readonly unresolvedExceptionCount: number;
}

export interface WorkException {
  readonly id: string;
  readonly taskId: string | null;
  readonly type: string;
  readonly severity: RiskLevel;
  readonly status: ExceptionStatus;
  readonly summary: string;
}

export interface WorkCompletion {
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly allEvidencePresent: boolean;
  readonly verified: boolean;
}

export interface Work {
  readonly id: string;
  readonly title: string;
  readonly status: WorkStatus;
  readonly version: number;
  readonly updatedAt: string;
  readonly tasks: readonly WorkTask[];
  readonly unresolvedExceptions: readonly WorkException[];
  readonly completion: WorkCompletion;
}

export interface AuthorizeActionParams {
  readonly workId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly action: "assign_worker";
  readonly idempotencyKey: string;
}

export interface AuthorizationDecision extends PolicyDecision {
  readonly requestId: string;
  readonly replayed: boolean;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export type KinemicaApiErrorCode =
  | "authentication"
  | "validation"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "service_unavailable"
  | "internal_error";

export interface KinemicaValidationDetail {
  readonly field: string;
  readonly message: string;
}
