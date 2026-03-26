import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCliJson } from "./harness.js";
import { createPreparedProject, moveToReadyToComplete, prepareRunAtPlanApproved } from "./workflow-helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: retry hardening", () => {
  it("records sync failure and allows explicit retry path", async () => {
    const projectRoot = await createPreparedProject({
      prefix: "specforge-e2e-retry-failure-",
    });
    tempDirectories.push(projectRoot);

    const run = await prepareRunAtPlanApproved({
      projectRoot,
      title: "Retry failure path",
      prompt: "Fail once and retry",
      workType: "feature",
    });

    await moveToReadyToComplete(projectRoot, run);

    const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;
    const preview = await runCliJson(["complete", "preview", ...runArgs], projectRoot);
    expect(preview.code).toBe(0);
    const approve = await runCliJson(["complete", "approve", ...runArgs, "--approved"], projectRoot);
    expect(approve.code).toBe(0);

    const externalDocs = await mkdtemp(join(tmpdir(), "specforge-e2e-docs-target-"));
    tempDirectories.push(externalDocs);

    await rm(join(projectRoot, "docs"), { recursive: true, force: true });
    await symlink(externalDocs, join(projectRoot, "docs"));

    const failedSync = await runCliJson(["complete", "sync", ...runArgs], projectRoot);
    expect(failedSync.code).toBe(0);
    const failedPayload = failedSync.json as {
      ok: boolean;
      data: {
        state: string;
        result: {
          success: boolean;
          message?: string;
        };
      };
    };
    expect(failedPayload.ok).toBe(true);
    expect(failedPayload.data.state).toBe("ready_to_complete");
    expect(failedPayload.data.result.success).toBe(false);
    expect(String(failedPayload.data.result.message)).toContain("document path traverses a symbolic link");

    await rm(join(projectRoot, "docs"), { recursive: true, force: true });
    await mkdir(join(projectRoot, "docs"), { recursive: true });

    const retrySync = await runCliJson(["complete", "sync", ...runArgs], projectRoot);
    expect(retrySync.code).toBe(0);
    const retryPayload = retrySync.json as {
      ok: boolean;
      data: {
        state: string;
        result: {
          success: boolean;
        };
      };
    };

    expect(retryPayload.ok).toBe(true);
    expect(retryPayload.data.state).toBe("completed");
    expect(retryPayload.data.result.success).toBe(true);

    const audit = await runCliJson(["audit", "query", ...runArgs, "--event-type", "sync_retry_requested"], projectRoot);
    expect(audit.code).toBe(0);
    const auditPayload = audit.json as {
      ok: boolean;
      data: {
        events: unknown[];
      };
    };
    expect(auditPayload.ok).toBe(true);
    expect(auditPayload.data.events.length).toBeGreaterThan(0);
  });
});
