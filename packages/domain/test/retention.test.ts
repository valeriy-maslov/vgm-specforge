import { describe, expect, it } from "vitest";
import { createWorkflowRun } from "../src/models/workflow-run.js";
import { buildCancellationRetentionRecord, decideCompletionRetention } from "../src/policies/retention.js";

function now(step: number): string {
  return `2026-03-24T12:${step.toString().padStart(2, "0")}:00.000Z`;
}

describe("retention policy", () => {
  it("defaults completed runs to history-only retention", () => {
    const decision = decideCompletionRetention({
      keepArtifactsExplicitlyRequested: false,
    });

    expect(decision.retainArtifacts).toBe(false);
    expect(decision.mode).toBe("history-only");
  });

  it("keeps artifacts when explicitly requested", () => {
    const decision = decideCompletionRetention({
      keepArtifactsExplicitlyRequested: true,
    });

    expect(decision.retainArtifacts).toBe(true);
    expect(decision.mode).toBe("keep-artifacts");
  });

  it("produces minimal cancellation metadata payload", () => {
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refactor/http-cache",
        startedAt: now(0),
      },
      workType: "refactor",
      title: "Cache cleanup",
      nowIso: now(0),
      affectedSectionIds: ["arch-cache", "impl-cache"],
    });

    const record = buildCancellationRetentionRecord({
      run: {
        ...run,
        state: "implementing",
      },
      initiator: { kind: "user", id: "alice" },
      cancelledAt: now(5),
      cancellationReason: "postponed",
      branchHeadSha: "abc123",
      branchExists: true,
    });

    expect(record.branch_name).toBe("sf/refactor/http-cache");
    expect(record.work_type).toBe("refactor");
    expect(record.cancellation_reason).toBe("postponed");
    expect(record.affected_section_ids).toEqual(["arch-cache", "impl-cache"]);
    expect(record.branch_head_sha).toBe("abc123");
    expect(record.branch_exists).toBe(true);
  });
});
