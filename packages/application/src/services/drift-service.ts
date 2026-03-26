import { randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditDriver,
  type DriftCheckInput,
  type DriftCheckOutput,
  type DriftMergeMainInput,
  type DriftMergeMainOutput,
  type DriftResolveInput,
  type DriftResolveOutput,
  type GitPort,
} from "@specforge/contracts";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { evaluateRules } from "../orchestration/rule-evaluation.js";
import { loadRunOrThrow } from "./internal.js";

export interface DriftService {
  check(input: DriftCheckInput, ctx: CommandContext): Promise<DriftCheckOutput>;
  mergeMain(input: DriftMergeMainInput, ctx: CommandContext): Promise<DriftMergeMainOutput>;
  resolveConflicts(input: DriftResolveInput, ctx: CommandContext): Promise<DriftResolveOutput>;
}

export interface DriftServiceDependencies {
  auditDriver: AuditDriver;
  gitPort: GitPort;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultDriftService implements DriftService {
  private readonly auditDriver: AuditDriver;

  private readonly gitPort: GitPort;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: DriftServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.gitPort = dependencies.gitPort;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async check(input: DriftCheckInput, ctx: CommandContext): Promise<DriftCheckOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for drift check");
    const drifted = await this.gitPort.isMainDrifted(input.mainBranch);

    if (drifted) {
      await appendEvents(this.auditDriver, [
        {
          id: this.createEventId(),
          run: run.key,
          type: "drift_detected",
          actor: ctx.actor,
          createdAt: this.now(),
          payload: {
            mainBranch: input.mainBranch,
            requestId: ctx.requestId,
          },
        },
      ]);
    }

    return {
      drifted,
    };
  }

  async mergeMain(input: DriftMergeMainInput, ctx: CommandContext): Promise<DriftMergeMainOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for drift merge-main");
    const driftStrategy = evaluateRules(ctx.ruleSources).effectiveRules.driftStrategy;

    await appendEvents(this.auditDriver, [
      {
        id: this.createEventId(),
        run: run.key,
        type: "main_merge_started",
        actor: ctx.actor,
        createdAt: this.now(),
        payload: {
          mainBranch: input.mainBranch,
          strategy: driftStrategy,
          requestId: ctx.requestId,
        },
      },
    ]);

    const result = await this.gitPort.mergeMainIntoCurrent(input.mainBranch, driftStrategy);

    if (result.status === "conflict") {
      const conflictFiles = result.conflictFiles ?? [];
      const resolutionPlan = buildConflictResolutionPlan(conflictFiles, result.message);

      await appendEvents(this.auditDriver, [
        {
          id: this.createEventId(),
          run: run.key,
          type: "merge_conflict_detected",
          actor: ctx.actor,
          createdAt: this.now(),
            payload: {
              mainBranch: input.mainBranch,
              strategy: driftStrategy,
              conflictFiles,
              message: result.message,
              requestId: ctx.requestId,
            },
          },
          {
            id: this.createEventId(),
            run: run.key,
            type: "merge_conflict_resolution_proposed",
            actor: ctx.actor,
            createdAt: this.now(),
            payload: {
              resolutionPlan,
              conflictFiles,
              requestId: ctx.requestId,
            },
          },
        ]);

      return {
        result,
        proposal: {
          resolutionPlan,
          conflictFiles,
        },
      };
    } else {
      await appendEvents(this.auditDriver, [
        {
          id: this.createEventId(),
          run: run.key,
          type: "main_merge_completed",
          actor: ctx.actor,
          createdAt: this.now(),
            payload: {
              mainBranch: input.mainBranch,
              strategy: driftStrategy,
              status: result.status,
              message: result.message,
              requestId: ctx.requestId,
            },
        },
      ]);
    }

    return {
      result,
    };
  }

  async resolveConflicts(input: DriftResolveInput, ctx: CommandContext): Promise<DriftResolveOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for drift resolve");
    const conflictFiles = await this.gitPort.detectConflictFiles();
    const resolutionPlan =
      typeof input.resolutionPlan === "string" && input.resolutionPlan.trim().length > 0
        ? input.resolutionPlan
        : buildConflictResolutionPlan(conflictFiles, undefined);

    await appendEvents(this.auditDriver, [
      {
        id: this.createEventId(),
        run: run.key,
        type: "merge_conflict_resolution_proposed",
        actor: ctx.actor,
        createdAt: this.now(),
        payload: {
          resolutionPlan,
          conflictFiles,
          requestId: ctx.requestId,
        },
      },
    ]);

    if (!input.approved) {
      throw new SpecforgeError(
        "CONFLICT_RESOLUTION_APPROVAL_REQUIRED",
        "conflict resolution proposal must be explicitly approved",
        {
          run: input.run,
        },
      );
    }

    if (conflictFiles.length > 0) {
      await this.gitPort.markConflictFilesResolved(conflictFiles);
      await this.gitPort.continueMerge();
    }

    const nowIso = this.now();
    await appendEvents(this.auditDriver, [
      {
        id: this.createEventId(),
        run: run.key,
        type: "merge_conflict_resolution_approved",
        actor: ctx.actor,
        createdAt: nowIso,
        payload: {
          resolutionPlan,
          conflictFiles,
          requestId: ctx.requestId,
        },
      },
      {
        id: this.createEventId(),
        run: run.key,
        type: "merge_conflict_resolution_applied",
        actor: ctx.actor,
        createdAt: nowIso,
        payload: {
          conflictFiles,
          requestId: ctx.requestId,
        },
      },
    ]);

    return {
      resolved: true,
      resolutionPlan,
    };
  }
}

function buildConflictResolutionPlan(conflictFiles: readonly string[], message: string | undefined): string {
  if (conflictFiles.length === 0) {
    return "Stage conflict markers, prefer workflow branch intent where ambiguity exists, and continue integration";
  }

  const fileList = conflictFiles.slice(0, 5).join(", ");
  const detail =
    typeof message === "string" && message.trim().length > 0
      ? ` Merge output summary: ${message.trim()}.`
      : "";

  return `Review and resolve conflicts in: ${fileList}. Keep run intent and reconcile with main branch updates before continuing integration.${detail}`;
}
