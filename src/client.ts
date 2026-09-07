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
import {
  redactSecrets,
  rememberResponse,
  safeRequestId,
  safeDiagnostic,
} from "./response.js";

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
    !/^[\x21-\x7e]+$/.test(apiKey) ||
    apiKey.startsWith("kin_device_") ||
    apiKey.startsWith("sb_secret_")
  ) {
    throw new KinemicaValidationError(
      "apiKey must be a Developer API credential containing visible ASCII characters.",
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
  return url.toString().replace(/\/+$/, "");
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
    const callerSignal = request.options?.signal;
    if (callerSignal?.aborted) {
      throw new KinemicaRequestAbortedError(
        "Kinemica request was aborted by the caller.",
      );
    }
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abortFromCaller = (): void => {
      /* assigned synchronously by Promise executor */
    };
    const cancelled = new Promise<never>((_resolve, reject) => {
      const abort = (error: KinemicaConnectionError): void => {
        if (controller.signal.aborted) return;
        // Settle cancellation before a Fetch implementation rejects during abort.
        reject(error);
        controller.abort();
      };
      timeout = setTimeout(
        () =>
          abort(
            new KinemicaTimeoutError(
              `Kinemica request timed out after ${this.timeoutMs}ms.`,
            ),
          ),
        this.timeoutMs,
      );
      abortFromCaller = () =>
        abort(
          new KinemicaRequestAbortedError(
            "Kinemica request was aborted by the caller.",
          ),
        );
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    });
    try {
      return await Promise.race([
        this.performRequest(request, controller.signal),
        cancelled,
      ]);
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private async performRequest(
    request: HttpRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${request.path}`, {
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
          ? { body: new Uint8Array(request.rawBody) }
          : request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
        redirect: "manual",
        signal,
      });
    } catch {
      throw new KinemicaConnectionError("Kinemica could not be reached.");
    }
    if (signal.aborted) {
      // Dispose of a late response from a custom transport that ignored abort.
      void response.body?.cancel().catch(() => {
        /* best-effort disposal after cancellation */
      });
      throw new KinemicaRequestAbortedError("Kinemica request was aborted.");
    }
    const sensitiveValues = [
      ...(this.#credential ? [this.#credential] : []),
      ...(request.sensitiveValues ?? []),
    ];
    const requestId = safeRequestId(
      response.headers.get("x-kinemica-request-id"),
      sensitiveValues,
    );
    const metadata: KinemicaErrorOptions = {
      status: response.status,
      ...(requestId ? { requestId } : {}),
    };
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new KinemicaConnectionError(
        "Kinemica response could not be read.",
        metadata,
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(text) as unknown;
    } catch {
      if (!response.ok)
        this.throwApiError(
          response.status,
          undefined,
          requestId,
          sensitiveValues,
        );
      throw new KinemicaApiError("Kinemica returned malformed JSON.", metadata);
    }
    if (!response.ok)
      this.throwApiError(response.status, decoded, requestId, sensitiveValues);
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      Array.isArray(decoded)
    ) {
      throw new KinemicaApiError(
        "Kinemica returned an incompatible response envelope.",
        metadata,
      );
    }
    // Redact reflected credentials before parsing public fields. Pairing intentionally
    // returns one new credential, only in data.credential, for explicit secure storage.
    const body = decoded as Record<string, unknown>;
    const data = body.data;
    const pairing =
      request.path === "/devices/pair" &&
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;
    const pairedCredential =
      typeof pairing?.credential === "string" ? pairing.credential : undefined;
    if (pairedCredential && pairing) {
      sensitiveValues.push(pairedCredential);
      pairing.credential = null;
    }
    const sanitized = JSON.parse(
      JSON.stringify(body),
      (_key: string, value: unknown) =>
        typeof value === "string"
          ? redactSecrets(value, sensitiveValues)
          : value,
    ) as Record<string, unknown>;
    if (pairedCredential)
      (sanitized.data as Record<string, unknown>).credential = pairedCredential;
    const bodyRequestId = safeRequestId(sanitized.requestId, sensitiveValues);
    rememberResponse(sanitized, {
      ...metadata,
      ...(bodyRequestId ? { requestId: bodyRequestId } : {}),
    });
    return sanitized;
  }

  private throwApiError(
    status: number,
    body: unknown,
    headerRequestId: string | undefined,
    sensitiveValues: readonly string[],
  ): never {
    const parsed = parseApiError(body);
    const code = parsed?.code ?? "internal_error";
    const ErrorType = errorClass(code, status);
    const safeMessage = parsed?.message
      ? safeDiagnostic(parsed.message, sensitiveValues)
      : `Kinemica request failed with HTTP ${status}.`;
    const requestId =
      safeRequestId(parsed?.requestId, sensitiveValues) ?? headerRequestId;
    const options: KinemicaErrorOptions = {
      status,
      code,
      ...(requestId ? { requestId } : {}),
      ...(parsed?.details
        ? {
            details: parsed.details.map((detail) => ({
              field: safeDiagnostic(detail.field, sensitiveValues),
              message: safeDiagnostic(detail.message, sensitiveValues),
            })),
          }
        : {}),
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
