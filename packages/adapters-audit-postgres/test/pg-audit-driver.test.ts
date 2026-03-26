import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { AuditEvent, WorkflowRun } from "@specforge/contracts";
import { PgAuditDriver } from "../src/pg-audit-driver.js";

describe("PgAuditDriver", () => {
  it("runs migrations and persists masked audit events", async () => {
    const db = await newDb().adapters.createPgPromise();
    const driver = new PgAuditDriver({ database: db });

    await driver.connect({ schema: "public" });

    const run = sampleRun();
    await driver.saveRun(run);

    const event: AuditEvent = {
      id: "evt-1",
      run: run.key,
      type: "workflow_started",
      actor: { kind: "user", id: "alice" },
      createdAt: "2026-03-25T10:00:00.000Z",
      payload: {
        prompt:
          "authorization: Bearer super-secret-token api_key=123456 postgres://alice:very-secret@db.example/specforge {\"api_key\":\"quoted-secret\",\"authorization\":\"Bearer abc.xyz.jwt\"}",
        access_key: "A-SECRET-ACCESS-KEY",
        private_key: "A-SECRET-PRIVATE-KEY",
      },
    };
    await driver.append(event);

    const events = await driver.query({ run: run.key });
    expect(events).toHaveLength(1);
    const payload = String(events[0]?.payload.prompt);
    expect(payload).toContain("authorization: [REDACTED]");
    expect(payload).not.toContain("super-secret-token");
    expect(payload).not.toContain("very-secret");
    expect(payload).toContain("postgres://[REDACTED]@db.example/specforge");
    expect(payload).toContain("api_key=[REDACTED]");
    expect(payload).toContain('"api_key":"[REDACTED]"');
    expect(payload).toContain('"authorization":"[REDACTED]"');
    expect(events[0]?.payload.access_key).toBe("[REDACTED]");
    expect(events[0]?.payload.private_key).toBe("[REDACTED]");
  });

  it("saves and loads workflow runs with upsert behavior", async () => {
    const db = await newDb().adapters.createPgPromise();
    const driver = new PgAuditDriver({ database: db });

    await driver.connect({ schema: "public" });

    const run = sampleRun();
    await driver.saveRun(run);

    const updated: WorkflowRun = {
      ...run,
      state: "validation",
      unresolvedFailedGates: ["pnpm -r test"],
      updatedAt: "2026-03-25T11:00:00.000Z",
      metadata: {
        notes: "token=abcdef",
      },
    };
    await driver.saveRun(updated);

    const loaded = await driver.getRun(run.key);
    expect(loaded).not.toBeNull();
    expect(loaded?.state).toBe("validation");
    expect(loaded?.unresolvedFailedGates).toEqual(["pnpm -r test"]);
    expect(String(loaded?.metadata?.notes)).toContain("token=[REDACTED]");
  });

  it("supports event queries by type and time range", async () => {
    const db = await newDb().adapters.createPgPromise();
    const driver = new PgAuditDriver({ database: db });

    await driver.connect({ schema: "public" });

    const run = sampleRun();
    await driver.saveRun(run);

    await driver.append({
      id: "evt-a",
      run: run.key,
      type: "spec_generated",
      actor: { kind: "agent", id: "codex" },
      createdAt: "2026-03-25T12:00:00.000Z",
      payload: { stage: "draft" },
    });
    await driver.append({
      id: "evt-b",
      run: run.key,
      type: "spec_approved",
      actor: { kind: "user", id: "alice" },
      createdAt: "2026-03-25T12:05:00.000Z",
      payload: { approved: true },
    });

    const filtered = await driver.query({
      eventTypes: ["spec_approved"],
      fromIso: "2026-03-25T12:01:00.000Z",
      toIso: "2026-03-25T12:10:00.000Z",
      limit: 10,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.type).toBe("spec_approved");
  });

  it("maps raw database errors to deterministic audit driver errors", async () => {
    const db = {
      none: async () => {
        throw new Error("duplicate key value violates unique constraint");
      },
      oneOrNone: async () => null,
      manyOrNone: async () => [],
    };

    const driver = new PgAuditDriver({ database: db });
    await driver.connect({ schema: "public", runMigrations: false });

    await expect(driver.saveRun(sampleRun())).rejects.toMatchObject({
      code: "AUDIT_DRIVER_ERROR",
      message: "postgres audit driver operation failed: saveRun",
      details: {
        operation: "saveRun",
        reason: "duplicate key value violates unique constraint",
      },
    });
  });
});

function sampleRun(): WorkflowRun {
  return {
    key: {
      branchName: "sf/feature/audit-driver",
      startedAt: "2026-03-25T09:00:00.000Z",
    },
    workType: "feature",
    state: "intake",
    title: "Audit Driver",
    affectedSectionIds: ["sec-audit"],
    unresolvedFailedGates: [],
    forceCompletionRequested: false,
    createdAt: "2026-03-25T09:00:00.000Z",
    updatedAt: "2026-03-25T09:00:00.000Z",
  };
}
