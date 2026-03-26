import type { WorkflowRun } from "@specforge/contracts";
import { describe, expect, it } from "vitest";
import {
  canStartWorkflowOnBranch,
  generateWorkflowBranchName,
  hasActiveWorkflowOnBranch,
  renderBranchName,
  sanitizeBranchSlug,
  workflowRunIdentity,
} from "../src/policies/branch-identity.js";

function run(args: Partial<WorkflowRun> & { branch: string }): WorkflowRun {
  return {
    key: {
      branchName: args.branch,
      startedAt: "2026-03-24T13:00:00.000Z",
    },
    workType: "feature",
    state: "intake",
    title: "demo",
    affectedSectionIds: [],
    unresolvedFailedGates: [],
    forceCompletionRequested: false,
    createdAt: "2026-03-24T13:00:00.000Z",
    updatedAt: "2026-03-24T13:00:00.000Z",
    ...args,
  };
}

describe("branch identity policy", () => {
  it("uses branch + timestamp as workflow identity", () => {
    expect(
      workflowRunIdentity({
        branchName: "sf/feature/notifications",
        startedAt: "2026-03-24T09:00:00.000Z",
      }),
    ).toBe("sf/feature/notifications::2026-03-24T09:00:00.000Z");
  });

  it("detects active workflow collisions on a branch", () => {
    const runs = [
      run({ branch: "sf/feature/notifications", state: "plan_drafting" }),
      run({ branch: "sf/feature/other", state: "completed" }),
    ];

    expect(hasActiveWorkflowOnBranch({ branchName: "sf/feature/notifications", runs })).toBe(true);
    expect(canStartWorkflowOnBranch({ branchName: "sf/feature/notifications", runs }).allowed).toBe(false);
  });

  it("allows branch reuse after previous run is terminal", () => {
    const runs = [run({ branch: "sf/feature/notifications", state: "completed" })];
    const decision = canStartWorkflowOnBranch({ branchName: "sf/feature/notifications", runs });
    expect(decision.allowed).toBe(true);
  });

  it("generates default names and appends collision suffixes", () => {
    const existing = ["sf/feature/new-api", "sf/feature/new-api-2"];
    const branch = generateWorkflowBranchName({
      workType: "feature",
      slug: "New API",
      existingBranches: existing,
    });
    expect(branch).toBe("sf/feature/new-api-3");
  });

  it("supports pattern override with placeholders", () => {
    const branch = generateWorkflowBranchName({
      workType: "refinement",
      slug: "Checkout Scope",
      existingBranches: [],
      branchNamingPattern: "team/{workType}/{slug}",
    });
    expect(branch).toBe("team/refinement/checkout-scope");

    expect(renderBranchName({ pattern: "", workType: "feature", slug: "x" })).toBe("sf/feature/x");
  });

  it("normalizes branch slug values", () => {
    expect(sanitizeBranchSlug(" Add   Billing! ")).toBe("add-billing");
    expect(sanitizeBranchSlug("***")).toBe("work");
  });
});
