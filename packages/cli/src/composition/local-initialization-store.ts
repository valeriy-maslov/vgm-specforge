import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type HardGateRuleAuditPayload,
  type InitializationFinding,
  type InitializationScanSummary,
  type InitializationState,
  type InitializationStore,
} from "@specforge/contracts";

const DEFAULT_STATE_FILE = ".specforge/state/initialization.json";
const WRITE_LOCK_TIMEOUT_MS = 2_500;
const WRITE_LOCK_RETRY_DELAY_MS = 20;
const STALE_LOCK_MAX_AGE_MS = 30_000;

export interface LocalInitializationStoreOptions {
  projectRoot: string;
  stateFilePath?: string;
}

export class LocalInitializationStore implements InitializationStore {
  private readonly stateFilePath: string;

  private readonly lockFilePath: string;

  constructor(options: LocalInitializationStoreOptions) {
    this.stateFilePath = resolve(options.projectRoot, options.stateFilePath ?? DEFAULT_STATE_FILE);
    this.lockFilePath = `${this.stateFilePath}.lock`;
  }

  async load(_projectRoot: string): Promise<InitializationState | null> {
    const content = await readTextFileIfExists(this.stateFilePath);
    if (content === null) {
      return null;
    }

    const parsed = JSON.parse(content) as unknown;
    return normalizeState(parsed);
  }

  async save(_projectRoot: string, state: InitializationState): Promise<void> {
    await mkdir(dirname(this.stateFilePath), {
      recursive: true,
    });

    await this.withWriteLock(async () => {
      const tempPath = `${this.stateFilePath}.${randomUUID()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      try {
        await rename(tempPath, this.stateFilePath);
      } catch (error) {
        await removeFileIfExists(tempPath);
        throw error;
      }
    });
  }

  private async withWriteLock(operation: () => Promise<void>): Promise<void> {
    await this.acquireWriteLock();
    try {
      await operation();
    } finally {
      await this.releaseWriteLock();
    }
  }

  private async acquireWriteLock(): Promise<void> {
    const startedAt = Date.now();

    while (true) {
      try {
        const handle = await open(this.lockFilePath, "wx");
        try {
          await handle.writeFile(`${process.pid}:${Date.now()}\n`, "utf8");
        } finally {
          await handle.close();
        }
        return;
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }

        if (await this.isLockFileStale()) {
          await removeFileIfExists(this.lockFilePath);
          continue;
        }

        if (Date.now() - startedAt >= WRITE_LOCK_TIMEOUT_MS) {
          throw new Error(`timed out waiting for initialization state write lock at '${this.lockFilePath}'`);
        }

        await delay(WRITE_LOCK_RETRY_DELAY_MS);
      }
    }
  }

  private async releaseWriteLock(): Promise<void> {
    try {
      await unlink(this.lockFilePath);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  private async isLockFileStale(): Promise<boolean> {
    try {
      const lockStat = await stat(this.lockFilePath);
      return Date.now() - lockStat.mtimeMs > STALE_LOCK_MAX_AGE_MS;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await rm(filePath, {
      force: true,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeState(value: unknown): InitializationState {
  const source = asRecord(value);
  const mode = source.mode;
  const createdArtifacts = normalizeOptionalStringArray(source.createdArtifacts);
  const updatedArtifacts = normalizeOptionalStringArray(source.updatedArtifacts);
  const reconciliationFindings = normalizeOptionalFindings(source.reconciliationFindings);

  return {
    initialized: source.initialized === true,
    mode: mode === "existing" ? "existing" : "new",
    generatedArtifacts: normalizeStringArray(source.generatedArtifacts),
    ...(createdArtifacts !== undefined
      ? {
          createdArtifacts,
        }
      : {}),
    ...(updatedArtifacts !== undefined
      ? {
          updatedArtifacts,
        }
      : {}),
    reconciliationRequired: source.reconciliationRequired === true,
    ...(reconciliationFindings !== undefined
      ? {
          reconciliationFindings,
        }
      : {}),
    ...(typeof source.reconciliationReportPath === "string"
      ? {
          reconciliationReportPath: source.reconciliationReportPath,
        }
      : {}),
    ...(isInitializationScanSummary(source.scanSummary)
      ? {
          scanSummary: source.scanSummary,
        }
      : {}),
    pendingBundledApproval: source.pendingBundledApproval === true,
    ...(typeof source.approvedAt === "string"
      ? {
          approvedAt: source.approvedAt,
        }
      : {}),
    ...(isHardGateRuleAuditPayload(source.lastBundledApprovalAudit)
      ? {
          lastBundledApprovalAudit: source.lastBundledApprovalAudit,
        }
      : {}),
    ...(typeof source.lastBundledApprovalDecisionAt === "string"
      ? {
          lastBundledApprovalDecisionAt: source.lastBundledApprovalDecisionAt,
        }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeStringArray(value);
}

function normalizeOptionalFindings(value: unknown): InitializationFinding[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isInitializationFinding);
}

function isHardGateRuleAuditPayload(value: unknown): value is HardGateRuleAuditPayload {
  if (!isRecord(value)) {
    return false;
  }

  const gate = value.gate;
  const appliedSources = value.appliedSources;
  const effectiveRulesSnapshot = value.effectiveRulesSnapshot;

  if (typeof gate !== "string") {
    return false;
  }

  if (!Array.isArray(appliedSources)) {
    return false;
  }

  if (!isRecord(effectiveRulesSnapshot)) {
    return false;
  }

  return true;
}

function isInitializationFinding(value: unknown): value is InitializationFinding {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.code === "string" && typeof value.message === "string";
}

function isInitializationScanSummary(value: unknown): value is InitializationScanSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.scannedAt === "string" &&
    typeof value.fileCount === "number" &&
    typeof value.sourceFileCount === "number" &&
    typeof value.markdownDocCount === "number"
  );
}
