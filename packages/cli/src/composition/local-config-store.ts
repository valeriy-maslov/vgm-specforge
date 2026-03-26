import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SpecforgeError, type ConfigStore } from "@specforge/contracts";

const DEFAULT_CONFIG_FILE = ".specforge/config.yaml";
const WRITE_LOCK_TIMEOUT_MS = 2_500;
const WRITE_LOCK_RETRY_DELAY_MS = 20;
const STALE_LOCK_MAX_AGE_MS = 30_000;

export interface LocalConfigStoreOptions {
  projectRoot: string;
  configFilePath?: string;
}

export class LocalConfigStore implements ConfigStore {
  private readonly configFilePath: string;

  private readonly lockFilePath: string;

  constructor(options: LocalConfigStoreOptions) {
    this.configFilePath = resolve(options.projectRoot, options.configFilePath ?? DEFAULT_CONFIG_FILE);
    this.lockFilePath = `${this.configFilePath}.lock`;
  }

  async load(_projectRoot: string): Promise<Record<string, unknown>> {
    const content = await readTextFileIfExists(this.configFilePath);
    if (content === null) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      throw new SpecforgeError("CONFIG_ERROR", "config file must contain JSON-compatible YAML", {
        filePath: this.configFilePath,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SpecforgeError("CONFIG_ERROR", "config file root must be an object", {
        filePath: this.configFilePath,
      });
    }

    return parsed as Record<string, unknown>;
  }

  async save(_projectRoot: string, config: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.configFilePath), {
      recursive: true,
    });

    await this.withWriteLock(async () => {
      const tempPath = `${this.configFilePath}.${randomUUID()}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

      try {
        await rename(tempPath, this.configFilePath);
      } catch (error) {
        await removeFileIfExists(tempPath);
        throw new SpecforgeError("CONFIG_ERROR", "unable to persist config file", {
          filePath: this.configFilePath,
          reason: error instanceof Error ? error.message : "unknown error",
        });
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
          throw new SpecforgeError("CONFIG_ERROR", "unable to acquire config write lock", {
            lockFilePath: this.lockFilePath,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }

        if (await this.isLockFileStale()) {
          await removeFileIfExists(this.lockFilePath);
          continue;
        }

        if (Date.now() - startedAt >= WRITE_LOCK_TIMEOUT_MS) {
          throw new SpecforgeError("CONFIG_ERROR", "timed out waiting for config write lock", {
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
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        return;
      }

      throw new SpecforgeError("CONFIG_ERROR", "unable to release config write lock", {
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
