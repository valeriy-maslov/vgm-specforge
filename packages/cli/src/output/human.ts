import type { CliResult } from "@specforge/contracts";
import { maskSensitiveData, maskSensitiveString } from "../security/secret-sanitizer.js";

export function formatHumanResult(result: CliResult<unknown>): string {
  if (result.ok) {
    const lines: string[] = [renderData(result.data)];

    if (result.warnings !== undefined && result.warnings.length > 0) {
      lines.push("");
      lines.push("Warnings:");
      for (const warning of result.warnings) {
        lines.push(`- ${maskSensitiveString(warning)}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  const lines = [`Error (${result.error.code}): ${maskSensitiveString(result.error.message)}`];
  if (result.error.details !== undefined) {
    lines.push(JSON.stringify(maskSensitiveData(result.error.details), null, 2));
  }

  return `${lines.join("\n")}\n`;
}

function renderData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  return JSON.stringify(data, null, 2);
}
