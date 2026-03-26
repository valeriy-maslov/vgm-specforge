import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SpecforgeError,
  type AuditDriver,
  type AuditEvent,
  type AuditQuery,
  type WorkflowRun,
  type WorkflowRunKey,
} from "@specforge/contracts";
import { maskSensitiveData, maskSensitiveString } from "../security/secret-sanitizer.js";

interface FileAuditState {
  runs: Record<string, WorkflowRun>;
  events: AuditEvent[];
}

const EMPTY_STATE: FileAuditState = {
  runs: {},
  events: [],
};

const WRITE_LOCK_TIMEOUT_MS = 2_500;
const WRITE_LOCK_RETRY_DELAY_MS = 20;
const STALE_LOCK_MAX_AGE_MS = 30_000;

export interface FileAuditDriverOptions {
  stateFilePath: string;
}

export class FileAuditDriver implements AuditDriver {
  private readonly stateFilePath: string;

  private readonly lockFilePath: string;

  private connected = false;

  constructor(options: FileAuditDriverOptions) {
    this.stateFilePath = options.stateFilePath;
    this.lockFilePath = `${options.stateFilePath}.lock`;
  }

  async connect(_config: unknown): Promise<void> {
    await mkdir(dirname(this.stateFilePath), {
      recursive: true,
    });

    await this.ensureStateFile();
    this.connected = true;
  }

  async append(event: AuditEvent): Promise<void> {
    await this.withLockedState(async (state) => {
      state.events.push(clone(maskAuditEvent(event)));
    });
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    const state = await this.loadState();
    const filtered = state.events.filter((event) => {
      if (filter.run !== undefined) {
        if (event.run.branchName !== filter.run.branchName || event.run.startedAt !== filter.run.startedAt) {
          return false;
        }
      }

      if (filter.branchName !== undefined && event.run.branchName !== filter.branchName) {
        return false;
      }

      if (filter.eventTypes !== undefined && filter.eventTypes.length > 0 && !filter.eventTypes.includes(event.type)) {
        return false;
      }

      if (filter.fromIso !== undefined && event.createdAt < filter.fromIso) {
        return false;
      }

      if (filter.toIso !== undefined && event.createdAt > filter.toIso) {
        return false;
      }

      return true;
    });

    const sorted = filtered.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const limit = Math.max(1, Math.min(filter.limit ?? 500, 10_000));

    return sorted.slice(0, limit).map((event) => clone(event));
  }

  async getRun(run: WorkflowRunKey): Promise<WorkflowRun | null> {
    const state = await this.loadState();
    const saved = state.runs[runIdentity(run)];
    return saved === undefined ? null : clone(saved);
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    await this.withLockedState(async (state) => {
      state.runs[runIdentity(run.key)] = clone(maskRun(run));
    });
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  private async ensureStateFile(): Promise<void> {
    await this.withWriteLock(async () => {
      try {
        await readFile(this.stateFilePath, "utf8");
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw fileAuditError("unable to initialize file audit state", {
            stateFilePath: this.stateFilePath,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }

        await this.saveState(clone(EMPTY_STATE));
      }
    });
  }

  private async loadState(): Promise<FileAuditState> {
    if (!this.connected) {
      throw fileAuditError("file audit driver is not connected", {
        stateFilePath: this.stateFilePath,
      });
    }

    return this.readStateFromDisk();
  }

  private async readStateFromDisk(): Promise<FileAuditState> {
    let content: string;
    try {
      content = await readFile(this.stateFilePath, "utf8");
    } catch (error) {
      throw fileAuditError("unable to read file audit state", {
        stateFilePath: this.stateFilePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      throw fileAuditError("file audit state is invalid JSON", {
        stateFilePath: this.stateFilePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }

    return normalizeState(parsed);
  }

  private async withLockedState(mutator: (state: FileAuditState) => Promise<void> | void): Promise<void> {
    if (!this.connected) {
      throw fileAuditError("file audit driver is not connected", {
        stateFilePath: this.stateFilePath,
      });
    }

    await this.withWriteLock(async () => {
      const state = await this.readStateFromDisk();
      await mutator(state);
      await this.saveState(state);
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
          throw fileAuditError("unable to acquire file audit lock", {
            stateFilePath: this.stateFilePath,
            lockFilePath: this.lockFilePath,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }

        if (await this.isLockFileStale()) {
          await removeFileIfExists(this.lockFilePath);
          continue;
        }

        if (Date.now() - startedAt >= WRITE_LOCK_TIMEOUT_MS) {
          throw fileAuditError("timed out waiting for file audit lock", {
            stateFilePath: this.stateFilePath,
            lockFilePath: this.lockFilePath,
            timeoutMs: WRITE_LOCK_TIMEOUT_MS,
          });
        }

        await delay(WRITE_LOCK_RETRY_DELAY_MS);
      }
    }
  }

  private async releaseWriteLock(): Promise<void> {
    try {
      await unlink(this.lockFilePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      throw fileAuditError("unable to release file audit lock", {
        stateFilePath: this.stateFilePath,
        lockFilePath: this.lockFilePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  private async isLockFileStale(): Promise<boolean> {
    try {
      const lockStat = await stat(this.lockFilePath);
      return Date.now() - lockStat.mtimeMs > STALE_LOCK_MAX_AGE_MS;
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }

      throw fileAuditError("unable to read file audit state", {
        stateFilePath: this.stateFilePath,
        lockFilePath: this.lockFilePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  private async saveState(state: FileAuditState): Promise<void> {
    const tempPath = `${this.stateFilePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    try {
      await rename(tempPath, this.stateFilePath);
    } catch (error) {
      await removeFileIfExists(tempPath);
      throw fileAuditError("unable to write file audit state", {
        stateFilePath: this.stateFilePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
}

function maskAuditEvent(event: AuditEvent): AuditEvent {
  const actor = event.actor.id === undefined
    ? event.actor
    : {
        ...event.actor,
        id: maskSensitiveString(event.actor.id),
      };

  return {
    ...event,
    actor,
    payload: maskSensitiveData(event.payload),
  };
}

function maskRun(run: WorkflowRun): WorkflowRun {
  const metadata = run.metadata === undefined ? undefined : maskSensitiveData(run.metadata);

  return {
    ...run,
    title: maskSensitiveString(run.title),
    ...(metadata !== undefined
      ? {
          metadata,
        }
      : {}),
  };
}

function normalizeState(value: unknown): FileAuditState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return clone(EMPTY_STATE);
  }

  const source = value as Record<string, unknown>;
  const runsSource = source.runs;
  const eventsSource = source.events;

  const runs: Record<string, WorkflowRun> = {};
  if (runsSource !== null && typeof runsSource === "object" && !Array.isArray(runsSource)) {
    for (const [key, run] of Object.entries(runsSource as Record<string, unknown>)) {
      if (run !== null && typeof run === "object" && !Array.isArray(run)) {
        runs[key] = run as WorkflowRun;
      }
    }
  }

  const events: AuditEvent[] = Array.isArray(eventsSource)
    ? eventsSource.filter((event): event is AuditEvent => event !== null && typeof event === "object")
    : [];

  return {
    runs,
    events,
  };
}

function runIdentity(run: WorkflowRunKey): string {
  return `${run.branchName}::${run.startedAt}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await rm(filePath, {
      force: true,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw fileAuditError("unable to clean up temporary file", {
      filePath,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

function fileAuditError(message: string, details?: Record<string, unknown>): SpecforgeError {
  return new SpecforgeError("AUDIT_DRIVER_ERROR", message, details);
}
