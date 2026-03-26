import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SpecforgeError, type SyncOperation } from "@specforge/contracts";
import { resolvePathWithinRoot } from "./path-safety.js";

interface ExistingFileSnapshot {
  exists: boolean;
  content?: string;
}

export interface AtomicApplyInput {
  rootDir: string;
  operations: ReadonlyArray<SyncOperation>;
  contentForOperation: (operation: SyncOperation) => Promise<string>;
}

export class AtomicFileWriter {
  async apply(input: AtomicApplyInput): Promise<void> {
    const normalizedOperations = await normalizeOperations(input.rootDir, input.operations);
    const snapshots = await snapshotFiles(normalizedOperations);

    try {
      for (const operation of normalizedOperations) {
        if (operation.operation.kind === "delete") {
          await this.applyDelete(operation.absolutePath);
          continue;
        }

        const content = await input.contentForOperation(operation.operation);
        await this.applyWrite(operation.absolutePath, content);
      }
    } catch (error) {
      let rollbackError: unknown;
      try {
        await rollbackSnapshots(snapshots);
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }

      throw new SpecforgeError(
        "DOC_STORE_ERROR",
        rollbackError === undefined
          ? "atomic sync apply failed; rolled back changes"
          : "atomic sync apply failed and rollback did not complete cleanly",
        {
          reason: error instanceof Error ? error.message : "unknown error",
          rollbackReason: rollbackError instanceof Error ? rollbackError.message : undefined,
        },
      );
    }
  }

  private async applyWrite(filePath: string, content: string): Promise<void> {
    await replaceFileAtomically(filePath, content);
  }

  private async applyDelete(filePath: string): Promise<void> {
    if (!(await pathExists(filePath))) {
      return;
    }
    await unlink(filePath);
  }
}

interface NormalizedOperation {
  operation: SyncOperation;
  absolutePath: string;
}

async function normalizeOperations(
  rootDir: string,
  operations: ReadonlyArray<SyncOperation>,
): Promise<NormalizedOperation[]> {
  const normalized: NormalizedOperation[] = [];

  for (const operation of operations) {
    normalized.push({
      operation,
      absolutePath: await resolvePathWithinRoot(rootDir, operation.path),
    });
  }

  return normalized;
}

async function snapshotFiles(operations: ReadonlyArray<NormalizedOperation>): Promise<Map<string, ExistingFileSnapshot>> {
  const snapshots = new Map<string, ExistingFileSnapshot>();

  for (const operation of operations) {
    if (snapshots.has(operation.absolutePath)) {
      continue;
    }

    if (await pathExists(operation.absolutePath)) {
      snapshots.set(operation.absolutePath, {
        exists: true,
        content: await readFile(operation.absolutePath, "utf8"),
      });
      continue;
    }

    snapshots.set(operation.absolutePath, { exists: false });
  }

  return snapshots;
}

async function rollbackSnapshots(snapshots: ReadonlyMap<string, ExistingFileSnapshot>): Promise<void> {
  for (const [filePath, snapshot] of snapshots.entries()) {
    if (!snapshot.exists) {
      if (await pathExists(filePath)) {
        await unlink(filePath);
      }
      continue;
    }

    await replaceFileAtomically(filePath, snapshot.content ?? "");
  }
}

async function replaceFileAtomically(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const tempRoot = await mkdtemp(join(dirname(filePath), ".specforge-docs-atomic-"));
  const tempFilePath = join(tempRoot, "content.tmp");

  try {
    await writeFile(tempFilePath, content, "utf8");
    await rename(tempFilePath, filePath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
