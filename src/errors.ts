import type {
  KinemicaApiErrorCode,
  KinemicaValidationDetail,
} from "./types.js";

export interface KinemicaErrorOptions {
  readonly status?: number;
  readonly requestId?: string;
  readonly code?: KinemicaApiErrorCode;
  readonly details?: readonly KinemicaValidationDetail[];
}

export class KinemicaError extends Error {
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly code: KinemicaApiErrorCode | undefined;
  readonly details: readonly KinemicaValidationDetail[] | undefined;

  constructor(message: string, options: KinemicaErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = options.status;
    this.requestId = options.requestId;
    this.code = options.code;
    this.details = options.details;
  }
}

export class KinemicaApiError extends KinemicaError {}

export class KinemicaAuthenticationError extends KinemicaApiError {}

export class KinemicaValidationError extends KinemicaApiError {}

export class KinemicaForbiddenError extends KinemicaApiError {}

export class KinemicaNotFoundError extends KinemicaApiError {}

export class KinemicaConflictError extends KinemicaApiError {}

export class KinemicaRateLimitError extends KinemicaApiError {}

export class KinemicaServiceUnavailableError extends KinemicaApiError {}

export class KinemicaConnectionError extends KinemicaError {}

export class KinemicaTimeoutError extends KinemicaConnectionError {}

export class KinemicaRequestAbortedError extends KinemicaConnectionError {}
