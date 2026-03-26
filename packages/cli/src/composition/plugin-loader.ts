import { resolve } from "node:path";
import { PgAuditDriver } from "@specforge/adapters-audit-postgres";
import { LocalMarkdownDocStore } from "@specforge/adapters-docs-local-md";
import { GitCliAdapter } from "@specforge/adapters-git";
import {
  SpecforgeError,
  type AuditDriver,
  type GitPort,
  type MasterDocStore,
  type PullRequestCreateInput,
  type PullRequestCreateResult,
  type PullRequestPort,
} from "@specforge/contracts";
import { FileAuditDriver } from "./file-audit-driver.js";

type AuditProvider = "postgres" | "memory";
type DocsProvider = "local-md";
type PullRequestProvider = "none" | "memory";

interface RuntimeConfig {
  audit: {
    provider: AuditProvider;
    connectionString?: string;
    schema?: string;
    filePath?: string;
  };
  docsStore: {
    provider: DocsProvider;
    rootDir: string;
  };
  pullRequest: {
    provider: PullRequestProvider;
    mode: "success" | "fail";
    url: string;
    failureMessage: string;
  };
}

interface LoadedAuditPlugin {
  auditDriver: AuditDriver;
  close(): Promise<void>;
}

export interface LoadedRuntimePlugins {
  auditDriver: AuditDriver;
  gitPort: GitPort;
  masterDocStore: MasterDocStore;
  pullRequestPort?: PullRequestPort;
  close(): Promise<void>;
}

export async function loadRuntimePlugins(options: {
  projectRoot: string;
  config: Record<string, unknown>;
}): Promise<LoadedRuntimePlugins> {
  const runtimeConfig = normalizeRuntimeConfig(options.config);
  const auditPlugin = await loadAuditPlugin(options.projectRoot, runtimeConfig.audit);
  const masterDocStore = loadDocsStorePlugin(options.projectRoot, runtimeConfig.docsStore);
  const pullRequestPort = loadPullRequestPlugin(runtimeConfig.pullRequest);
  const gitPort = new GitCliAdapter({
    repoRoot: options.projectRoot,
  });

  return {
    auditDriver: auditPlugin.auditDriver,
    gitPort,
    masterDocStore,
    ...(pullRequestPort !== undefined
      ? {
          pullRequestPort,
        }
      : {}),
    close: auditPlugin.close,
  };
}

async function loadAuditPlugin(
  projectRoot: string,
  config: RuntimeConfig["audit"],
): Promise<LoadedAuditPlugin> {
  switch (config.provider) {
    case "postgres": {
      if (config.connectionString === undefined) {
        throw new SpecforgeError("CONFIG_ERROR", "config.audit.connectionString is required", {
          hint: "Use 'specforge config set --key audit.connectionString --value <postgres-url>'",
        });
      }

      const auditDriver = new PgAuditDriver();
      await auditDriver.connect({
        connectionString: config.connectionString,
        ...(config.schema !== undefined
          ? {
              schema: config.schema,
            }
          : {}),
        applicationName: "specforge-cli",
      });

      return {
        auditDriver,
        async close(): Promise<void> {
          await auditDriver.close();
        },
      };
    }
    case "memory": {
      const stateFilePath = resolve(projectRoot, config.filePath ?? ".specforge/state/audit-memory.json");
      const auditDriver = new FileAuditDriver({
        stateFilePath,
      });
      await auditDriver.connect({});

      return {
        auditDriver,
        async close(): Promise<void> {
          await auditDriver.close();
        },
      };
    }
    default: {
      const provider: never = config.provider;
      throw new SpecforgeError("CONFIG_ERROR", "unsupported audit provider", {
        provider,
      });
    }
  }
}

function loadDocsStorePlugin(projectRoot: string, config: RuntimeConfig["docsStore"]): MasterDocStore {
  switch (config.provider) {
    case "local-md": {
      return new LocalMarkdownDocStore({
        rootDir: resolve(projectRoot, config.rootDir),
      });
    }
    default: {
      const provider: never = config.provider;
      throw new SpecforgeError("CONFIG_ERROR", "unsupported docs store provider", {
        provider,
      });
    }
  }
}

function normalizeRuntimeConfig(value: unknown): RuntimeConfig {
  const source = asRecord(value, "config must be an object");
  const audit = normalizeAuditConfig(source.audit);
  const docsStore = normalizeDocsStoreConfig(source.docsStore);
  const pullRequest = normalizePullRequestConfig(source.pullRequest);

  return {
    audit,
    docsStore,
    pullRequest,
  };
}

