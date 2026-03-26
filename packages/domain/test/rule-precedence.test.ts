import { describe, expect, it } from "vitest";
import { resolveEffectiveRules, resolveEffectiveRulesWithSource } from "../src/policies/rule-precedence.js";

describe("resolveEffectiveRules", () => {
  it("applies documented precedence prompt > constitution > AGENTS.md > README.md", () => {
    const resolved = resolveEffectiveRules({
      prompt: {
        branchNamingPattern: "x/{workType}/{slug}",
        autoAdvanceHardGates: true,
      },
      constitution: {
        branchNamingPattern: "constitution/{workType}/{slug}",
        autoAdvanceHardGates: false,
        driftStrategy: "rebase-main",
      },
      agentsMd: {
        branchNamingPattern: "agents/{workType}/{slug}",
        allowAutoCancel: true,
      },
      readmeMd: {
        branchNamingPattern: "readme/{workType}/{slug}",
      },
    });

    expect(resolved.branchNamingPattern).toBe("x/{workType}/{slug}");
    expect(resolved.autoAdvanceHardGates).toBe(true);
    expect(resolved.driftStrategy).toBe("rebase-main");
    expect(resolved.allowAutoCancel).toBe(true);
  });

  it("falls back to defaults when no rule source defines a field", () => {
    const resolved = resolveEffectiveRules({
      readmeMd: {
        validationChecks: ["pnpm -r test"],
      },
    });

    expect(resolved.validationChecks).toEqual(["pnpm -r test"]);
    expect(resolved.branchNamingPattern).toBe("sf/{workType}/{slug}");
    expect(resolved.driftStrategy).toBe("merge-main");
    expect(resolved.autoAdvanceHardGates).toBe(false);
    expect(resolved.allowAutoCancel).toBe(false);
    expect(resolved.allowAutoSyncRetry).toBe(false);
  });

  it("returns source metadata for gate auditing", () => {
    const resolved = resolveEffectiveRulesWithSource({
      constitution: {
        allowAutoSyncRetry: true,
      },
      agentsMd: {
        allowAutoCancel: true,
      },
    });

    expect(resolved.allowAutoSyncRetry.source).toBe("constitution");
    expect(resolved.allowAutoCancel.source).toBe("agentsMd");
    expect(resolved.branchNamingPattern.source).toBe("default");
  });
});
