import { KinemicaApiError, KinemicaValidationError } from "./errors.js";
import type { KinemicaHttpClient } from "./client.js";
import type {
  AuthorizationDecision,
  AuthorizeActionParams,
  RequestOptions,
} from "./types.js";
import {
  parseAuthorizationResponse,
  validateIdempotencyKey,
  validateIdentifier,
} from "./validation.js";

export class ActionsResource {
  constructor(private readonly client: KinemicaHttpClient) {}

  async authorize(
    params: AuthorizeActionParams,
    options?: RequestOptions,
  ): Promise<AuthorizationDecision> {
    try {
      validateIdentifier(params.workId, "workId");
      validateIdentifier(params.taskId, "taskId");
      validateIdentifier(params.workerId, "workerId");
      validateIdempotencyKey(params.idempotencyKey);
      if ((params as { readonly action: unknown }).action !== "assign_worker")
        throw new Error("Unsupported action.");
    } catch {
      throw new KinemicaValidationError(
        "The authorization request is invalid.",
      );
    }
    const response = await this.client.request({
      method: "POST",
      path: "/actions/authorize",
      headers: { "Idempotency-Key": params.idempotencyKey },
      body: {
        workId: params.workId,
        taskId: params.taskId,
        workerId: params.workerId,
        action: params.action,
      },
      ...(options ? { options } : {}),
    });
    try {
      return parseAuthorizationResponse(response);
    } catch {
      throw new KinemicaApiError(
        "Kinemica returned an incompatible authorization response.",
      );
    }
  }
}
