import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SpecforgeError } from "@specforge/contracts";
import {
  createManagedAssetManifest,
  hasBundleVerificationErrors,
  normalizeManagedAssetPath,
  type ManagedAssetManifest,
  validateManagedAssetManifest,
  verifyManagedAssetBundle,
} from "./asset-manifest.js";
import { sha256Hex } from "./checksum.js";

const DEFAULT_SYSTEM_DIRECTORY = ".specforge/system";
const MANIFEST_FILE_NAME = "manifest.json";

export interface ManagedAssetBundle {
  manifest: ManagedAssetManifest;
  files: Record<string, string | Uint8Array>;
}

export interface ManagedAssetUpdaterOptions {
  projectRoot: string;
  systemDirectory?: string;
}

export interface ManagedAssetUpdateInput {
  bundle: ManagedAssetBundle;
  dryRun?: boolean;
}

export interface ManagedAssetUpdateResult {
  updatedFiles: string[];
  skippedFiles: string[];
  removedFiles: string[];
}

export class FileSystemAssetUpdater {
  private readonly projectRoot: string;

  private readonly systemDirectory: string;

  constructor(options: ManagedAssetUpdaterOptions) {
    this.projectRoot = options.projectRoot;
    this.systemDirectory = normalizeSystemDirectory(options.systemDirectory ?? DEFAULT_SYSTEM_DIRECTORY);
  }

  async update(input: ManagedAssetUpdateInput): Promise<ManagedAssetUpdateResult> {
    const manifest = validateManagedAssetManifest(input.bundle.manifest);
    const verification = verifyManagedAssetBundle(manifest, input.bundle.files);
    if (hasBundleVerificationErrors(verification)) {
      throw systemAssetError("managed asset bundle does not match manifest", verification);
    }

    const bundleFiles = toBundleFileMap(input.bundle.files);
    const dryRun = input.dryRun ?? false;

    const systemRoot = await this.resolveSystemRoot();
    const existingManifest = await loadManifest(systemRoot);
    const existingManagedFiles = new Set(existingManifest?.files.map((file) => file.path) ?? []);
    const nextManagedFiles = new Set(manifest.files.map((file) => file.path));

    const updatedFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const file of manifest.files) {
      const nextContent = bundleFiles.get(file.path);
      if (nextContent === undefined) {
        throw systemAssetError("managed asset bundle is missing content for a manifest file", {
          path: file.path,
        });
      }

      const targetPath = await resolvePathWithinRoot(systemRoot, file.path);
      const currentChecksum = await checksumIfExists(targetPath);

      if (currentChecksum !== null && currentChecksum === file.sha256) {
        skippedFiles.push(file.path);
        continue;
      }

      updatedFiles.push(file.path);
    }

    const removedFiles: string[] = [];
    for (const existingPath of existingManagedFiles) {
      if (nextManagedFiles.has(existingPath)) {
        continue;
      }

      const targetPath = await resolvePathWithinRoot(systemRoot, existingPath);
      if (!(await fileExists(targetPath))) {
        continue;
      }

      removedFiles.push(existingPath);
    }

    if (!dryRun) {
      await applyManagedUpdateAtomically({
        systemRoot,
        manifest,
        bundleFiles,
        existingManagedFiles,
        nextManagedFiles,
      });
    }

    return {
      updatedFiles: updatedFiles.sort((left, right) => left.localeCompare(right)),
      skippedFiles: skippedFiles.sort((left, right) => left.localeCompare(right)),
      removedFiles: removedFiles.sort((left, right) => left.localeCompare(right)),
    };
  }

  async preview(bundle: ManagedAssetBundle): Promise<ManagedAssetUpdateResult> {
    return this.update({
      bundle,
      dryRun: true,
    });
  }

  private async resolveSystemRoot(): Promise<string> {
    const canonicalProjectRoot = await canonicalRoot(this.projectRoot);
    const candidate = resolve(canonicalProjectRoot, this.systemDirectory);
    const pathRelativeToProjectRoot = relative(canonicalProjectRoot, candidate);
    if (pathRelativeToProjectRoot.startsWith("..") || isAbsolute(pathRelativeToProjectRoot)) {
      throw systemAssetError("system asset directory escapes project root", {
        projectRoot: this.projectRoot,
        systemDirectory: this.systemDirectory,
      });
    }

    return candidate;
  }
}

export function buildManagedAssetBundle(
  files: Record<string, string | Uint8Array>,
  generatedAt?: string,
): ManagedAssetBundle {
  return {
    manifest: createManagedAssetManifest(files, generatedAt),
    files,
  };
}

