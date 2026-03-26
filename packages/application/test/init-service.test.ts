import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultInitService } from "../src/services/init-service.js";
import { InMemoryInitializationStore, InMemoryInitializationWorkspacePort, fixedClock } from "./helpers/in-memory.js";

describe("DefaultInitService", () => {
  it("creates pending bundled approval for new project initialization", async () => {
    const initializationStore = new InMemoryInitializationStore();
    const initializationWorkspace = new InMemoryInitializationWorkspacePort();
    const service = new DefaultInitService({
      initializationStore,
      initializationWorkspace,
      now: fixedClock("2026-03-24T20:00:00.000Z"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.initialize(
      {
        mode: "new",
        projectName: "SpecForge Demo",
      },
      context,
    );

    expect(output.initialized).toBe(false);
    expect(output.pendingBundledApproval).toBe(true);
    expect(output.generatedArtifacts).toEqual(
      expect.arrayContaining(["README.md", "AGENTS.md", "CONSTITUTION.md", "docs/master/root-spec.md"]),
    );
    expect(output.createdArtifacts).toEqual(
      expect.arrayContaining(["README.md", "AGENTS.md", "CONSTITUTION.md", "docs/master/root-spec.md"]),
    );
    expect(output.scanSummary.fileCount).toBe(0);
    expect(initializationWorkspace.calls).toHaveLength(1);
  });

  it("marks initialization complete when bundled approval is granted", async () => {
    const initializationStore = new InMemoryInitializationStore();
    const initializationWorkspace = new InMemoryInitializationWorkspacePort();
    initializationWorkspace.nextOutput = {
      generatedArtifacts: ["CONSTITUTION.md", "docs/master/root-spec.md"],
      createdArtifacts: ["CONSTITUTION.md"],
      updatedArtifacts: ["docs/master/root-spec.md"],
      reconciliationRequired: true,
      reconciliationFindings: [
        {
          code: "missing_root_master_spec",
          message: "existing codebase is missing docs/master/root-spec.md",
        },
      ],
      reconciliationReportPath: ".specforge/reports/initialization-reconciliation.md",
      scanSummary: {
        scannedAt: "2026-03-24T20:10:00.000Z",
        fileCount: 12,
        sourceFileCount: 8,
        markdownDocCount: 2,
      },
    };
    const service = new DefaultInitService({
      initializationStore,
      initializationWorkspace,
      now: fixedClock("2026-03-24T20:10:00.000Z"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.initialize(
      {
        mode: "existing",
        approved: true,
      },
      context,
    );

    expect(output.initialized).toBe(true);
    expect(output.pendingBundledApproval).toBe(false);
    expect(output.reconciliationRequired).toBe(true);
    expect(output.reconciliationFindings).toHaveLength(1);
    expect(output.reconciliationReportPath).toBe(".specforge/reports/initialization-reconciliation.md");

    const stored = await initializationStore.load("/repo");
    expect(stored?.initialized).toBe(true);
    expect(stored?.approvedAt).toBe("2026-03-24T20:10:00.000Z");
    expect(stored?.reconciliationReportPath).toBe(".specforge/reports/initialization-reconciliation.md");
  });
});
