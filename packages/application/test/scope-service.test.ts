import { createWorkflowRun } from "@specforge/domain";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultScopeService } from "../src/services/scope-service.js";
import { InMemoryAuditDriver, createEventSequence, fixedClock } from "./helpers/in-memory.js";

describe("DefaultScopeService", () => {
  it("proposes scope ids and emits scope_proposed", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/orders",
        startedAt: "2026-03-24T15:00:00.000Z",
      },
      workType: "feature",
      title: "Orders",
      nowIso: "2026-03-24T15:00:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultScopeService({
      auditDriver,
      now: fixedClock("2026-03-24T15:01:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-scope",
    });

    const output = await service.analyze(
      {
        run: run.key,
        strictSectionIds: ["sec-order-api", "sec-order-ui"],
      },
      context,
    );

    expect(output.proposedSectionIds).toEqual(["sec-order-api", "sec-order-ui"]);
    expect(output.affectedAreas).toEqual(["order api", "order ui"]);

    expect(auditDriver.events).toHaveLength(1);
    expect(auditDriver.events[0]?.type).toBe("scope_proposed");
  });

  it("confirms scope and transitions run to scope_confirmed", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/notifications",
        startedAt: "2026-03-24T15:10:00.000Z",
      },
      workType: "feature",
      title: "Notifications",
      nowIso: "2026-03-24T15:10:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultScopeService({
      auditDriver,
      now: fixedClock("2026-03-24T15:11:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.confirm(
      {
        run: run.key,
        sectionIds: ["sec-notifications", "sec-inbox"],
      },
      context,
    );

    expect(output.state).toBe("scope_confirmed");
    expect(output.confirmedSectionIds).toEqual(["sec-notifications", "sec-inbox"]);

    const savedRun = await auditDriver.getRun(run.key);
    expect(savedRun?.state).toBe("scope_confirmed");
    expect(auditDriver.events.some((event) => event.type === "scope_confirmed")).toBe(true);
  });
});
