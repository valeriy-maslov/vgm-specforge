import { SpecforgeError } from "@specforge/contracts";
import { describe, expect, it } from "vitest";
import { errorResult, okResult, serializeJsonResult, unknownErrorResult } from "../src/output/json.js";

describe("json output helpers", () => {
  it("serializes successful envelopes", () => {
    const result = okResult({ status: "ok" }, ["watch mode"]);
    const serialized = serializeJsonResult(result);
    const parsed = JSON.parse(serialized) as {
      ok: boolean;
      data: { status: string };
      warnings: string[];
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.data.status).toBe("ok");
    expect(parsed.warnings).toEqual(["watch mode"]);
  });

  it("maps unknown errors into deterministic CLI errors", () => {
    const result = unknownErrorResult(new SpecforgeError("INVALID_TRANSITION", "bad transition", { step: 1 }));

    expect(result).toEqual(
      errorResult("INVALID_TRANSITION", "bad transition", {
        step: 1,
      }),
    );
  });

  it("redacts secrets from error envelopes", () => {
    const result = errorResult("CLI_ERROR", "request failed with token=abc123 postgres://alice:secret@db/specforge", {
      authorization: "Bearer super-secret-token",
      nested: {
        apiKey: "my-api-key",
      },
      connectionString: "postgres://bob:very-secret@db.example/specforge",
      json: '{"api_key":"quoted-secret"}',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CLI_ERROR",
        message: "request failed with token=[REDACTED] postgres://[REDACTED]@db/specforge",
        details: {
          authorization: "[REDACTED]",
          nested: {
            apiKey: "[REDACTED]",
          },
          connectionString: "[REDACTED]",
          json: '{"api_key":"[REDACTED]"}',
        },
      },
    });
  });
});
