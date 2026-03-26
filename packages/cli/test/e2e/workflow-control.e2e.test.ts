import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { runCliJson } from "./harness.js";
import { createProjectFixture, initializeGitRepository, writeRuntimeConfig } from "./project-fixture.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: control paths", () => {
  it("supports validation rework loop", async () => {
    const projectRoot = await createPreparedProject("specforge-e2e-rework-");
    const run = await prepareRunAtPlanApproved(projectRoot, "Rework Flow", "Rework checkout");

    const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;

    expectOk(await runCliJson(["validate", "run", ...runArgs], projectRoot));

    const changesRequested = expectOk(
      await runCliJson(
        [
          "validate",
          "decide",
          ...runArgs,
          "--decision",
          "changes_requested",
          "--approved",
          "--unresolved-failed-gate",
          "pnpm -r test",
        ],
        projectRoot,
      ),
    );
    expect(changesRequested.state).toBe("rework");

    const rerun = expectOk(await runCliJson(["validate", "run", ...runArgs], projectRoot));
    expect(rerun.state).toBe("validation");

    const accepted = expectOk(
      await runCliJson(["validate", "decide", ...runArgs, "--decision", "accepted", "--approved"], projectRoot),
    );
    expect(accepted.state).toBe("ready_to_complete");
  });

  it("completes successfully through explicit force completion path", async () => {
    const projectRoot = await createPreparedProject("specforge-e2e-force-");
    const run = await prepareRunAtPlanApproved(projectRoot, "Force Flow", "Force checkout");

    const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;

    expectOk(await runCliJson(["validate", "run", ...runArgs], projectRoot));

    const accepted = expectOk(
      await runCliJson(
        [
          "validate",
          "decide",
          ...runArgs,
          "--decision",
          "accepted",
          "--approved",
          "--unresolved-failed-gate",
          "pnpm -r test",
        ],
        projectRoot,
      ),
    );
    expect(accepted.state).toBe("ready_to_complete");

    const forced = expectOk(
      await runCliJson(
        [
          "complete",
          "force",
          ...runArgs,
          "--reason",
          "Known flaky test accepted for this run",
          "--approved-by",
          "alice",
        ],
        projectRoot,
      ),
    );
    expect(forced.requested).toBe(true);

    const preview = expectOk(await runCliJson(["complete", "preview", ...runArgs], projectRoot));
    expect(preview.preview.forceCompletionContext).toBeDefined();

    expectOk(await runCliJson(["complete", "approve", ...runArgs, "--approved"], projectRoot));
    const sync = expectOk(await runCliJson(["complete", "sync", ...runArgs], projectRoot));

    expect(sync.state).toBe("completed");
    expect(sync.result.success).toBe(true);
  });

  it("cancels workflow and retains minimal cancellation metadata", async () => {
    const projectRoot = await createPreparedProject("specforge-e2e-cancel-");

    const started = expectOk(
      await runCliJson(
        [
          "workflow",
          "start",
          "--title",
          "Cancel path",
          "--prompt",
          "Cancel this run",
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
    const runArgs = ["--branch", run.key.branchName, "--started-at", run.key.startedAt, "--project-root", projectRoot] as const;

    const cancelled = expectOk(
      await runCliJson(
        ["workflow", "cancel", ...runArgs, "--reason", "de-scoped by user"],
        projectRoot,
      ),
    );

    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.run.state).toBe("cancelled");
    expect(cancelled.run.title).toBe("cancelled-workflow");
    expect(cancelled.run.metadata.cancellationRetention.cancellation_reason).toBe("de-scoped by user");
  });
});

async function createPreparedProject(prefix: string): Promise<string> {
  const projectRoot = await createProjectFixture(prefix);
  tempDirectories.push(projectRoot);

  await initializeGitRepository(projectRoot);
  await writeRuntimeConfig(projectRoot, {
    audit: {
      driver: "memory",
    },
    docsStore: {
      provider: "local-md",
      rootDir: ".",
    },
  });
  await runCliJson(["init", "--mode", "existing", "--approved", "--project-root", projectRoot], projectRoot);

  return projectRoot;
}

async function prepareRunAtPlanApproved(
  projectRoot: string,
  title: string,
  prompt: string,
): Promise<{ branchName: string; startedAt: string }> {
  const started = expectOk(
    await runCliJson(
      [
        "workflow",
        "start",
        "--title",
        title,
        "--prompt",
        prompt,
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

  const runArgs = ["--branch", run.key.branchName, "--started-at", run.key.startedAt, "--project-root", projectRoot] as const;
  expectOk(await runCliJson(["scope", "confirm", ...runArgs, "--section", "sec-core"], projectRoot));
  expectOk(await runCliJson(["spec", "draft", ...runArgs], projectRoot));
  expectOk(await runCliJson(["spec", "approve", ...runArgs, "--approved"], projectRoot));
  expectOk(await runCliJson(["plan", "draft", ...runArgs], projectRoot));
  expectOk(await runCliJson(["plan", "approve", ...runArgs, "--approved"], projectRoot));

  return run.key;
}

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
