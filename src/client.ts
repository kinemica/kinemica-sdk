import {
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
  type KinemicaErrorOptions,
} from "./errors.js";
import { ActionsResource } from "./actions.js";
import { parseApiError } from "./validation.js";
import { WorkResource } from "./work.js";
import type { KinemicaApiErrorCode, RequestOptions } from "./types.js";

const defaultTimeoutMs = 10_000;
const maximumTimeoutMs = 300_000;
const productionBaseUrl = "https://app.kinemica.com/api/v1";

export interface KinemicaOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface KinemicaTransportOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly rawBody?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  readonly options?: RequestOptions;
  readonly sensitiveValues?: readonly string[];
}

export interface KinemicaHttpClient {
  request(request: HttpRequest): Promise<unknown>;
}

function validateApiKey(apiKey: string): string {
  if (
    typeof apiKey !== "string" ||
    apiKey.trim().length === 0 ||
    /\s/.test(apiKey)
  ) {
    throw new KinemicaValidationError(
      "apiKey must be a non-empty credential without whitespace.",
    );
  }
  return apiKey;
}

function validateBaseUrl(baseUrl: string | undefined): string {
  const configuredBaseUrl = baseUrl ?? productionBaseUrl;
  if (
    typeof configuredBaseUrl !== "string" ||
    configuredBaseUrl.trim().length === 0
  ) {
    throw new KinemicaValidationError("baseUrl must be a non-empty URL.");
  }
  let url: URL;
  try {
    url = new URL(configuredBaseUrl);
  } catch {
    throw new KinemicaValidationError("baseUrl must be a valid absolute URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new KinemicaValidationError(
      "baseUrl must not contain credentials, a query string, or a fragment.",
    );
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && localHostnames.has(url.hostname))
  ) {
    throw new KinemicaValidationError(
      "baseUrl must use HTTPS except for explicit local use.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function validateTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? defaultTimeoutMs;
  if (!Number.isInteger(value) || value < 1 || value > maximumTimeoutMs) {
    throw new KinemicaValidationError(
      "timeoutMs must be an integer from 1 to 300000.",
    );
  }
  return value;
}

function errorClass(
  code: KinemicaApiErrorCode,
  status: number,
): typeof KinemicaApiError {
  if (code === "authentication" || status === 401)
    return KinemicaAuthenticationError;
  if (code === "validation" || status === 400) return KinemicaValidationError;
  if (code === "forbidden" || status === 403) return KinemicaForbiddenError;
  if (code === "not_found" || status === 404) return KinemicaNotFoundError;
  if (code === "conflict" || status === 409) return KinemicaConflictError;
  if (code === "rate_limited" || status === 429) return KinemicaRateLimitError;
  if (code === "service_unavailable" || status === 503) {
    return KinemicaServiceUnavailableError;
  }
  return KinemicaApiError;
}

export class HttpClient implements KinemicaHttpClient {
  readonly #credential: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: KinemicaTransportOptions, credential?: string) {
    this.#credential = credential;
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.timeoutMs = validateTimeout(options.timeoutMs);
    if (options.fetch !== undefined && typeof options.fetch !== "function") {
      throw new KinemicaValidationError(
        "fetch must be a function when supplied.",
      );
    }
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new KinemicaValidationError(
        "A Fetch API implementation is required.",
      );
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async request(request: HttpRequest): Promise<unknown> {
    const controller = new AbortController();
    const timeoutReason = Symbol("kinemica-timeout");
    const callerAbortReason = Symbol("kinemica-caller-abort");
    const timeout = setTimeout(() => {
      controller.abort(timeoutReason);
    }, this.timeoutMs);
    const callerSignal = request.options?.signal;
    const abortFromCaller = (): void => controller.abort(callerAbortReason);
    if (callerSignal?.aborted) controller.abort(callerAbortReason);
    else
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await this.fetch(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          ...(this.#credential
            ? { Authorization: `Bearer ${this.#credential}` }
            : {}),
          ...(request.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...request.headers,
        },
        ...(request.rawBody !== undefined
          ? { body: request.rawBody as BodyInit }
          : request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
        redirect: "manual",
        signal: controller.signal,
      });
      const requestId =
        response.headers.get("x-kinemica-request-id") ?? undefined;
      let decoded: unknown;
      try {
        decoded = await response.json();
      } catch {
        throw new KinemicaApiError("Kinemica returned malformed JSON.", {
          status: response.status,
          ...(requestId ? { requestId } : {}),
        });
      }
      if (!response.ok) {
        this.throwApiError(
          response.status,
          decoded,
          requestId,
          request.sensitiveValues,
        );
      }
      return decoded;
    } catch (error) {
      if (error instanceof KinemicaApiError) throw error;
      if (controller.signal.reason === timeoutReason) {
        throw new KinemicaTimeoutError(
          `Kinemica request timed out after ${this.timeoutMs}ms.`,
        );
      }
      if (controller.signal.reason === callerAbortReason) {
        throw new KinemicaRequestAbortedError(
          "Kinemica request was aborted by the caller.",
        );
      }
      throw new KinemicaConnectionError("Kinemica could not be reached.");
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private throwApiError(
    status: number,
    body: unknown,
    headerRequestId: string | undefined,
    requestSensitiveValues: readonly string[] | undefined,
  ): never {
    const parsed = parseApiError(body);
    const code = parsed?.code ?? "internal_error";
    const ErrorType = errorClass(code, status);
    const sensitiveValues = [
      ...(this.#credential ? [this.#credential] : []),
      ...(requestSensitiveValues ?? []),
    ];
    const safeMessage = parsed?.message
      ? sensitiveValues.reduce(
          (message, sensitiveValue) =>
            sensitiveValue
              ? message.replaceAll(sensitiveValue, "[REDACTED]")
              : message,
          parsed.message,
        )
      : `Kinemica request failed with HTTP ${status}.`;
    const requestId = parsed?.requestId ?? headerRequestId;
    const options: KinemicaErrorOptions = {
      status,
      code,
      ...(requestId ? { requestId } : {}),
      ...(parsed?.details ? { details: parsed.details } : {}),
    };
    throw new ErrorType(safeMessage, options);
  }
}

export class Kinemica {
  readonly work: WorkResource;
  readonly actions: ActionsResource;

  constructor(options: KinemicaOptions) {
    const client = new HttpClient(options, validateApiKey(options.apiKey));
    this.work = new WorkResource(client);
    this.actions = new ActionsResource(client);
  }
}
