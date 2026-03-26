import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEvent, WorkflowRun } from "@specforge/contracts";
import { FileAuditDriver } from "../src/composition/file-audit-driver.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileAuditDriver", () => {
  it("masks secrets at persistence boundary", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-file-audit-"));
    tempDirectories.push(projectRoot);

    const driver = new FileAuditDriver({
      stateFilePath: join(projectRoot, ".specforge/state/audit-memory.json"),
    });
    await driver.connect({});

    const run = sampleRun();
    await driver.saveRun({
      ...run,
      title: "token=abc123",
      metadata: {
        apiKey: "secret-api-key",
        connectionString: "postgres://root:super-secret@localhost/specforge",
        payload: '{"authorization":"Bearer nested-secret"}',
      },
    });

    const event: AuditEvent = {
      id: "evt-1",
      run: run.key,
      type: "workflow_started",
      actor: { kind: "user", id: "ghp_abcdefghijklmnopqrstuvwxyz" },
      createdAt: "2026-03-26T16:00:00.000Z",
      payload: {
        prompt: '{"api_key":"quoted-secret", "token":"abc", "databaseUrl":"postgres://alice:secret@db/specforge"}',
      },
    };
    await driver.append(event);

    const persistedRun = await driver.getRun(run.key);
    const persistedEvents = await driver.query({ run: run.key });

    expect(String(persistedRun?.title)).toContain("token=[REDACTED]");
    expect(persistedRun?.metadata).toMatchObject({
      apiKey: "[REDACTED]",
      connectionString: "[REDACTED]",
    });
    expect(String(persistedRun?.metadata?.payload)).toContain('"authorization":"[REDACTED]"');

    expect(persistedEvents[0]?.actor.id).toBe("[REDACTED]");
    expect(String(persistedEvents[0]?.payload.prompt)).toContain('"api_key":"[REDACTED]"');
    expect(String(persistedEvents[0]?.payload.prompt)).toContain('"databaseUrl":"postgres://[REDACTED]@db/specforge"');
    await driver.close();
  });

  it("serializes concurrent appends without dropping events", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-file-audit-"));
    tempDirectories.push(projectRoot);

    const driver = new FileAuditDriver({
      stateFilePath: join(projectRoot, ".specforge/state/audit-memory.json"),
    });
    await driver.connect({});

    const run = sampleRun();
    await driver.saveRun(run);

    const events = Array.from({ length: 40 }, (_, index) => ({
      id: `evt-${index}`,
      run: run.key,
      type: "scope_proposed" as const,
      actor: { kind: "agent" as const, id: `agent-${index}` },
      createdAt: `2026-03-26T16:00:${String(index).padStart(2, "0")}.000Z`,
      payload: {
        index,
      },
    }));

    await Promise.all(events.map((event) => driver.append(event)));

    const persisted = await driver.query({
      run: run.key,
      limit: 100,
    });
    expect(persisted).toHaveLength(events.length);
    expect(new Set(persisted.map((event) => event.id)).size).toBe(events.length);

    await driver.close();
  });
});

function sampleRun(): WorkflowRun {
  return {
    key: {
      branchName: "sf/feature/file-audit",
      startedAt: "2026-03-26T15:00:00.000Z",
    },
    workType: "feature",
    state: "intake",
    title: "file audit run",
    affectedSectionIds: ["sec-audit"],
    unresolvedFailedGates: [],
    forceCompletionRequested: false,
    createdAt: "2026-03-26T15:00:00.000Z",
    updatedAt: "2026-03-26T15:00:00.000Z",
  };
}
