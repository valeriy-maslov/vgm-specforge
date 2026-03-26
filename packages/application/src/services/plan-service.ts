import { randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditDriver,
  type PlanApproveInput,
  type PlanApproveOutput,
  type PlanDraftInput,
  type PlanDraftOutput,
} from "@specforge/contracts";
import { transitionWorkflow } from "@specforge/domain";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { defaultRules, evaluateHardGate, loadRunOrThrow, saveRunSanitized, withHardGateAudit } from "./internal.js";

export interface PlanService {
  draft(input: PlanDraftInput, ctx: CommandContext): Promise<PlanDraftOutput>;
  approve(input: PlanApproveInput, ctx: CommandContext): Promise<PlanApproveOutput>;
}

export interface PlanServiceDependencies {
  auditDriver: AuditDriver;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultPlanService implements PlanService {
  private readonly auditDriver: AuditDriver;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: PlanServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async draft(input: PlanDraftInput, ctx: CommandContext): Promise<PlanDraftOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for plan draft");

    const transition = transitionWorkflow({
      run,
      action: {
        type: "start_plan_drafting",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (transition.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_TRANSITION", transition.blockedReason, {
        run: input.run,
      });
    }

    await saveRunSanitized(this.auditDriver, transition.nextRun);
    await appendEvents(this.auditDriver, transition.events);

    return {
      state: transition.nextRun.state,
      draftPath: planDraftPath(transition.nextRun.key),
    };
  }

  async approve(input: PlanApproveInput, ctx: CommandContext): Promise<PlanApproveOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for plan approval");

    const gate = evaluateHardGate(ctx.ruleSources, "plan_approval");
    const transition = transitionWorkflow({
      run,
      action: {
        type: "approve_plan",
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
      gate: "plan_approval",
      targetEventTypes: ["plan_approved"],
      hardGateAudit: gate.hardGateAudit,
    });

    await saveRunSanitized(this.auditDriver, transition.nextRun);
    await appendEvents(this.auditDriver, events);

    return {
      state: transition.nextRun.state,
      approved: input.approved,
      appliedRuleSources: gate.appliedRuleSources,
    };
  }
}

function planDraftPath(runKey: PlanDraftInput["run"]): string {
  const branchSegment = runKey.branchName.replaceAll("/", "__");
  return `.specforge/state/runs/${branchSegment}__${runKey.startedAt}/implementation-plan.md`;
}
