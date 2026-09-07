import { KinemicaApiError, type KinemicaErrorOptions } from "./errors.js";

const metadata = new WeakMap<object, KinemicaErrorOptions>();

export function rememberResponse(
  value: object,
  options: KinemicaErrorOptions,
): void {
  metadata.set(value, options);
}

export function parseResponse<T>(
  value: unknown,
  parser: (value: unknown) => T,
  message: string,
): T {
  try {
    return parser(value);
  } catch {
    throw new KinemicaApiError(
      message,
      value !== null && typeof value === "object"
        ? metadata.get(value)
        : undefined,
    );
  }
}

export function redactSecrets(
  value: string,
  sensitiveValues: readonly string[],
): string {
  let result = value;
  for (const secret of [...sensitiveValues].sort(
    (a, b) => b.length - a.length,
  )) {
    if (secret) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result.replace(
    /(?:kin_(?:device|live|test)_|sb_secret_)[A-Za-z0-9_-]+/g,
    "[REDACTED]",
  );
}

export function safeRequestId(
  value: unknown,
  sensitiveValues: readonly string[],
): string | undefined {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value) &&
    redactSecrets(value, sensitiveValues) === value
    ? value
    : undefined;
}

export function safeDiagnostic(
  value: string,
  sensitiveValues: readonly string[],
): string {
  return Array.from(redactSecrets(value, sensitiveValues), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
}
