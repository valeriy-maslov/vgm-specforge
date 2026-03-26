import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pgPromise from "pg-promise";
import {
  SpecforgeError,
  type AuditDriver,
  type AuditEvent,
  type AuditQuery,
  type WorkflowRun,
  type WorkflowRunKey,
} from "@specforge/contracts";

type DatabaseLike = {
  none(query: string, values?: unknown): Promise<unknown>;
  oneOrNone<T>(query: string, values?: unknown): Promise<T | null>;
  manyOrNone<T>(query: string, values?: unknown): Promise<T[]>;
  $pool?: { end(): Promise<void> };
};

type PgpRoot = {
  (config: unknown): DatabaseLike;
  end(): void;
};

export interface PostgresAuditConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: unknown;
  schema?: string;
  max?: number;
  applicationName?: string;
  runMigrations?: boolean;
}

export interface PgAuditDriverOptions {
  database?: DatabaseLike;
  pgpRoot?: PgpRoot;
  migrationsDir?: string;
}

interface RunRow {
  branch_name: string;
  started_at: Date | string;
  work_type: WorkflowRun["workType"];
  state: WorkflowRun["state"];
  title: string;
  affected_section_ids: unknown;
  unresolved_failed_gates: unknown;
  force_completion_requested: boolean;
  metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  cancelled_at: Date | string | null;
  completed_at: Date | string | null;
}

interface EventRow {
  id: string;
  branch_name: string;
  started_at: Date | string;
  event_type: AuditEvent["type"];
  actor_kind: AuditEvent["actor"]["kind"];
  actor_id: string | null;
  payload: unknown;
  created_at: Date | string;
}

export class PgAuditDriver implements AuditDriver {
  private readonly database: DatabaseLike | undefined;

  private readonly pgpRoot: PgpRoot | undefined;

  private readonly migrationsDir: string;

  private connectedDatabase: DatabaseLike | null = null;

  private connectedSchema = "public";

  private createdPgpRoot: PgpRoot | null = null;

  constructor(options: PgAuditDriverOptions = {}) {
    this.database = options.database;
    this.pgpRoot = options.pgpRoot;
    this.migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  }

  async connect(config: unknown): Promise<void> {
    const pgConfig = normalizeConfig(config);

    this.connectedSchema = validateSchemaName(pgConfig.schema ?? "public");

    if (this.database !== undefined) {
      this.connectedDatabase = this.database;
    } else {
      const pgpRoot = this.pgpRoot ?? (pgPromise() as unknown as PgpRoot);
      this.createdPgpRoot = this.pgpRoot === undefined ? pgpRoot : null;
      this.connectedDatabase = pgpRoot(toPgConnectionConfig(pgConfig));
    }

    if (pgConfig.runMigrations !== false) {
      await this.runMigrations();
    }
  }

