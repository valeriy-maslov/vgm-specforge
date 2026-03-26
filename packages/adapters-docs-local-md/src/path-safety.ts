import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { SpecforgeError } from "@specforge/contracts";

export async function resolvePathWithinRoot(rootDir: string, relativePath: string): Promise<string> {
  const normalizedPath = normalize(relativePath);
  if (isAbsolute(normalizedPath)) {
    throw new SpecforgeError("DOC_STORE_ERROR", "document path must be relative", {
      path: relativePath,
    });
  }

  const root = await canonicalRoot(rootDir);
  const candidate = resolve(root, normalizedPath);
  const pathRelativeToRoot = relative(root, candidate);

  if (pathRelativeToRoot.startsWith("..") || isAbsolute(pathRelativeToRoot)) {
    throw new SpecforgeError("DOC_STORE_ERROR", "document path escapes repository root", {
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
      throw new SpecforgeError("DOC_STORE_ERROR", "document path traverses a symbolic link", {
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
