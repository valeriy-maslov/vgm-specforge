import { randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditDriver,
  type GitPort,
  type ValidationDecideInput,
  type ValidationDecideOutput,
  type ValidationRunInput,
  type ValidationRunOutput,
  type WorkflowRun,
} from "@specforge/contracts";
import { transitionWorkflow } from "@specforge/domain";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { evaluateRules } from "../orchestration/rule-evaluation.js";
import { runAutomatedDriftIntegration } from "./drift-automation.js";
import { defaultRules, evaluateHardGate, loadRunOrThrow, saveRunSanitized, withHardGateAudit } from "./internal.js";

const VALIDATION_GATE_EVENT_TYPES = ["validation_accepted", "validation_changes_requested"] as const;

export interface ValidationService {
  run(input: ValidationRunInput, ctx: CommandContext): Promise<ValidationRunOutput>;
  decide(input: ValidationDecideInput, ctx: CommandContext): Promise<ValidationDecideOutput>;
}

export interface ValidationServiceDependencies {
  auditDriver: AuditDriver;
  gitPort?: GitPort;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultValidationService implements ValidationService {
  private readonly auditDriver: AuditDriver;

  private readonly gitPort: GitPort | undefined;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: ValidationServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.gitPort = dependencies.gitPort;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async run(input: ValidationRunInput, ctx: CommandContext): Promise<ValidationRunOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for validation run");

    if (run.state === "plan_approved" && this.gitPort !== undefined) {
      const drift = await runAutomatedDriftIntegration({
        run,
        checkpoint: "pre_implementation",
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
        return this.transitionToReworkAfterDriftMisalignment(run, ctx);
      }
    }

    const preValidation = await this.ensureValidationState(run, ctx);
    const validationRules = evaluateRules(ctx.ruleSources).effectiveRules;

    const checksRun = [...validationRules.validationChecks];
    const failedChecks = inferFailedChecks(preValidation.nextRun);

    const nextRun: WorkflowRun = {
      ...preValidation.nextRun,
      metadata: {
        ...(preValidation.nextRun.metadata ?? {}),
        validation: {
          checksRun,
          failedChecks,
          runAt: this.now(),
        },
      },
    };

    await saveRunSanitized(this.auditDriver, nextRun);
    await appendEvents(this.auditDriver, preValidation.events);

    return {
      checksRun,
      failedChecks,
      state: nextRun.state,
    };
  }

  private async transitionToReworkAfterDriftMisalignment(
    run: WorkflowRun,
    ctx: CommandContext,
  ): Promise<ValidationRunOutput> {
    const startImplementation = transitionWorkflow({
      run,
      action: {
        type: "start_implementation",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (startImplementation.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_TRANSITION", startImplementation.blockedReason, {
        run: run.key,
        state: run.state,
      });
    }

    const completeImplementation = transitionWorkflow({
      run: startImplementation.nextRun,
      action: {
        type: "complete_implementation",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (completeImplementation.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_TRANSITION", completeImplementation.blockedReason, {
        run: run.key,
        state: startImplementation.nextRun.state,
      });
    }

    const toRework = transitionWorkflow({
      run: completeImplementation.nextRun,
      action: {
        type: "validation_decision",
        decision: "changes_requested",
        approved: true,
        unresolvedFailedGates: ["drift_misalignment"],
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (toRework.blockedReason !== undefined || toRework.nextRun.state !== "rework") {
      throw new SpecforgeError("INVALID_TRANSITION", toRework.blockedReason ?? "unable to transition workflow to rework", {
        run: run.key,
        state: completeImplementation.nextRun.state,
      });
    }

    const checksRun = ["drift-impact-analysis"];
    const failedChecks = ["drift_misalignment"];
    const nextRun: WorkflowRun = {
      ...toRework.nextRun,
      metadata: {
        ...(toRework.nextRun.metadata ?? {}),
        validation: {
          checksRun,
          failedChecks,
          runAt: this.now(),
        },
      },
    };

    await saveRunSanitized(this.auditDriver, nextRun);
    await appendEvents(this.auditDriver, [...startImplementation.events, ...completeImplementation.events, ...toRework.events]);

    return {
      checksRun,
      failedChecks,
      state: nextRun.state,
    };
  }

  async decide(input: ValidationDecideInput, ctx: CommandContext): Promise<ValidationDecideOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for validation decision");

    const gate = evaluateHardGate(ctx.ruleSources, "validation_decision");
    const transition = transitionWorkflow({
      run,
      action: {
        type: "validation_decision",
        decision: input.decision,
        approved: input.approved,
        unresolvedFailedGates: input.unresolvedFailedGates,
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
      gate: "validation_decision",
      targetEventTypes: VALIDATION_GATE_EVENT_TYPES,
      hardGateAudit: gate.hardGateAudit,
    });

    await saveRunSanitized(this.auditDriver, transition.nextRun);
    await appendEvents(this.auditDriver, events);

    return {
      state: transition.nextRun.state,
      decision: input.decision,
    };
  }

  private async ensureValidationState(
    run: WorkflowRun,
    ctx: CommandContext,
  ): Promise<{ nextRun: WorkflowRun; events: ReturnType<typeof transitionWorkflow>["events"] }> {
    if (run.state === "validation") {
      return {
        nextRun: run,
        events: [],
      };
    }

    if (run.state === "plan_approved") {
      return this.advanceFromPlanApproved(run, ctx);
    }

    if (run.state === "rework") {
      return this.advanceFromRework(run, ctx);
    }

    const transition = transitionWorkflow({
      run,
      action: {
        type: "complete_implementation",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (transition.blockedReason !== undefined || transition.nextRun.state !== "validation") {
      throw new SpecforgeError("INVALID_TRANSITION", transition.blockedReason ?? "workflow is not ready for validation", {
        run: run.key,
        state: run.state,
      });
    }

    return {
      nextRun: transition.nextRun,
      events: transition.events,
    };
  }

  private advanceFromPlanApproved(
    run: WorkflowRun,
    ctx: CommandContext,
  ): { nextRun: WorkflowRun; events: ReturnType<typeof transitionWorkflow>["events"] } {
    const startImplementation = transitionWorkflow({
      run,
      action: {
        type: "start_implementation",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (startImplementation.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_TRANSITION", startImplementation.blockedReason, {
        run: run.key,
        state: run.state,
      });
    }

    const completeImplementation = transitionWorkflow({
      run: startImplementation.nextRun,
      action: {
        type: "complete_implementation",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (completeImplementation.blockedReason !== undefined || completeImplementation.nextRun.state !== "validation") {
      throw new SpecforgeError(
        "INVALID_TRANSITION",
        completeImplementation.blockedReason ?? "workflow is not ready for validation",
        {
          run: run.key,
          state: run.state,
        },
      );
    }

    return {
      nextRun: completeImplementation.nextRun,
      events: [...startImplementation.events, ...completeImplementation.events],
    };
  }

  private advanceFromRework(
    run: WorkflowRun,
    ctx: CommandContext,
  ): { nextRun: WorkflowRun; events: ReturnType<typeof transitionWorkflow>["events"] } {
    const applyRework = transitionWorkflow({
      run,
      action: {
        type: "apply_rework",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (applyRework.blockedReason !== undefined) {
      throw new SpecforgeError("INVALID_TRANSITION", applyRework.blockedReason, {
        run: run.key,
        state: run.state,
      });
    }

    const completeImplementation = transitionWorkflow({
      run: applyRework.nextRun,
      action: {
        type: "complete_implementation",
      },
      nowIso: this.now(),
      rules: defaultRules(),
      actor: ctx.actor,
      eventIdFactory: this.createEventId,
    });

    if (completeImplementation.blockedReason !== undefined || completeImplementation.nextRun.state !== "validation") {
      throw new SpecforgeError(
        "INVALID_TRANSITION",
        completeImplementation.blockedReason ?? "workflow is not ready for validation",
        {
          run: run.key,
          state: run.state,
        },
      );
    }

    return {
      nextRun: completeImplementation.nextRun,
      events: [...applyRework.events, ...completeImplementation.events],
    };
  }
}

function inferFailedChecks(run: WorkflowRun): string[] {
  const metadata = run.metadata;
  if (metadata === undefined) {
    return [];
  }

  const simulated = metadata.simulatedFailedChecks;
  if (!Array.isArray(simulated)) {
    return [];
  }

  return simulated
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}
