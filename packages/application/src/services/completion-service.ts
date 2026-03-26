import { randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditEvent,
  type AuditDriver,
  type CompletionApproveInput,
  type CompletionApproveOutput,
  type CompletionPreviewInput,
  type CompletionPreviewOutput,
  type CompletionSyncInput,
  type CompletionSyncOutput,
  type ForceCompletionInput,
  type ForceCompletionOutput,
  type GitPort,
  type MasterDocStore,
  type PullRequestPort,
  type SyncChangeSet,
  type SyncOperation,
  type SyncPreview,
  type SyncResult,
  type WorkflowRun,
} from "@specforge/contracts";
import { decideCompletionRetention, transitionWorkflow } from "@specforge/domain";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { evaluateRules } from "../orchestration/rule-evaluation.js";
import { runAutomatedDriftIntegration } from "./drift-automation.js";
import { defaultRules, evaluateHardGate, loadRunOrThrow, saveRunSanitized, withHardGateAudit } from "./internal.js";

type ForceCompletionContext = NonNullable<SyncPreview["forceCompletionContext"]>;

export interface CompletionService {
  preview(input: CompletionPreviewInput, ctx: CommandContext): Promise<CompletionPreviewOutput>;
  approve(input: CompletionApproveInput, ctx: CommandContext): Promise<CompletionApproveOutput>;
  sync(input: CompletionSyncInput, ctx: CommandContext): Promise<CompletionSyncOutput>;
  force(input: ForceCompletionInput, ctx: CommandContext): Promise<ForceCompletionOutput>;
}

export interface CompletionServiceDependencies {
  auditDriver: AuditDriver;
  masterDocStore: MasterDocStore;
  gitPort?: GitPort;
  pullRequestPort?: PullRequestPort;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultCompletionService implements CompletionService {
  private readonly auditDriver: AuditDriver;

  private readonly masterDocStore: MasterDocStore;

  private readonly gitPort: GitPort | undefined;

  private readonly pullRequestPort: PullRequestPort | undefined;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: CompletionServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.masterDocStore = dependencies.masterDocStore;
    this.gitPort = dependencies.gitPort;
    this.pullRequestPort = dependencies.pullRequestPort;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async preview(input: CompletionPreviewInput, ctx: CommandContext): Promise<CompletionPreviewOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for completion preview");
    if (run.state !== "ready_to_complete") {
      throw new SpecforgeError("INVALID_WORKFLOW_STATE", "completion preview requires ready_to_complete state", {
        run: input.run,
        state: run.state,
      });
    }

    const changeSet = buildSyncChangeSet(run);
    const plannedPreview = await this.masterDocStore.planSync(changeSet);
    const nowIso = this.now();
    const forceCompletionContext = buildForceCompletionContext(run);
    const preview: SyncPreview =
      forceCompletionContext === null
        ? plannedPreview
        : {
            ...plannedPreview,
            forceCompletionContext,
          };

    const nextRun: WorkflowRun = {
      ...run,
      updatedAt: nowIso,
      metadata: {
        ...(run.metadata ?? {}),
        syncPreview: {
          generatedAt: nowIso,
          operations: preview.operations,
          warnings: preview.warnings,
          forceCompletionRequested: run.forceCompletionRequested,
          forceCompletionContext,
          unresolvedFailedGates: run.unresolvedFailedGates,
        },
      },
    };

    await saveRunSanitized(this.auditDriver, nextRun);
    await appendEvents(this.auditDriver, [
      {
        id: this.createEventId(),
        run: run.key,
        type: "sync_preview_generated",
        actor: ctx.actor,
        createdAt: nowIso,
        payload: {
          requestId: ctx.requestId,
          operationCount: preview.operations.length,
          warnings: preview.warnings,
          forceCompletionRequested: run.forceCompletionRequested,
          forceCompletionContext,
          overriddenFailedGates: run.unresolvedFailedGates,
          unresolvedFailedGates: run.unresolvedFailedGates,
        },
      },
    ]);

    return {
      preview,
    };
  }

