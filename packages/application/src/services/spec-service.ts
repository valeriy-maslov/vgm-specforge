import { randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditDriver,
  type SpecApproveInput,
  type SpecApproveOutput,
  type SpecDraftInput,
  type SpecDraftOutput,
} from "@specforge/contracts";
import { transitionWorkflow } from "@specforge/domain";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { defaultRules, evaluateHardGate, loadRunOrThrow, saveRunSanitized, withHardGateAudit } from "./internal.js";

export interface SpecService {
  draft(input: SpecDraftInput, ctx: CommandContext): Promise<SpecDraftOutput>;
  approve(input: SpecApproveInput, ctx: CommandContext): Promise<SpecApproveOutput>;
}

export interface SpecServiceDependencies {
  auditDriver: AuditDriver;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultSpecService implements SpecService {
  private readonly auditDriver: AuditDriver;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: SpecServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async draft(input: SpecDraftInput, ctx: CommandContext): Promise<SpecDraftOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for spec draft");

    const transition = transitionWorkflow({
      run,
      action: {
        type: "start_spec_drafting",
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
      draftPath: specDraftPath(transition.nextRun.key),
    };
  }

  async approve(input: SpecApproveInput, ctx: CommandContext): Promise<SpecApproveOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for spec approval");

    const gate = evaluateHardGate(ctx.ruleSources, "spec_approval");
    const transition = transitionWorkflow({
      run,
      action: {
        type: "approve_spec",
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
      gate: "spec_approval",
      targetEventTypes: ["spec_approved"],
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

function specDraftPath(runKey: SpecDraftInput["run"]): string {
  const branchSegment = runKey.branchName.replaceAll("/", "__");
  return `.specforge/state/runs/${branchSegment}__${runKey.startedAt}/work-spec.md`;
}
