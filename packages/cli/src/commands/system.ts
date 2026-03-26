import { resolve } from "node:path";
import { createCommandContext, DefaultSystemService } from "@specforge/application";
import { ManagedSystemAssetsAdapter } from "@specforge/adapters-system-assets";
import type { CliResult, SystemUpdateOutput } from "@specforge/contracts";
import { errorResult, okResult } from "../output/json.js";

export interface ExecuteSystemUpdateOptions {
  cwd: string;
}

export async function executeSystemUpdate(
  args: readonly string[],
  options: ExecuteSystemUpdateOptions,
): Promise<CliResult<SystemUpdateOutput>> {
  const parsed = parseSystemUpdateArgs(args, options.cwd);
  if (!parsed.ok) {
    return parsed.result;
  }

  const adapter = new ManagedSystemAssetsAdapter({
    projectRoot: parsed.projectRoot,
    assetsDir: parsed.assetsDir,
    manifestPath: parsed.manifestPath,
    ...(parsed.systemDirectory !== undefined
      ? {
          systemDirectory: parsed.systemDirectory,
        }
      : {}),
  });

  const service = new DefaultSystemService({
    systemAssetsPort: adapter,
  });

  const context = createCommandContext({
    actor: { kind: "user" },
    cwd: options.cwd,
    projectRoot: parsed.projectRoot,
  });

  const output = await service.updateManagedAssets(
    parsed.dryRun
      ? {
          dryRun: true,
        }
      : {},
    context,
  );

  return okResult(output);
}

function parseSystemUpdateArgs(
  args: readonly string[],
  cwd: string,
):
  | {
      ok: true;
      projectRoot: string;
      assetsDir: string;
      manifestPath: string;
      dryRun: boolean;
      systemDirectory?: string;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let dryRun = false;
  let projectRoot = resolve(cwd);
  let assetsDir: string | undefined;
  let manifestPath: string | undefined;
  let systemDirectory: string | undefined;

  const cursor = [...args];
  while (cursor.length > 0) {
    const token = cursor.shift() as string;

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--project-root") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--project-root requires a value");
      }
      projectRoot = resolve(cwd, value);
      continue;
    }

    if (token === "--assets-dir") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--assets-dir requires a value");
      }
      assetsDir = resolve(cwd, value);
      continue;
    }

    if (token === "--manifest-path") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--manifest-path requires a value");
      }
      manifestPath = resolve(cwd, value);
      continue;
    }

    if (token === "--system-dir") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--system-dir requires a value");
      }
      systemDirectory = value;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for system update`);
  }

  if (assetsDir === undefined) {
    return invalidArguments("--assets-dir is required");
  }

  const resolvedManifestPath = manifestPath ?? resolve(assetsDir, "manifest.json");

  return {
    ok: true,
    projectRoot,
    assetsDir,
    manifestPath: resolvedManifestPath,
    dryRun,
    ...(systemDirectory !== undefined
      ? {
          systemDirectory,
        }
      : {}),
  };
}

function invalidArguments(message: string): {
  ok: false;
  result: CliResult<never>;
} {
  return {
    ok: false,
    result: errorResult("INVALID_ARGUMENTS", message),
  };
}
