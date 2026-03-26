import { createWorkflowRun } from "@specforge/domain";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultAuditService } from "../src/services/audit-service.js";
import { InMemoryAuditDriver } from "./helpers/in-memory.js";

describe("DefaultAuditService", () => {
  it("queries events from audit driver with filter", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/reports",
        startedAt: "2026-03-24T19:00:00.000Z",
      },
      workType: "feature",
      title: "Reports",
      nowIso: "2026-03-24T19:00:00.000Z",
    });

    await auditDriver.append({
      id: "evt-1",
      run: run.key,
      type: "workflow_started",
      actor: { kind: "user", id: "alice" },
      createdAt: "2026-03-24T19:00:00.000Z",
      payload: {},
    });
    await auditDriver.append({
      id: "evt-2",
      run: run.key,
      type: "scope_proposed",
      actor: { kind: "agent", id: "codex" },
      createdAt: "2026-03-24T19:01:00.000Z",
      payload: {},
    });

    const service = new DefaultAuditService({
      auditDriver,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.query(
      {
        run: run.key,
        eventTypes: ["workflow_started"],
      },
      context,
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("workflow_started");
  });
});
