import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCliJson } from "./harness.js";
import { createProjectFixture, initializeGitRepository, runGit, writeRuntimeConfig } from "./project-fixture.js";
import { createPreparedProject, moveToReadyToComplete, prepareRunAtPlanApproved } from "./workflow-helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: drift and conflict resolution", () => {
  it("detects drift, reports merge conflict, and applies approved resolution", async () => {
    const projectRoot = await createProjectFixture("specforge-e2e-drift-");
    tempDirectories.push(projectRoot);

    await initializeGitRepository(projectRoot);

    const conflictFilePath = join(projectRoot, "conflict.txt");
    await writeFile(conflictFilePath, "base\n", "utf8");
    await runGit(projectRoot, ["add", "conflict.txt"]);
    await runGit(projectRoot, ["commit", "-m", "Add conflict file"]);

    await writeRuntimeConfig(projectRoot, {
      audit: {
        driver: "memory",
      },
    });
    await runCliJson(["init", "--mode", "existing", "--approved", "--project-root", projectRoot], projectRoot);

    const started = expectOk(
      await runCliJson(
        [
          "workflow",
          "start",
          "--title",
          "Drift conflict",
          "--prompt",
          "Handle merge conflict",
          "--project-root",
          projectRoot,
        ],
        projectRoot,
      ),
    );

    const run = started.run as {
      key: {
        branchName: string;
        startedAt: string;
      };
    };

    await writeFile(conflictFilePath, "feature-change\n", "utf8");
    await runGit(projectRoot, ["add", "conflict.txt"]);
    await runGit(projectRoot, ["commit", "-m", "Feature conflict change"]);

    await runGit(projectRoot, ["checkout", "main"]);
    await writeFile(conflictFilePath, "main-change\n", "utf8");
    await runGit(projectRoot, ["add", "conflict.txt"]);
    await runGit(projectRoot, ["commit", "-m", "Main conflict change"]);

    await runGit(projectRoot, ["checkout", run.key.branchName]);

    const runArgs = ["--branch", run.key.branchName, "--started-at", run.key.startedAt, "--project-root", projectRoot] as const;

    const driftCheck = expectOk(await runCliJson(["drift", "check", ...runArgs, "--main-branch", "main"], projectRoot));
    expect(driftCheck.drifted).toBe(true);

    const merge = expectOk(await runCliJson(["drift", "merge-main", ...runArgs, "--main-branch", "main"], projectRoot));
    expect(merge.result.status).toBe("conflict");
    expect(String(merge.proposal?.resolutionPlan)).toContain("conflict.txt");

    const rejected = await runCliJson(["drift", "resolve", ...runArgs, "--rejected"], projectRoot);
    expect(rejected.code).toBe(1);
    const rejectedPayload = rejected.json as {
      ok: boolean;
      error: {
        code: string;
      };
    };
    expect(rejectedPayload.ok).toBe(false);
    expect(rejectedPayload.error.code).toBe("CONFLICT_RESOLUTION_APPROVAL_REQUIRED");

    const resolved = expectOk(
      await runCliJson(
        [
          "drift",
          "resolve",
          ...runArgs,
          "--approved",
        ],
        projectRoot,
      ),
    );
    expect(resolved.resolved).toBe(true);
    expect(String(resolved.resolutionPlan)).toContain("conflict.txt");
  });

  it("requires explicit drift analysis confirmation at pre-implementation checkpoint", async () => {
    const projectRoot = await createPreparedProject({
      prefix: "specforge-e2e-auto-drift-",
    });
    tempDirectories.push(projectRoot);

    const run = await prepareRunAtPlanApproved({
      projectRoot,
      title: "Auto drift check",
      prompt: "Validate with drift checks",
    });

    await runGit(projectRoot, ["checkout", "main"]);
    await writeFile(join(projectRoot, "README.md"), "main drift change\n", "utf8");
    await runGit(projectRoot, ["add", "README.md"]);
    await runGit(projectRoot, ["commit", "-m", "main drift change"]);
    await runGit(projectRoot, ["checkout", run.branchName]);

    const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;

    const denied = await runCliJson(["validate", "run", ...runArgs], projectRoot);
    expect(denied.code).toBe(1);
    const deniedPayload = denied.json as {
      ok: boolean;
      error: {
        code: string;
      };
    };
    expect(deniedPayload.ok).toBe(false);
    expect(deniedPayload.error.code).toBe("DRIFT_CONFIRMATION_REQUIRED");

    const approved = expectOk(
      await runCliJson(["validate", "run", ...runArgs, "--approve-drift-analysis"], projectRoot),
    );
    expect(approved.state).toBe("validation");
  });

  it("requires explicit drift analysis confirmation at pre-completion checkpoint", async () => {
    const projectRoot = await createPreparedProject({
      prefix: "specforge-e2e-auto-drift-complete-",
    });
    tempDirectories.push(projectRoot);

    const run = await prepareRunAtPlanApproved({
      projectRoot,
      title: "Auto drift completion",
      prompt: "Sync with drift checks",
    });
    await moveToReadyToComplete(projectRoot, run);

    await runGit(projectRoot, ["checkout", "main"]);
    await writeFile(join(projectRoot, "README.md"), "main completion drift\n", "utf8");
    await runGit(projectRoot, ["add", "README.md"]);
    await runGit(projectRoot, ["commit", "-m", "main completion drift"]);
    await runGit(projectRoot, ["checkout", run.branchName]);

    const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;
    expectOk(await runCliJson(["complete", "preview", ...runArgs], projectRoot));
    expectOk(await runCliJson(["complete", "approve", ...runArgs, "--approved"], projectRoot));

    const denied = await runCliJson(["complete", "sync", ...runArgs], projectRoot);
    expect(denied.code).toBe(1);
    const deniedPayload = denied.json as {
      ok: boolean;
      error: {
        code: string;
      };
    };
    expect(deniedPayload.ok).toBe(false);
    expect(deniedPayload.error.code).toBe("DRIFT_CONFIRMATION_REQUIRED");

    const approved = expectOk(
      await runCliJson(["complete", "sync", ...runArgs, "--approve-drift-analysis"], projectRoot),
    );
    expect(approved.state).toBe("completed");
  });
});

function expectOk(result: { code: number; json?: unknown; stdout: string; stderr: string }): any {
  if (result.code !== 0) {
    throw new Error(`command failed with code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const payload = result.json as { ok: boolean; data?: unknown } | undefined;
  if (payload === undefined || payload.ok !== true) {
    throw new Error(`expected ok JSON result\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return payload.data as any;
}
