import {
  type AuditDriver,
  type InitCommandInput,
  type InitCommandOutput,
  type InitializationState,
  type InitializationStore,
  type InitializationWorkspacePort,
} from "@specforge/contracts";
import type { CommandContext } from "../orchestration/command-context.js";
import { evaluateHardGate } from "./internal.js";

export interface InitService {
  initialize(input: InitCommandInput, ctx: CommandContext): Promise<InitCommandOutput>;
}

export interface InitServiceDependencies {
  initializationStore: InitializationStore;
  initializationWorkspace: InitializationWorkspacePort;
  auditDriver?: AuditDriver;
  now?: () => string;
}

export class DefaultInitService implements InitService {
  private readonly initializationStore: InitializationStore;

  private readonly initializationWorkspace: InitializationWorkspacePort;

  private readonly now: () => string;

  constructor(dependencies: InitServiceDependencies) {
    this.initializationStore = dependencies.initializationStore;
    this.initializationWorkspace = dependencies.initializationWorkspace;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async initialize(input: InitCommandInput, ctx: CommandContext): Promise<InitCommandOutput> {
    const nowIso = this.now();
    const bootstrap = await this.initializationWorkspace.bootstrap({
      projectRoot: ctx.projectRoot,
      mode: input.mode,
      ...(input.projectName !== undefined
        ? {
            projectName: input.projectName,
          }
        : {}),
      ...(input.promptContext !== undefined
        ? {
            promptContext: input.promptContext,
          }
        : {}),
      nowIso,
    });

    const gate = evaluateHardGate(ctx.ruleSources, "initialization_bundled_approval");
    const approvalSatisfied = input.approved === true || gate.effectiveRules.autoAdvanceHardGates;
    const pendingBundledApproval = !approvalSatisfied;

    const state: InitializationState = {
      initialized: !pendingBundledApproval,
      mode: input.mode,
      generatedArtifacts: bootstrap.generatedArtifacts,
      createdArtifacts: bootstrap.createdArtifacts,
      updatedArtifacts: bootstrap.updatedArtifacts,
      reconciliationRequired: bootstrap.reconciliationRequired,
      reconciliationFindings: bootstrap.reconciliationFindings,
      scanSummary: bootstrap.scanSummary,
      ...(bootstrap.reconciliationReportPath !== undefined
        ? {
            reconciliationReportPath: bootstrap.reconciliationReportPath,
          }
        : {}),
      pendingBundledApproval,
      lastBundledApprovalAudit: gate.hardGateAudit,
      lastBundledApprovalDecisionAt: nowIso,
      ...(approvalSatisfied
        ? {
            approvedAt: nowIso,
          }
        : {}),
    };

    await this.initializationStore.save(ctx.projectRoot, state);

    return {
      initialized: state.initialized,
      mode: state.mode,
      generatedArtifacts: state.generatedArtifacts,
      createdArtifacts: state.createdArtifacts ?? [],
      updatedArtifacts: state.updatedArtifacts ?? [],
      reconciliationRequired: state.reconciliationRequired,
      reconciliationFindings: state.reconciliationFindings ?? [],
      ...(state.reconciliationReportPath !== undefined
        ? {
            reconciliationReportPath: state.reconciliationReportPath,
          }
        : {}),
      scanSummary: state.scanSummary ?? bootstrap.scanSummary,
      pendingBundledApproval: state.pendingBundledApproval,
    };
  }
}
