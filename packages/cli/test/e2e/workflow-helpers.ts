import { runCliJson } from "./harness.js";
import { createProjectFixture, initializeGitRepository, writeRuntimeConfig } from "./project-fixture.js";

export async function createPreparedProject(options: {
  prefix: string;
  config?: Record<string, unknown>;
}): Promise<string> {
  const projectRoot = await createProjectFixture(options.prefix);
  await initializeGitRepository(projectRoot);

  await writeRuntimeConfig(projectRoot, {
    audit: {
      driver: "memory",
    },
    docsStore: {
      provider: "local-md",
      rootDir: ".",
    },
    ...(options.config ?? {}),
  });

  expectOk(await runCliJson(["init", "--mode", "existing", "--approved", "--project-root", projectRoot], projectRoot));

  return projectRoot;
}

export async function prepareRunAtPlanApproved(args: {
  projectRoot: string;
  title: string;
  prompt: string;
  workType?: "feature" | "refinement" | "refactor";
  sectionId?: string;
}): Promise<{ branchName: string; startedAt: string; workType: string }> {
  const started = expectOk(
    await runCliJson(
      [
        "workflow",
        "start",
        "--title",
        args.title,
        "--prompt",
        args.prompt,
        ...(args.workType !== undefined
          ? ["--work-type", args.workType]
          : []),
        "--project-root",
        args.projectRoot,
      ],
      args.projectRoot,
    ),
  );

  const run = started.run as {
    key: {
      branchName: string;
      startedAt: string;
    };
    workType: string;
  };

  const runArgs = ["--branch", run.key.branchName, "--started-at", run.key.startedAt, "--project-root", args.projectRoot] as const;

  expectOk(await runCliJson(["scope", "confirm", ...runArgs, "--section", args.sectionId ?? "sec-core"], args.projectRoot));
  expectOk(await runCliJson(["spec", "draft", ...runArgs], args.projectRoot));
  expectOk(await runCliJson(["spec", "approve", ...runArgs, "--approved"], args.projectRoot));
  expectOk(await runCliJson(["plan", "draft", ...runArgs], args.projectRoot));
  expectOk(await runCliJson(["plan", "approve", ...runArgs, "--approved"], args.projectRoot));

  return {
    branchName: run.key.branchName,
    startedAt: run.key.startedAt,
    workType: run.workType,
  };
}

export async function moveToReadyToComplete(projectRoot: string, run: { branchName: string; startedAt: string }): Promise<void> {
  const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;

  expectOk(await runCliJson(["validate", "run", ...runArgs], projectRoot));
  expectOk(await runCliJson(["validate", "decide", ...runArgs, "--decision", "accepted", "--approved"], projectRoot));
}

export async function previewApproveAndSync(
  projectRoot: string,
  run: { branchName: string; startedAt: string },
  extraSyncArgs: string[] = [],
): Promise<{
  preview: any;
  sync: any;
}> {
  const runArgs = ["--branch", run.branchName, "--started-at", run.startedAt, "--project-root", projectRoot] as const;

  const preview = expectOk(await runCliJson(["complete", "preview", ...runArgs], projectRoot));
  expectOk(await runCliJson(["complete", "approve", ...runArgs, "--approved"], projectRoot));
  const sync = expectOk(await runCliJson(["complete", "sync", ...runArgs, ...extraSyncArgs], projectRoot));

  return {
    preview,
    sync,
  };
}

export function expectOk(result: { code: number; json?: unknown; stdout: string; stderr: string }): any {
  if (result.code !== 0) {
    throw new Error(`command failed with code ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const payload = result.json as { ok: boolean; data?: unknown } | undefined;
  if (payload === undefined || payload.ok !== true) {
    throw new Error(`expected ok JSON result\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return payload.data as any;
}
