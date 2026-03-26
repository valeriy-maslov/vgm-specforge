import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCliJson } from "./harness.js";
import { createProjectFixture, initializeGitRepository, writeRuntimeConfig } from "./project-fixture.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: feature happy path", () => {
  it("runs workflow from start to completed sync", async () => {
    const projectRoot = await createProjectFixture("specforge-e2e-feature-");
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

    const init = await runCliJson(["init", "--mode", "existing", "--approved", "--project-root", projectRoot], projectRoot);
    expect(init.code).toBe(0);

    const start = await runCliJson(
      [
        "workflow",
        "start",
        "--title",
        "Checkout improvements",
        "--prompt",
        "Improve checkout UX",
        "--project-root",
        projectRoot,
      ],
      projectRoot,
    );

    const started = expectOk(start);
    expect(started.started).toBe(true);
    const run = started.run as {
      key: {
        branchName: string;
        startedAt: string;
      };
      state: string;
    };
    expect(run.state).toBe("intake");

    const commonRunArgs = ["--branch", run.key.branchName, "--started-at", run.key.startedAt, "--project-root", projectRoot] as const;

    expectOk(await runCliJson(["scope", "confirm", ...commonRunArgs, "--section", "sec-checkout"], projectRoot));
    expectOk(await runCliJson(["spec", "draft", ...commonRunArgs], projectRoot));
    expectOk(await runCliJson(["spec", "approve", ...commonRunArgs, "--approved"], projectRoot));
    expectOk(await runCliJson(["plan", "draft", ...commonRunArgs], projectRoot));
    expectOk(await runCliJson(["plan", "approve", ...commonRunArgs, "--approved"], projectRoot));

    const validationRun = expectOk(await runCliJson(["validate", "run", ...commonRunArgs], projectRoot));
    expect(validationRun.state).toBe("validation");

    const validationDecision = expectOk(
      await runCliJson(["validate", "decide", ...commonRunArgs, "--decision", "accepted", "--approved"], projectRoot),
    );
    expect(validationDecision.state).toBe("ready_to_complete");

    const preview = expectOk(await runCliJson(["complete", "preview", ...commonRunArgs], projectRoot));
    expect(Array.isArray(preview.preview.operations)).toBe(true);

    expectOk(await runCliJson(["complete", "approve", ...commonRunArgs, "--approved"], projectRoot));
    const sync = expectOk(await runCliJson(["complete", "sync", ...commonRunArgs], projectRoot));

    expect(sync.state).toBe("completed");
    expect(sync.result.success).toBe(true);

    const rootSpecContent = await readFile(join(projectRoot, "docs/master/root-spec.md"), "utf8");
    expect(rootSpecContent.length).toBeGreaterThan(0);
  });

  it("prevents starting another active workflow on the same branch", async () => {
    const projectRoot = await createProjectFixture("specforge-e2e-one-active-");
    tempDirectories.push(projectRoot);

    await initializeGitRepository(projectRoot);
    await writeRuntimeConfig(projectRoot, {
      audit: {
        driver: "memory",
      },
    });

    await runCliJson(["init", "--mode", "existing", "--approved", "--project-root", projectRoot], projectRoot);

    const first = expectOk(
      await runCliJson(
        [
          "workflow",
          "start",
          "--title",
          "Search",
          "--prompt",
          "Add search",
          "--branch",
          "sf/feature/search",
          "--project-root",
          projectRoot,
        ],
        projectRoot,
      ),
    );
    expect(first.started).toBe(true);

    const second = expectOk(
      await runCliJson(
        [
          "workflow",
          "start",
          "--title",
          "Search again",
          "--prompt",
          "retry",
          "--branch",
          "sf/feature/search",
          "--project-root",
          projectRoot,
        ],
        projectRoot,
      ),
    );

    expect(second.started).toBe(false);
    expect(String(second.message)).toContain("already has an active workflow");
  });
});

function expectOk(result: { code: number; json?: unknown; stdout: string; stderr: string }): any {
  if (result.code !== 0) {
    throw new Error(`command failed with code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const payload = result.json as { ok: boolean; data?: unknown; error?: unknown } | undefined;
  if (payload === undefined || payload.ok !== true) {
    throw new Error(`expected ok JSON result\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return payload.data as any;
}
