import { readFile, stat } from "node:fs/promises";
import {
  SpecforgeError,
  type DocContent,
  type DocRef,
  type MasterDocStore,
  type SyncChangeSet,
  type SyncOperation,
  type SyncPreview,
  type SyncResult,
} from "@specforge/contracts";
import { AtomicFileWriter } from "./atomic-writer.js";
import { resolvePathWithinRoot } from "./path-safety.js";
import { backfillMissingSectionIds, type BackfillSectionIdsResult } from "./section-id.js";

export interface LocalMarkdownDocStoreOptions {
  rootDir: string;
  writer?: AtomicFileWriter;
}

interface SyncMetadata {
  contents?: Record<string, string>;
}

export class LocalMarkdownDocStore implements MasterDocStore {
  private readonly rootDir: string;

  private readonly writer: AtomicFileWriter;

  constructor(options: LocalMarkdownDocStoreOptions) {
    this.rootDir = options.rootDir;
    this.writer = options.writer ?? new AtomicFileWriter();
  }

  async load(ref: DocRef): Promise<DocContent> {
    const filePath = await this.absolutePath(ref.path);
    try {
      const body = await readFile(filePath, "utf8");
      return {
        ref,
        body,
      };
    } catch (error) {
      throw new SpecforgeError("DOC_STORE_ERROR", `unable to load document '${ref.path}'`, {
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  async planSync(changeSet: SyncChangeSet): Promise<SyncPreview> {
    const operations = sortOperations(changeSet.operations);
    const warnings = await collectWarnings(this.rootDir, operations);

    return {
      run: changeSet.run,
      operations,
      warnings,
    };
  }

  async applySync(changeSet: SyncChangeSet): Promise<SyncResult> {
    const operations = sortOperations(changeSet.operations);
    const metadata = (changeSet.metadata ?? {}) as SyncMetadata;
    const contents = metadata.contents ?? {};

    await this.writer.apply({
      rootDir: this.rootDir,
      operations,
      contentForOperation: async (operation) => {
        const provided = contents[operation.path];
        if (provided !== undefined) {
          return provided;
        }
        return this.defaultContent(operation);
      },
    });

    return {
      run: changeSet.run,
      success: true,
      appliedOperations: operations,
      message: "sync applied",
    };
  }

  async ensureSectionIds(path: string): Promise<BackfillSectionIdsResult> {
    const absolutePath = await this.absolutePath(path);
    const current = await readFile(absolutePath, "utf8");
    const backfilled = backfillMissingSectionIds(current);

    if (backfilled.generated.length > 0) {
      await this.writer.apply({
        rootDir: this.rootDir,
        operations: [
          {
            kind: "update",
            path,
            description: "backfill missing markdown section ids",
          },
        ],
        contentForOperation: async () => backfilled.markdown,
      });
    }

    return backfilled;
  }

  private async absolutePath(relativePath: string): Promise<string> {
    return resolvePathWithinRoot(this.rootDir, relativePath);
  }

  private async defaultContent(operation: SyncOperation): Promise<string> {
    if (operation.kind === "update") {
      const filePath = await this.absolutePath(operation.path);
      if (await pathExists(filePath)) {
        const current = await readFile(filePath, "utf8");
        const marker = `<!-- ${operation.description} -->`;
        if (current.includes(marker)) {
          return current;
        }
        return `${current.trimEnd()}\n\n${marker}\n`;
      }
    }

    const title = operation.path
      .split("/")
      .pop()
      ?.replace(/\.md$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();

    return `# ${title ?? "document"}\n\n<!-- ${operation.description} -->\n`;
  }
}

function sortOperations(operations: ReadonlyArray<SyncOperation>): SyncOperation[] {
  const kindOrder: Record<SyncOperation["kind"], number> = {
    create: 0,
    update: 1,
    delete: 2,
  };

  return [...operations].sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    return kindOrder[left.kind] - kindOrder[right.kind];
  });
}

async function collectWarnings(rootDir: string, operations: ReadonlyArray<SyncOperation>): Promise<string[]> {
  const warnings: string[] = [];

  for (const operation of operations) {
    const filePath = await resolvePathWithinRoot(rootDir, operation.path);
    const exists = await pathExists(filePath);

    if (operation.kind === "delete" && !exists) {
      warnings.push(`delete operation targets missing file: ${operation.path}`);
      continue;
    }

    if (operation.kind === "create" && exists) {
      warnings.push(`create operation targets existing file: ${operation.path}`);
    }
  }

  return warnings;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