async function loadManifest(systemRoot: string): Promise<ManagedAssetManifest | null> {
  const manifestPath = join(systemRoot, MANIFEST_FILE_NAME);
  const content = await readTextFileIfExists(manifestPath);
  if (content === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw systemAssetError("managed asset manifest is not valid JSON", {
      manifestPath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }

  try {
    return validateManagedAssetManifest(parsed);
  } catch (error) {
    if (error instanceof SpecforgeError) {
      throw systemAssetError("managed asset manifest is invalid", {
        manifestPath,
        reason: error.message,
        details: error.details,
      });
    }

    throw error;
  }
}

function normalizeSystemDirectory(pathValue: string): string {
  if (isAbsolute(pathValue)) {
    throw systemAssetError("system asset directory must be relative to project root", {
      path: pathValue,
    });
  }

  const segments = pathValue
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.length === 0) {
    throw systemAssetError("system asset directory cannot be empty", {
      path: pathValue,
    });
  }

  if (segments.some((segment) => segment === "..")) {
    throw systemAssetError("system asset directory cannot include traversal segments", {
      path: pathValue,
    });
  }

  return segments.join("/");
}

function toBundleFileMap(files: Record<string, string | Uint8Array>): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();

  for (const [path, content] of Object.entries(files)) {
    const normalizedPath = normalizeManagedAssetPath(path);
    if (result.has(normalizedPath)) {
      throw systemAssetError("managed asset bundle contains duplicate file paths", {
        path: normalizedPath,
      });
    }

    result.set(normalizedPath, toBytes(content));
  }

  return result;
}

function toBytes(content: string | Uint8Array): Uint8Array {
  if (typeof content === "string") {
    return Buffer.from(content, "utf8");
  }

  return content;
}

async function applyManagedUpdateAtomically(args: {
  systemRoot: string;
  manifest: ManagedAssetManifest;
  bundleFiles: ReadonlyMap<string, Uint8Array>;
  existingManagedFiles: ReadonlySet<string>;
  nextManagedFiles: ReadonlySet<string>;
}): Promise<void> {
  const systemRootParent = dirname(args.systemRoot);
  const stagingRoot = `${args.systemRoot}.next-${randomUUID()}`;
  const backupRoot = `${args.systemRoot}.backup-${randomUUID()}`;
  const systemRootExists = await fileExists(args.systemRoot);
  let systemRootMovedToBackup = false;

  await mkdir(systemRootParent, {
    recursive: true,
  });

  if (systemRootExists) {
    await cp(args.systemRoot, stagingRoot, {
      recursive: true,
    });
  } else {
    await mkdir(stagingRoot, {
      recursive: true,
    });
  }

  try {
    for (const file of args.manifest.files) {
      const nextContent = args.bundleFiles.get(file.path);
      if (nextContent === undefined) {
        throw systemAssetError("managed asset bundle is missing content for a manifest file", {
          path: file.path,
        });
      }

      const targetPath = await resolvePathWithinRoot(stagingRoot, file.path);
      await mkdir(dirname(targetPath), {
        recursive: true,
      });
      await writeFile(targetPath, nextContent);
    }

    for (const existingPath of args.existingManagedFiles) {
      if (args.nextManagedFiles.has(existingPath)) {
        continue;
      }

      const targetPath = await resolvePathWithinRoot(stagingRoot, existingPath);
      if (!(await fileExists(targetPath))) {
        continue;
      }

      await unlink(targetPath);
    }

    await writeFile(join(stagingRoot, MANIFEST_FILE_NAME), `${JSON.stringify(args.manifest, null, 2)}\n`, "utf8");

    if (systemRootExists) {
      await rename(args.systemRoot, backupRoot);
      systemRootMovedToBackup = true;

      try {
        await rename(stagingRoot, args.systemRoot);
        systemRootMovedToBackup = false;
      } catch (error) {
        await safeRename(backupRoot, args.systemRoot);
        systemRootMovedToBackup = false;
        throw error;
      }

      await removeDirectoryIfExists(backupRoot);
      return;
    }

    await rename(stagingRoot, args.systemRoot);
  } catch (error) {
    await removeDirectoryIfExists(stagingRoot);

    if (systemRootMovedToBackup) {
      await safeRename(backupRoot, args.systemRoot);
    }

    if (error instanceof SpecforgeError) {
      throw error;
    }

    throw systemAssetError("failed to apply managed asset update atomically", {
      systemRoot: args.systemRoot,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function checksumIfExists(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath);
    return sha256Hex(content);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw systemAssetError("unable to read existing managed asset file", {
      filePath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function safeRename(fromPath: string, toPath: string): Promise<void> {
  try {
    await rename(fromPath, toPath);
  } catch (error) {
    throw systemAssetError("unable to restore managed asset directory", {
      fromPath,
      toPath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function removeDirectoryIfExists(pathValue: string): Promise<void> {
  try {
    await rm(pathValue, {
      recursive: true,
      force: true,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw systemAssetError("unable to clean temporary managed asset directory", {
      path: pathValue,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw systemAssetError("unable to read managed asset manifest", {
      filePath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw systemAssetError("unable to inspect managed asset file", {
      filePath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

async function resolvePathWithinRoot(rootDir: string, relativePath: string): Promise<string> {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (isAbsolute(normalizedPath)) {
    throw systemAssetError("managed asset path must be relative", {
      path: relativePath,
    });
  }

  const root = await canonicalRoot(rootDir);
  const candidate = resolve(root, normalizedPath);
  const pathRelativeToRoot = relative(root, candidate);

  if (pathRelativeToRoot.startsWith("..") || isAbsolute(pathRelativeToRoot)) {
    throw systemAssetError("managed asset path escapes system root", {
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
      throw systemAssetError("managed asset path traverses a symbolic link", {
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