function normalizeAuditConfig(value: unknown): RuntimeConfig["audit"] {
  const source = asRecord(value, "config.audit is required and must be an object");
  const providerValue = source.driver;

  const provider: AuditProvider =
    providerValue === undefined
      ? "postgres"
      : providerValue === "postgres" || providerValue === "memory"
        ? providerValue
        : (() => {
            throw new SpecforgeError("CONFIG_ERROR", "config.audit.driver must be 'postgres' or 'memory'", {
              received: providerValue,
            });
          })();

  const connectionString = source.connectionString;
  const normalizedConnectionString =
    typeof connectionString === "string" && connectionString.trim().length > 0 ? connectionString : undefined;

  const schema =
    typeof source.schema === "string" && source.schema.trim().length > 0 ? source.schema.trim() : undefined;
  const filePath =
    typeof source.filePath === "string" && source.filePath.trim().length > 0 ? source.filePath : undefined;

  return {
    provider,
    ...(normalizedConnectionString !== undefined
      ? {
          connectionString: normalizedConnectionString,
        }
      : {}),
    ...(schema !== undefined
      ? {
          schema,
        }
      : {}),
    ...(filePath !== undefined
      ? {
          filePath,
        }
      : {}),
  };
}

function normalizeDocsStoreConfig(value: unknown): RuntimeConfig["docsStore"] {
  if (value === undefined) {
    return {
      provider: "local-md",
      rootDir: ".",
    };
  }

  const source = asRecord(value, "config.docsStore must be an object");
  const providerValue = source.provider;
  const provider: DocsProvider =
    providerValue === undefined
      ? "local-md"
      : providerValue === "local-md"
        ? providerValue
        : (() => {
            throw new SpecforgeError("CONFIG_ERROR", "config.docsStore.provider must be 'local-md'", {
              received: providerValue,
            });
          })();

  const rootDir = typeof source.rootDir === "string" && source.rootDir.trim().length > 0 ? source.rootDir : ".";

  return {
    provider,
    rootDir,
  };
}

function loadPullRequestPlugin(config: RuntimeConfig["pullRequest"]): PullRequestPort | undefined {
  switch (config.provider) {
    case "none":
      return undefined;
    case "memory":
      return new MemoryPullRequestPort(config);
    default: {
      const provider: never = config.provider;
      throw new SpecforgeError("CONFIG_ERROR", "unsupported pull request provider", {
        provider,
      });
    }
  }
}

function normalizePullRequestConfig(value: unknown): RuntimeConfig["pullRequest"] {
  if (value === undefined) {
    return {
      provider: "none",
      mode: "success",
      url: "https://example.com/pull/1",
      failureMessage: "simulated pull request failure",
    };
  }

  const source = asRecord(value, "config.pullRequest must be an object");
  const providerValue = source.provider;
  const provider: PullRequestProvider =
    providerValue === undefined
      ? "none"
      : providerValue === "none" || providerValue === "memory"
        ? providerValue
        : (() => {
            throw new SpecforgeError("CONFIG_ERROR", "config.pullRequest.provider must be 'none' or 'memory'", {
              received: providerValue,
            });
          })();

  const modeValue = source.mode;
  const mode: "success" | "fail" =
    modeValue === undefined
      ? "success"
      : modeValue === "success" || modeValue === "fail"
        ? modeValue
        : (() => {
            throw new SpecforgeError("CONFIG_ERROR", "config.pullRequest.mode must be 'success' or 'fail'", {
              received: modeValue,
            });
          })();

  const url = typeof source.url === "string" && source.url.trim().length > 0 ? source.url : "https://example.com/pull/1";
  const failureMessage =
    typeof source.failureMessage === "string" && source.failureMessage.trim().length > 0
      ? source.failureMessage
      : "simulated pull request failure";

  return {
    provider,
    mode,
    url,
    failureMessage,
  };
}

class MemoryPullRequestPort implements PullRequestPort {
  private readonly mode: "success" | "fail";

  private readonly url: string;

  private readonly failureMessage: string;

  constructor(config: RuntimeConfig["pullRequest"]) {
    this.mode = config.mode;
    this.url = config.url;
    this.failureMessage = config.failureMessage;
  }

  async create(_input: PullRequestCreateInput): Promise<PullRequestCreateResult> {
    if (this.mode === "fail") {
      throw new Error(this.failureMessage);
    }

    return {
      url: this.url,
    };
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new SpecforgeError("CONFIG_ERROR", message);
}
