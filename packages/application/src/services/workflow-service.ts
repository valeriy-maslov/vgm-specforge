import { randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditDriver,
  type GitPort,
  type InitializationStore,
  type StartWorkflowInput,
  type StartWorkflowOutput,
  type WorkflowCancelInput,
  type WorkflowCancelOutput,
  type WorkflowRun,
  type WorkflowRunKey,
  type WorkflowStatusInput,
  type WorkflowStatusOutput,
  type WorkType,
} from "@specforge/contracts";
import {
  buildCancellationRetentionRecord,
  createWorkflowRun,
  isActiveWorkflowState,
  renderBranchName,
  transitionWorkflow,
} from "@specforge/domain";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { evaluateRules } from "../orchestration/rule-evaluation.js";
import { defaultRules, saveRunSanitized } from "./internal.js";

export interface WorkflowService {
  start(input: StartWorkflowInput, ctx: CommandContext): Promise<StartWorkflowOutput>;
  status(input: WorkflowStatusInput, ctx: CommandContext): Promise<WorkflowStatusOutput>;
  cancel(input: WorkflowCancelInput, ctx: CommandContext): Promise<WorkflowCancelOutput>;
}

export interface WorkflowServiceDependencies {
  auditDriver: AuditDriver;
  gitPort: GitPort;
  initializationStore: InitializationStore;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultWorkflowService implements WorkflowService {
  private readonly auditDriver: AuditDriver;

  private readonly gitPort: GitPort;

  private readonly initializationStore: InitializationStore;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: WorkflowServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.gitPort = dependencies.gitPort;
    this.initializationStore = dependencies.initializationStore;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async start(input: StartWorkflowInput, ctx: CommandContext): Promise<StartWorkflowOutput> {
    const initializationState = await this.initializationStore.load(ctx.projectRoot);
    if (
      initializationState === null ||
      !initializationState.initialized ||
      initializationState.pendingBundledApproval
    ) {
      return {
        started: false,
        message: "initialization approval is required before starting a workflow",
      };
    }

    const branchNamingPattern = resolveBranchNamingPattern(ctx.ruleSources);
    const workType = inferWorkType(input);

    const branchName =
      input.branchName ??
      (await this.allocateBranchName({
        title: input.title,
        workType,
        branchNamingPattern,
      }));

    const activeRun = await this.findActiveRunByBranch(branchName);
    if (activeRun !== null) {
      return {
        started: false,
        message: `branch '${branchName}' already has an active workflow`,
      };
    }

    const branchExists = await this.gitPort.branchExists(branchName);
    if (!branchExists) {
      await this.gitPort.createBranch(branchName);
    }

    const nowIso = this.now();
    const run = createWorkflowRun({
      key: {
        branchName,
        startedAt: nowIso,
      },
      workType,
      title: input.title,
      nowIso,
    });

    await saveRunSanitized(this.auditDriver, run);
    await appendEvents(this.auditDriver, [
      {
        id: this.createEventId(),
        run: run.key,
        type: "workflow_started",
        actor: ctx.actor,
        createdAt: nowIso,
        payload: {
          title: input.title,
          prompt: input.prompt,
          workType,
          branchName,
          requestId: ctx.requestId,
        },
      },
    ]);

    return {
      started: true,
      run,
    };
  }

  async status(input: WorkflowStatusInput, _ctx: CommandContext): Promise<WorkflowStatusOutput> {
    if (input.run !== undefined) {
      const run = await this.auditDriver.getRun(input.run);
      return {
        run,
        active: run !== null && isActiveWorkflowState(run.state),
      };
    }

    const branchName = input.branchName ?? (await this.gitPort.currentBranch());
    const run = await this.findActiveRunByBranch(branchName);

    return {
      run,
      active: run !== null,
    };
  }

  async cancel(input: WorkflowCancelInput, ctx: CommandContext): Promise<WorkflowCancelOutput> {
    const run = await this.auditDriver.getRun(input.run);
    if (run === null) {
      throw new SpecforgeError("INVALID_WORKFLOW_STATE", "workflow run not found", {
        run: input.run,
      });
    }

    const cancelRules =
      ctx.actor.kind === "agent" ? evaluateRules(ctx.ruleSources).effectiveRules : defaultRules();

    const transition = transitionWorkflow({
      run,
      action: {
        type: "cancel_workflow",
        reason: input.reason,
      },
      nowIso: this.now(),
      rules: cancelRules,
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (transition.blockedReason !== undefined) {
      throw new SpecforgeError("WORKFLOW_TERMINAL", transition.blockedReason, {
        run: input.run,
      });
    }

    const branchExists = await this.gitPort.branchExists(run.key.branchName);
    const branchHeadSha = branchExists ? await this.gitPort.headSha(run.key.branchName) : "missing";
    const cancellationRetention = buildCancellationRetentionRecord({
      run,
      initiator: ctx.actor,
      cancelledAt: transition.nextRun.cancelledAt ?? this.now(),
      cancellationReason: input.reason,
      branchHeadSha,
      branchExists,
    });

    const nextRun: WorkflowRun = {
      key: transition.nextRun.key,
      workType: transition.nextRun.workType,
      state: transition.nextRun.state,
      title: "cancelled-workflow",
      affectedSectionIds: [...transition.nextRun.affectedSectionIds],
      unresolvedFailedGates: [],
      forceCompletionRequested: false,
      createdAt: transition.nextRun.createdAt,
      updatedAt: transition.nextRun.updatedAt,
      ...(transition.nextRun.cancelledAt !== undefined
        ? {
            cancelledAt: transition.nextRun.cancelledAt,
          }
        : {}),
      metadata: {
        cancellationRetention,
      },
    };

    const events = transition.events.map((event) => {
      if (event.type !== "workflow_cancelled") {
        return event;
      }
      return {
        ...event,
        payload: {
          ...event.payload,
          cancellationRetention,
        },
      };
    });

    await saveRunSanitized(this.auditDriver, nextRun);
    await appendEvents(this.auditDriver, events);

    return {
      cancelled: true,
      run: nextRun,
    };
  }

  private async allocateBranchName(args: {
    title: string;
    workType: WorkType;
    branchNamingPattern: string;
  }): Promise<string> {
    const baseName = renderBranchName({
      pattern: args.branchNamingPattern,
      workType: args.workType,
      slug: args.title,
    });

    if (!(await this.gitPort.branchExists(baseName))) {
      return baseName;
    }

    let suffix = 2;
    let candidate = `${baseName}-${suffix}`;
    while (await this.gitPort.branchExists(candidate)) {
      suffix += 1;
      candidate = `${baseName}-${suffix}`;
    }

    return candidate;
  }

  private async findActiveRunByBranch(branchName: string): Promise<WorkflowRun | null> {
    const branchEvents = await this.auditDriver.query({
      branchName,
      limit: 1000,
    });

    const runKeys = new Map<string, WorkflowRunKey>();
    for (const event of branchEvents) {
      runKeys.set(workflowRunIdentity(event.run), event.run);
    }

    const orderedRunKeys = [...runKeys.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));

    for (const runKey of orderedRunKeys) {
      const run = await this.auditDriver.getRun(runKey);
      if (run !== null && run.key.branchName === branchName && isActiveWorkflowState(run.state)) {
        return run;
      }
    }

    return null;
  }
}

function workflowRunIdentity(run: WorkflowRunKey): string {
  return `${run.branchName}::${run.startedAt}`;
}

function inferWorkType(input: StartWorkflowInput): WorkType {
  if (input.requestedWorkType !== undefined) {
    return input.requestedWorkType;
  }

  const searchText = `${input.title} ${input.prompt}`.toLowerCase();
  if (/(refactor|cleanup|restructure|rewrite)/.test(searchText)) {
    return "refactor";
  }
  if (/(refine|improve|optimiz|tweak|polish)/.test(searchText)) {
    return "refinement";
  }
  return "feature";
}

function resolveBranchNamingPattern(ruleSources: CommandContext["ruleSources"]): string {
  if (ruleSources?.prompt?.branchNamingPattern !== undefined) {
    return ruleSources.prompt.branchNamingPattern;
  }
  if (ruleSources?.constitution?.branchNamingPattern !== undefined) {
    return ruleSources.constitution.branchNamingPattern;
  }
  if (ruleSources?.agentsMd?.branchNamingPattern !== undefined) {
    return ruleSources.agentsMd.branchNamingPattern;
  }
  if (ruleSources?.readmeMd?.branchNamingPattern !== undefined) {
    return ruleSources.readmeMd.branchNamingPattern;
  }
  return defaultRules().branchNamingPattern;
}
