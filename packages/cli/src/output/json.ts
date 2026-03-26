import { SpecforgeError, type CliResult } from "@specforge/contracts";
import { maskSensitiveData, maskSensitiveString } from "../security/secret-sanitizer.js";

export function okResult<TData>(data: TData, warnings?: string[]): CliResult<TData> {
  if (warnings !== undefined && warnings.length > 0) {
    return {
      ok: true,
      data,
      warnings,
    };
  }

  return {
    ok: true,
    data,
  };
}

export function errorResult(code: string, message: string, details?: unknown): CliResult<never> {
  const sanitizedMessage = maskSensitiveString(message);
  const sanitizedDetails = details === undefined ? undefined : maskSensitiveData(details);

  return {
    ok: false,
    error: {
      code,
      message: sanitizedMessage,
      ...(sanitizedDetails !== undefined
        ? {
            details: sanitizedDetails,
          }
        : {}),
    },
  };
}

export function unknownErrorResult(error: unknown): CliResult<never> {
  if (error instanceof SpecforgeError) {
    return errorResult(error.code, error.message, error.details);
  }

  if (error instanceof Error) {
    return errorResult("CLI_ERROR", error.message);
  }

  return errorResult("CLI_ERROR", "unknown CLI error");
}

export function serializeJsonResult(result: CliResult<unknown>): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