  async approve(input: CompletionApproveInput, ctx: CommandContext): Promise<CompletionApproveOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for completion approval");

    const gate = evaluateHardGate(ctx.ruleSources, "final_sync_preview_approval");
    const transition = transitionWorkflow({
      run,
      action: {
        type: "approve_sync_preview",
        approved: input.approved,
      },
      nowIso: this.now(),
      rules: gate.effectiveRules,
      hardGateAudit: gate.hardGateAudit,
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (transition.blockedReason !== undefined) {
      throw new SpecforgeError("HARD_GATE_APPROVAL_REQUIRED", transition.blockedReason, {
        run: input.run,
      });
    }

    const events = withHardGateAudit(transition.events, {
      gate: "final_sync_preview_approval",
      targetEventTypes: ["sync_preview_approved"],
      hardGateAudit: gate.hardGateAudit,
    });

    await saveRunSanitized(this.auditDriver, transition.nextRun);
    await appendEvents(this.auditDriver, events);

    return {
      state: transition.nextRun.state,
      approved: input.approved,
    };
  }

  async sync(input: CompletionSyncInput, ctx: CommandContext): Promise<CompletionSyncOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for completion sync");

    let runForSync = run;
    const preSyncEvents: AuditEvent[] = [];
    if (isRetryAttempt(run)) {
      const retryRules = this.retryRulesForActor(ctx);
      const retryTransition = transitionWorkflow({
        run,
        action: {
          type: "request_sync_retry",
        },
        nowIso: this.now(),
        rules: retryRules,
        actor: ctx.actor,
        eventIdFactory: this.createEventId,
      });

      if (retryTransition.blockedReason !== undefined) {
        throw new SpecforgeError("INVALID_WORKFLOW_STATE", retryTransition.blockedReason, {
          run: input.run,
        });
      }

      runForSync = retryTransition.nextRun;
      preSyncEvents.push(...retryTransition.events);
    }

    if (this.gitPort !== undefined) {
      const drift = await runAutomatedDriftIntegration({
        run: runForSync,
        checkpoint: "pre_completion",
        mainBranch: input.mainBranch ?? "main",
        ...(input.approveDriftAnalysis !== undefined
          ? {
              approveDriftAnalysis: input.approveDriftAnalysis,
            }
          : {}),
        auditDriver: this.auditDriver,
        gitPort: this.gitPort,
        context: ctx,
        now: this.now,
        createEventId: this.createEventId,
      });

      if (drift.misalignmentDetected) {
        runForSync = {
          ...runForSync,
          unresolvedFailedGates: mergeFailedGates(runForSync.unresolvedFailedGates, ["drift_misalignment"]),
          metadata: {
            ...(runForSync.metadata ?? {}),
            driftImpactAnalysis: {
              checkpoint: "pre_completion",
              detectedAt: this.now(),
              misalignmentDetected: true,
            },
          },
        };
      }
    }

    const defaultPolicyRules = defaultRules();

    const completionTransition = transitionWorkflow({
      run: runForSync,
      action: {
        type: "sync_succeeded",
      },
      nowIso: this.now(),
      rules: defaultPolicyRules,
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (completionTransition.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_WORKFLOW_STATE", completionTransition.blockedReason, {
        run: input.run,
      });
    }

    if (completionTransition.nextRun.state === "rework") {
      await saveRunSanitized(this.auditDriver, completionTransition.nextRun);
      await appendEvents(this.auditDriver, [...preSyncEvents, ...completionTransition.events]);

      return {
        state: completionTransition.nextRun.state,
        result: {
          run: completionTransition.nextRun.key,
          success: false,
          appliedOperations: [],
          message: "completion requires force command due to unresolved failed gates",
        },
      };
    }

    const changeSet = buildSyncChangeSet(runForSync);
    const syncStartedEvent = {
      id: this.createEventId(),
      run: runForSync.key,
      type: "master_docs_sync_started" as const,
      actor: ctx.actor,
      createdAt: this.now(),
      payload: {
        operationCount: changeSet.operations.length,
        requestId: ctx.requestId,
      },
    };

    try {
      const syncResult = await this.masterDocStore.applySync(changeSet);
      if (!syncResult.success) {
        return await this.handleSyncFailure({
          run: runForSync,
          reason: syncResult.message ?? "sync failed",
          syncStartedEvent,
          preSyncEvents,
          ctx,
        });
      }

      const retentionDecision = decideCompletionRetention({
        keepArtifactsExplicitlyRequested: runForSync.metadata?.keepArtifactsAfterCompletion === true,
      });
      const pullRequest = await this.tryCreatePullRequest(runForSync, input);
      const syncMessage = mergeMessages(syncResult.message, pullRequest?.created === false ? pullRequest.message : undefined);

      const completedRun: WorkflowRun = {
        ...completionTransition.nextRun,
        metadata: retentionDecision.retainArtifacts
          ? {
              ...(completionTransition.nextRun.metadata ?? {}),
              completionRetention: {
                ...retentionDecision,
                decidedAt: this.now(),
              },
            }
          : {
              completionRetention: {
                ...retentionDecision,
                decidedAt: this.now(),
              },
            },
      };

      await saveRunSanitized(this.auditDriver, completedRun);
      await appendEvents(this.auditDriver, [...preSyncEvents, syncStartedEvent, ...completionTransition.events]);

      return {
        state: completedRun.state,
        result: {
          ...syncResult,
          ...(syncMessage !== undefined
            ? {
                message: syncMessage,
              }
            : {}),
        },
        ...(pullRequest !== undefined
          ? {
              pullRequest,
            }
          : {}),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown sync failure";
      return await this.handleSyncFailure({
        run: runForSync,
        reason,
        syncStartedEvent,
        preSyncEvents,
        ctx,
      });
    }
  }

  async force(input: ForceCompletionInput, ctx: CommandContext): Promise<ForceCompletionOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for force completion");

    const transition = transitionWorkflow({
      run,
      action: {
        type: "request_force_completion",
        reason: input.reason,
        approvedBy: input.approvedBy,
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (transition.blockedReason !== undefined) {
      throw new SpecforgeError("FORCE_COMPLETION_REQUIRED", transition.blockedReason, {
        run: input.run,
      });
    }

    await saveRunSanitized(this.auditDriver, transition.nextRun);
    await appendEvents(this.auditDriver, transition.events);

    return {
      requested: true,
      state: transition.nextRun.state,
    };
  }

  private async handleSyncFailure(args: {
    run: WorkflowRun;
    reason: string;
    syncStartedEvent: {
      id: string;
      run: WorkflowRun["key"];
      type: "master_docs_sync_started";
      actor: CommandContext["actor"];
      createdAt: string;
      payload: Record<string, unknown>;
    };
    preSyncEvents: AuditEvent[];
    ctx: CommandContext;
  }): Promise<CompletionSyncOutput> {
    const failedTransition = transitionWorkflow({
      run: args.run,
      action: {
        type: "sync_failed",
        reason: args.reason,
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: args.ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (failedTransition.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_WORKFLOW_STATE", failedTransition.blockedReason, {
        run: args.run.key,
      });
    }

    await saveRunSanitized(this.auditDriver, failedTransition.nextRun);
    await appendEvents(this.auditDriver, [...args.preSyncEvents, args.syncStartedEvent, ...failedTransition.events]);

    const failureResult: SyncResult = {
      run: args.run.key,
      success: false,
      appliedOperations: [],
      message: args.reason,
    };

    return {
      state: failedTransition.nextRun.state,
      result: failureResult,
    };
  }

  private async tryCreatePullRequest(
    run: WorkflowRun,
    input: CompletionSyncInput,
  ): Promise<NonNullable<CompletionSyncOutput["pullRequest"]> | undefined> {
    if (input.requestPullRequest !== true) {
      return undefined;
    }

    if (this.pullRequestPort === undefined) {
      return {
        requested: true,
        created: false,
        message: "pull request creation was requested, but no pull request integration is configured",
      };
    }

    try {
      const created = await this.pullRequestPort.create({
        branchName: run.key.branchName,
        title: input.pullRequestTitle ?? `SpecForge: ${run.title}`,
        ...(input.pullRequestBody !== undefined
          ? {
              body: input.pullRequestBody,
            }
          : {}),
      });

      return {
        requested: true,
        created: true,
        url: created.url,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown pull request error";

      return {
        requested: true,
        created: false,
        message: `pull request creation failed: ${message}`,
      };
    }
  }

  private retryRulesForActor(_ctx: CommandContext) {
    if (_ctx.actor.kind === "agent") {
      return evaluateRules(_ctx.ruleSources).effectiveRules;
    }
    return defaultRules();
  }
}

function buildSyncChangeSet(run: WorkflowRun): SyncChangeSet {
  const operations = syncOperationsForRun(run);
  return {
    run: run.key,
    operations,
    metadata: {
      workType: run.workType,
      forceCompletionRequested: run.forceCompletionRequested,
      unresolvedFailedGates: run.unresolvedFailedGates,
      affectedSectionIds: run.affectedSectionIds,
    },
  };
}

function syncOperationsForRun(run: WorkflowRun): SyncOperation[] {
  const operations: SyncOperation[] = [
    {
      kind: "update",
      path: "docs/master/root-spec.md",
      description: "update root master spec index and summary",
    },
    {
      kind: "update",
      path: "docs/master/change-history.md",
      description: "append workflow change history entry",
    },
    {
      kind: "update",
      path: "docs/master/decision-log.md",
      description: "promote decision list entries",
    },
    {
      kind: "update",
      path: "docs/master/audit-history.md",
      description: "persist workflow audit and history entries",
    },
  ];

  if (run.workType === "refactor") {
    operations.push(
      {
        kind: "update",
        path: "docs/master/architecture.md",
        description: "update architecture doc for refactor impact",
      },
      {
        kind: "update",
        path: "docs/master/implementation.md",
        description: "update implementation doc for refactor impact",
      },
    );

    if (run.affectedSectionIds.length > 0) {
      operations.push({
        kind: "update",
        path: "docs/master/features/affected-feature-specs.md",
        description: "update impacted feature specs when refactor scope requires",
      });
    }

    return operations;
  }

  operations.push({
    kind: "update",
    path: "docs/master/features/affected-feature-specs-index.md",
    description: "update root feature spec index entries",
  });

  const affectedSections = run.affectedSectionIds.length > 0 ? run.affectedSectionIds : ["general"];
  for (const sectionId of affectedSections) {
    operations.push({
      kind: "update",
      path: `docs/master/features/${sectionId}.md`,
      description: `update or create feature spec for section '${sectionId}'`,
    });
  }

  return operations;
}

function buildForceCompletionContext(run: WorkflowRun): ForceCompletionContext | null {
  if (!run.forceCompletionRequested) {
    return null;
  }

  const reason = typeof run.metadata?.forceCompletionReason === "string" ? run.metadata.forceCompletionReason : "";
  const approvedBy =
    typeof run.metadata?.forceCompletionApprovedBy === "string" ? run.metadata.forceCompletionApprovedBy : "unknown";
  const requestedAt =
    typeof run.metadata?.forceCompletionRequestedAt === "string" ? run.metadata.forceCompletionRequestedAt : null;

  return {
    explicitCommand: "specforge complete force --reason ...",
    reason,
    overriddenFailedGates: run.unresolvedFailedGates,
    riskAcceptance: {
      acceptedBy: approvedBy,
      acceptedAt: requestedAt,
    },
  };
}

function isRetryAttempt(run: WorkflowRun): boolean {
  return typeof run.metadata?.lastSyncFailureAt === "string";
}

function mergeMessages(primary?: string, secondary?: string): string | undefined {
  if (primary === undefined && secondary === undefined) {
    return undefined;
  }

  if (primary === undefined) {
    return secondary;
  }

  if (secondary === undefined) {
    return primary;
  }

  return `${primary}; ${secondary}`;
}

function mergeFailedGates(current: readonly string[], next: readonly string[]): string[] {
  const normalized = [...current, ...next]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}
