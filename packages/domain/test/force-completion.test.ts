import { describe, expect, it } from "vitest";
import { evaluateForceCompletion, isForceCompletionRequired } from "../src/policies/force-completion.js";

describe("force completion policy", () => {
  it("requires explicit force command when unresolved failed gates exist", () => {
    expect(
      isForceCompletionRequired({
        unresolvedFailedGates: ["integration-tests"],
        explicitForceCommand: false,
      }),
    ).toBe(true);
  });

  it("does not require force command when there are no unresolved failed gates", () => {
    expect(
      isForceCompletionRequired({
        unresolvedFailedGates: [],
        explicitForceCommand: false,
      }),
    ).toBe(false);
  });

  it("allows completion when explicit force command is present", () => {
    const evaluation = evaluateForceCompletion({
      unresolvedFailedGates: ["lint"],
      explicitForceCommand: true,
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.forceCommandRequired).toBe(false);
  });

  it("returns actionable reason when force command is required", () => {
    const evaluation = evaluateForceCompletion({
      unresolvedFailedGates: ["lint", "unit-tests"],
      explicitForceCommand: false,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.forceCommandRequired).toBe(true);
    expect(evaluation.blockedReason).toContain("force completion command is required");
  });
});
