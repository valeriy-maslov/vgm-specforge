import { describe, expect, it } from "vitest";
import { formatHumanResult } from "../src/output/human.js";

describe("human output formatter", () => {
  it("renders success payloads", () => {
    const output = formatHumanResult({
      ok: true,
      data: {
        updatedFiles: ["prompts/start.md"],
      },
      warnings: ["dry run", "connection string: postgres://alice:secret@db/specforge"],
    });

    expect(output).toContain("updatedFiles");
    expect(output).toContain("Warnings:");
    expect(output).toContain("dry run");
    expect(output).not.toContain("alice:secret");
    expect(output).toContain("postgres://[REDACTED]@db/specforge");
  });

  it("renders error payloads", () => {
    const output = formatHumanResult({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "todo",
        details: {
          action: "start",
        },
      },
    });

    expect(output).toContain("Error (NOT_IMPLEMENTED): todo");
    expect(output).toContain("\"action\": \"start\"");
  });

  it("redacts secrets from error messages and details", () => {
    const output = formatHumanResult({
      ok: false,
      error: {
        code: "CLI_ERROR",
        message:
          "request failed with token=abc123 and authorization: Bearer super-secret postgres://alice:db-pass@db.example/specforge",
        details: {
          apiKey: "quoted-api-key",
          connectionString: "postgres://service:very-secret@db.internal/specforge",
          payload: '{"authorization":"Bearer quoted-token"}',
        },
      },
    });

    expect(output).toContain("token=[REDACTED]");
    expect(output).not.toContain("super-secret");
    expect(output).toContain("postgres://[REDACTED]@db.example/specforge");
    expect(output).toContain("\"apiKey\": \"[REDACTED]\"");
    expect(output).toContain('"connectionString": "[REDACTED]"');
    expect(output).toContain('"payload": "{\\"authorization\\":\\"[REDACTED]\\"}"');
  });
});