  async append(event: AuditEvent): Promise<void> {
    const db = this.requireDatabase();
    const schema = this.connectedSchema;
    const maskedEvent = maskEvent(event);

    await this.executeDb("append", async () => {
      await db.none(
        `insert into ${schema}.sf_workflow_events
         (id, branch_name, started_at, event_type, actor_kind, actor_id, payload, created_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [
          maskedEvent.id,
          maskedEvent.run.branchName,
          maskedEvent.run.startedAt,
          maskedEvent.type,
          maskedEvent.actor.kind,
          maskedEvent.actor.id ?? null,
          JSON.stringify(maskedEvent.payload),
          maskedEvent.createdAt,
        ],
      );
    });
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    const db = this.requireDatabase();
    const schema = this.connectedSchema;
    const whereClauses: string[] = [];
    const values: unknown[] = [];

    const pushValue = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };

    if (filter.run !== undefined) {
      whereClauses.push(`branch_name = ${pushValue(filter.run.branchName)}`);
      whereClauses.push(`started_at = ${pushValue(filter.run.startedAt)}::timestamptz`);
    }

    if (filter.branchName !== undefined) {
      whereClauses.push(`branch_name = ${pushValue(filter.branchName)}`);
    }

    if (filter.eventTypes !== undefined && filter.eventTypes.length > 0) {
      whereClauses.push(`event_type = any(${pushValue(filter.eventTypes)}::text[])`);
    }

    if (filter.fromIso !== undefined) {
      whereClauses.push(`created_at >= ${pushValue(filter.fromIso)}::timestamptz`);
    }

    if (filter.toIso !== undefined) {
      whereClauses.push(`created_at <= ${pushValue(filter.toIso)}::timestamptz`);
    }

    const limit = Math.max(1, Math.min(filter.limit ?? 500, 10_000));
    const where = whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";
    const limitToken = pushValue(limit);

    const rows = await this.executeDb("query", async () =>
      db.manyOrNone<EventRow>(
        `select
           id,
           branch_name,
           started_at,
           event_type,
           actor_kind,
           actor_id,
           payload,
           created_at
         from ${schema}.sf_workflow_events
         ${where}
         order by created_at asc
         limit ${limitToken}`,
        values,
      ),
    );

    return rows.map((row) => ({
      id: row.id,
      run: {
        branchName: row.branch_name,
        startedAt: toIsoString(row.started_at),
      },
      type: row.event_type,
      actor: {
        kind: row.actor_kind,
        ...(row.actor_id !== null
          ? {
              id: row.actor_id,
            }
          : {}),
      },
      createdAt: toIsoString(row.created_at),
      payload: normalizeRecord(row.payload),
    }));
  }

  async getRun(run: WorkflowRunKey): Promise<WorkflowRun | null> {
    const db = this.requireDatabase();
    const schema = this.connectedSchema;

    const row = await this.executeDb("getRun", async () =>
      db.oneOrNone<RunRow>(
        `select
           branch_name,
           started_at,
           work_type,
           state,
           title,
           affected_section_ids,
           unresolved_failed_gates,
           force_completion_requested,
           metadata,
           created_at,
           updated_at,
           cancelled_at,
           completed_at
         from ${schema}.sf_workflow_runs
         where branch_name = $1
           and started_at = $2::timestamptz`,
        [run.branchName, run.startedAt],
      ),
    );

    if (row === null) {
      return null;
    }

    return {
      key: {
        branchName: row.branch_name,
        startedAt: toIsoString(row.started_at),
      },
      workType: row.work_type,
      state: row.state,
      title: row.title,
      affectedSectionIds: normalizeStringArray(row.affected_section_ids),
      unresolvedFailedGates: normalizeStringArray(row.unresolved_failed_gates),
      forceCompletionRequested: row.force_completion_requested,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      ...(row.cancelled_at !== null
        ? {
            cancelledAt: toIsoString(row.cancelled_at),
          }
        : {}),
      ...(row.completed_at !== null
        ? {
            completedAt: toIsoString(row.completed_at),
          }
        : {}),
      ...(row.metadata !== null && row.metadata !== undefined
        ? {
            metadata: normalizeRecord(row.metadata),
          }
        : {}),
    };
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    const db = this.requireDatabase();
    const schema = this.connectedSchema;
    const maskedRun = maskRun(run);

    await this.executeDb("saveRun", async () => {
      await db.none(
        `insert into ${schema}.sf_workflow_runs
         (
           branch_name,
           started_at,
           work_type,
           state,
           title,
           affected_section_ids,
           unresolved_failed_gates,
           force_completion_requested,
           metadata,
           created_at,
           updated_at,
           cancelled_at,
           completed_at
         )
         values (
           $1,
           $2::timestamptz,
           $3,
           $4,
           $5,
           $6::jsonb,
           $7::jsonb,
           $8,
           $9::jsonb,
           $10::timestamptz,
           $11::timestamptz,
           $12::timestamptz,
           $13::timestamptz
         )
         on conflict (branch_name, started_at)
         do update set
           work_type = excluded.work_type,
           state = excluded.state,
           title = excluded.title,
           affected_section_ids = excluded.affected_section_ids,
           unresolved_failed_gates = excluded.unresolved_failed_gates,
           force_completion_requested = excluded.force_completion_requested,
           metadata = excluded.metadata,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           cancelled_at = excluded.cancelled_at,
           completed_at = excluded.completed_at`,
        [
          maskedRun.key.branchName,
          maskedRun.key.startedAt,
          maskedRun.workType,
          maskedRun.state,
          maskedRun.title,
          JSON.stringify(maskedRun.affectedSectionIds),
          JSON.stringify(maskedRun.unresolvedFailedGates),
          maskedRun.forceCompletionRequested,
          JSON.stringify(maskedRun.metadata ?? {}),
          maskedRun.createdAt,
          maskedRun.updatedAt,
          maskedRun.cancelledAt ?? null,
          maskedRun.completedAt ?? null,
        ],
      );
    });
  }

  async close(): Promise<void> {
    if (this.connectedDatabase?.$pool?.end !== undefined && this.database === undefined) {
      await this.connectedDatabase.$pool.end();
    }

    if (this.createdPgpRoot !== null) {
      this.createdPgpRoot.end();
    }

    this.connectedDatabase = null;
    this.createdPgpRoot = null;
  }

  private requireDatabase(): DatabaseLike {
    if (this.connectedDatabase === null) {
      throw new SpecforgeError("AUDIT_DRIVER_ERROR", "postgres audit driver is not connected");
    }

    return this.connectedDatabase;
  }

  private async runMigrations(): Promise<void> {
    const db = this.requireDatabase();
    const migrationFiles = ["001_init.sql", "002_indexes.sql"];

    for (const fileName of migrationFiles) {
      const migrationPath = join(this.migrationsDir, fileName);
      const migration = await readFile(migrationPath, "utf8");
      await this.executeDb(`runMigrations:${fileName}`, async () => {
        await db.none(renderMigration(migration, this.connectedSchema));
      });
    }
  }

  private async executeDb<T>(operation: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SpecforgeError) {
        throw error;
      }

      throw new SpecforgeError("AUDIT_DRIVER_ERROR", `postgres audit driver operation failed: ${operation}`, {
        operation,
        reason: summarizeDatabaseError(error),
      });
    }
  }
}

function defaultMigrationsDir(): string {
  const sourcePath = dirname(fileURLToPath(import.meta.url));
  return join(sourcePath, "..", "migrations");
}

function renderMigration(template: string, schema: string): string {
  return template.replaceAll("{{schema}}", schema);
}

function normalizeConfig(value: unknown): PostgresAuditConfig {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== "object") {
    throw new SpecforgeError("AUDIT_DRIVER_ERROR", "invalid postgres audit configuration", {
      receivedType: typeof value,
    });
  }

  return value as PostgresAuditConfig;
}

function toPgConnectionConfig(config: PostgresAuditConfig): Record<string, unknown> {
  if (config.connectionString !== undefined) {
    return {
      connectionString: config.connectionString,
      max: config.max,
      application_name: config.applicationName,
      ssl: config.ssl,
    };
  }

  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.max,
    application_name: config.applicationName,
    ssl: config.ssl,
  };
}

function validateSchemaName(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new SpecforgeError("AUDIT_DRIVER_ERROR", `invalid postgres schema '${schema}'`);
  }

  return schema;
}

function maskEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    actor: {
      ...event.actor,
      ...(event.actor.id !== undefined
        ? {
            id: maskSensitiveString(event.actor.id),
          }
        : {}),
    },
    payload: maskSensitiveRecord(event.payload),
  };
}

function maskRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    title: maskSensitiveString(run.title),
    metadata: maskSensitiveRecord(run.metadata ?? {}),
  };
}

function maskSensitiveRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object") {
    return {};
  }

  return maskUnknown(value, new WeakSet<object>()) as Record<string, unknown>;
}

function maskUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return maskSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskUnknown(item, seen));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      output[key] = entry === undefined ? undefined : "[REDACTED]";
      continue;
    }
    output[key] = maskUnknown(entry, seen);
  }
  return output;
}

function maskSensitiveString(value: string): string {
  return value
    .replace(
      /((?:["']?(?:api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?token|refresh[_-]?token|authorization|token|password|passphrase|secret)["']?)\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|bearer\s+[^\s,;}\]]+|[^\s,;}\]]+)/gi,
      (_whole, prefix: string, rawValue: string) => {
        if (rawValue.startsWith('"')) {
          return `${prefix}"[REDACTED]"`;
        }
        if (rawValue.startsWith("'")) {
          return `${prefix}'[REDACTED]'`;
        }
        return `${prefix}[REDACTED]`;
      },
    )
    .replace(/(authorization\s*[:=]\s*bearer\s+)([^\s,;"']+)/gi, "$1[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, "$1[REDACTED]@");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized.includes("apikey") ||
    normalized.includes("accesskey") ||
    normalized.includes("privatekey") ||
    normalized.includes("clientsecret") ||
    normalized.includes("sessiontoken") ||
    normalized.includes("refreshtoken") ||
    normalized.includes("authorization") ||
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized.includes("connectionstring") ||
    normalized.includes("databaseurl") ||
    normalized.includes("databaseuri") ||
    normalized === "dsn" ||
    normalized.endsWith("dsn") ||
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("secret")
  );
}

function summarizeDatabaseError(error: unknown): string {
  if (error instanceof Error) {
    return maskSensitiveString(error.message).slice(0, 500);
  }

  return "unknown database error";
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }

  return value;
}
