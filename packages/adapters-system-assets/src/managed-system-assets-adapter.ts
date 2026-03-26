import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  SpecforgeError,
  type SystemAssetsPort,
  type SystemAssetsUpdateInput,
  type SystemAssetsUpdateResult,
} from "@specforge/contracts";
import {
  normalizeManagedAssetPath,
  validateManagedAssetManifest,
  type ManagedAssetManifest,
} from "./asset-manifest.js";
import { FileSystemAssetUpdater } from "./asset-updater.js";

export interface ManagedSystemAssetsAdapterOptions {
  projectRoot: string;
  assetsDir: string;
  manifestPath: string;
  systemDirectory?: string;
}

export class ManagedSystemAssetsAdapter implements SystemAssetsPort {
  private readonly projectRoot: string;

  private readonly assetsDir: string;

  private readonly manifestPath: string;

  private readonly systemDirectory: string | undefined;

  constructor(options: ManagedSystemAssetsAdapterOptions) {
    this.projectRoot = options.projectRoot;
    this.assetsDir = options.assetsDir;
    this.manifestPath = options.manifestPath;
    this.systemDirectory = options.systemDirectory;
  }

  async update(input: SystemAssetsUpdateInput): Promise<SystemAssetsUpdateResult> {
    const manifest = await loadManifest(this.manifestPath);
    const files = await loadBundleFiles(this.assetsDir, manifest);

    const updater = new FileSystemAssetUpdater({
      projectRoot: this.projectRoot,
      ...(this.systemDirectory !== undefined
        ? {
            systemDirectory: this.systemDirectory,
          }
        : {}),
    });

    return updater.update(
      input.dryRun === undefined
        ? {
            bundle: {
              manifest,
              files,
            },
          }
        : {
            bundle: {
              manifest,
              files,
            },
            dryRun: input.dryRun,
          },
    );
  }
}

async function loadManifest(manifestPath: string): Promise<ManagedAssetManifest> {
  let content: string;
  try {
    content = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw systemAssetError("unable to read managed assets manifest", {
      manifestPath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw systemAssetError("managed assets manifest is not valid JSON", {
      manifestPath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }

  try {
    return validateManagedAssetManifest(parsed);
  } catch (error) {
    if (error instanceof SpecforgeError) {
      throw systemAssetError("managed assets manifest is invalid", {
        manifestPath,
        reason: error.message,
        details: error.details,
      });
    }

    throw error;
  }
}

async function loadBundleFiles(
  assetsDir: string,
  manifest: ManagedAssetManifest,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};

  for (const entry of manifest.files) {
    const normalizedPath = normalizeManagedAssetPath(entry.path);
    const absolutePath = await resolvePathWithinRoot(assetsDir, normalizedPath);

    try {
      files[normalizedPath] = await readFile(absolutePath);
    } catch (error) {
      throw systemAssetError("unable to read managed asset source file", {
        path: normalizedPath,
        absolutePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return files;
}

async function resolvePathWithinRoot(rootDir: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) {
    throw systemAssetError("managed asset source path must be relative", {
      path: relativePath,
    });
  }

  const root = await canonicalRoot(rootDir);
  const candidate = resolve(root, relativePath);
  const pathRelativeToRoot = relative(root, candidate);

  if (pathRelativeToRoot.startsWith("..") || isAbsolute(pathRelativeToRoot)) {
    throw systemAssetError("managed asset source path escapes asset root", {
      path: relativePath,
    });
  }

  await assertNoSymlinkTraversal(root, candidate, relativePath);
  return candidate;
}

async function canonicalRoot(rootDir: string): Promise<string> {
  try {
    return await realpath(rootDir);
  } catch {
    return resolve(rootDir);
  }
}

async function assertNoSymlinkTraversal(root: string, candidate: string, relativePath: string): Promise<void> {
  const relativePathFromRoot = relative(root, candidate);
  if (relativePathFromRoot.length === 0) {
    return;
  }

  const parts = relativePathFromRoot.split(sep).filter((part) => part.length > 0);
  let currentPath = root;

  for (const part of parts) {
    currentPath = join(currentPath, part);

    const statResult = await safeLstat(currentPath);
    if (statResult === null) {
      return;
    }

    if (statResult.isSymbolicLink()) {
      throw systemAssetError("managed asset source path traverses a symbolic link", {
        path: relativePath,
      });
    }
  }
}

async function safeLstat(pathValue: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(pathValue);
  } catch {
    return null;
  }
}

function systemAssetError(message: string, details?: unknown): SpecforgeError {
  return new SpecforgeError("SYSTEM_ASSET_ERROR", message, details);
}
