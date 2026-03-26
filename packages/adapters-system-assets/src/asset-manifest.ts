import { SpecforgeError } from "@specforge/contracts";
import { equalsSha256Hex, sha256Hex } from "./checksum.js";

export const MANAGED_ASSET_MANIFEST_VERSION = 1;

export const MANAGED_ASSET_LAYOUT_ROOTS = ["prompts", "skills", "command-contracts"] as const;

export type ManagedAssetLayoutRoot = (typeof MANAGED_ASSET_LAYOUT_ROOTS)[number];

export interface ManagedAssetManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ManagedAssetManifest {
  schemaVersion: typeof MANAGED_ASSET_MANIFEST_VERSION;
  generatedAt: string;
  files: ManagedAssetManifestEntry[];
}

export interface ManagedAssetBundleVerification {
  missingFiles: string[];
  extraFiles: string[];
  checksumMismatches: string[];
}

export function createManagedAssetManifest(
  files: Record<string, string | Uint8Array>,
  generatedAt = new Date().toISOString(),
): ManagedAssetManifest {
  const manifestEntries = new Map<string, ManagedAssetManifestEntry>();

  for (const [path, content] of Object.entries(files)) {
    const normalizedPath = normalizeManagedAssetPath(path);
    if (manifestEntries.has(normalizedPath)) {
      throw systemAssetError("managed asset manifest contains duplicate file paths", {
        path: normalizedPath,
      });
    }

    const contentBytes = toBytes(content);
    manifestEntries.set(normalizedPath, {
      path: normalizedPath,
      sha256: sha256Hex(contentBytes),
      bytes: contentBytes.byteLength,
    });
  }

  return {
    schemaVersion: MANAGED_ASSET_MANIFEST_VERSION,
    generatedAt: normalizeIsoTimestamp(generatedAt, "generatedAt"),
    files: sortEntries([...manifestEntries.values()]),
  };
}

export function validateManagedAssetManifest(value: unknown): ManagedAssetManifest {
  const source = asRecord(value, "managed asset manifest must be an object");
  const schemaVersion = source.schemaVersion;

  if (schemaVersion !== MANAGED_ASSET_MANIFEST_VERSION) {
    throw systemAssetError("unsupported managed asset manifest version", {
      received: schemaVersion,
      expected: MANAGED_ASSET_MANIFEST_VERSION,
    });
  }

  const generatedAt = normalizeIsoTimestamp(readString(source.generatedAt, "generatedAt"), "generatedAt");

  if (!Array.isArray(source.files)) {
    throw systemAssetError("managed asset manifest 'files' must be an array");
  }

  const files = source.files.map((entry, index) => normalizeManifestEntry(entry, index));
  const deduplicated = new Set<string>();
  for (const file of files) {
    if (deduplicated.has(file.path)) {
      throw systemAssetError("managed asset manifest contains duplicate file paths", {
        path: file.path,
      });
    }
    deduplicated.add(file.path);
  }

  return {
    schemaVersion: MANAGED_ASSET_MANIFEST_VERSION,
    generatedAt,
    files: sortEntries(files),
  };
}

export function verifyManagedAssetBundle(
  manifest: ManagedAssetManifest,
  files: Record<string, string | Uint8Array>,
): ManagedAssetBundleVerification {
  const missingFiles: string[] = [];
  const checksumMismatches: string[] = [];
  const providedFiles = new Map<string, Uint8Array>();

  for (const [path, content] of Object.entries(files)) {
    const normalizedPath = normalizeManagedAssetPath(path);
    if (providedFiles.has(normalizedPath)) {
      throw systemAssetError("managed asset bundle contains duplicate file paths", {
        path: normalizedPath,
      });
    }
    providedFiles.set(normalizedPath, toBytes(content));
  }

  const expectedPaths = new Set<string>();
  for (const file of manifest.files) {
    expectedPaths.add(file.path);
    const providedContent = providedFiles.get(file.path);
    if (providedContent === undefined) {
      missingFiles.push(file.path);
      continue;
    }

    const actualChecksum = sha256Hex(providedContent);
    if (!equalsSha256Hex(file.sha256.toLowerCase(), actualChecksum)) {
      checksumMismatches.push(file.path);
    }
  }

  const extraFiles = [...providedFiles.keys()].filter((path) => !expectedPaths.has(path));

  return {
    missingFiles: missingFiles.sort((left, right) => left.localeCompare(right)),
    extraFiles: extraFiles.sort((left, right) => left.localeCompare(right)),
    checksumMismatches: checksumMismatches.sort((left, right) => left.localeCompare(right)),
  };
}

export function hasBundleVerificationErrors(verification: ManagedAssetBundleVerification): boolean {
  return (
    verification.missingFiles.length > 0 ||
    verification.extraFiles.length > 0 ||
    verification.checksumMismatches.length > 0
  );
}

export function normalizeManagedAssetPath(pathValue: string): string {
  if (pathValue.includes("\u0000")) {
    throw systemAssetError("managed asset path contains invalid null byte", {
      path: pathValue,
    });
  }

  const segments = pathValue
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments.length < 2) {
    throw systemAssetError("managed asset path must include a supported root and file name", {
      path: pathValue,
    });
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw systemAssetError("managed asset path cannot include traversal segments", {
      path: pathValue,
    });
  }

  const root = segments[0];
  if (!isManagedAssetRoot(root)) {
    throw systemAssetError("managed asset path root is not supported", {
      path: pathValue,
      supportedRoots: MANAGED_ASSET_LAYOUT_ROOTS,
    });
  }

  return segments.join("/");
}

function normalizeManifestEntry(value: unknown, index: number): ManagedAssetManifestEntry {
  const source = asRecord(value, "managed asset manifest file entry must be an object", {
    index,
  });

  const path = normalizeManagedAssetPath(readString(source.path, `files[${index}].path`));
  const sha256 = readString(source.sha256, `files[${index}].sha256`).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw systemAssetError("managed asset manifest entry has invalid sha256 checksum", {
      path,
      sha256,
    });
  }

  const bytes = readNumber(source.bytes, `files[${index}].bytes`);
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw systemAssetError("managed asset manifest entry has invalid byte length", {
      path,
      bytes,
    });
  }

  return {
    path,
    sha256,
    bytes,
  };
}

function isManagedAssetRoot(value: string | undefined): value is ManagedAssetLayoutRoot {
  return value !== undefined && MANAGED_ASSET_LAYOUT_ROOTS.includes(value as ManagedAssetLayoutRoot);
}

function toBytes(content: string | Uint8Array): Uint8Array {
  if (typeof content === "string") {
    return Buffer.from(content, "utf8");
  }

  return content;
}

function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw systemAssetError(`managed asset manifest '${fieldName}' must be a valid ISO timestamp`, {
      value,
    });
  }

  return date.toISOString();
}

function sortEntries(entries: ManagedAssetManifestEntry[]): ManagedAssetManifestEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw systemAssetError(`managed asset manifest '${fieldName}' must be a string`, {
      receivedType: typeof value,
    });
  }

  return value;
}

function readNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number") {
    throw systemAssetError(`managed asset manifest '${fieldName}' must be a number`, {
      receivedType: typeof value,
    });
  }

  return value;
}

function asRecord(value: unknown, message: string, details?: Record<string, unknown>): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw systemAssetError(message, details);
}

function systemAssetError(message: string, details?: Record<string, unknown>): SpecforgeError {
  return new SpecforgeError("SYSTEM_ASSET_ERROR", message, details);
}
