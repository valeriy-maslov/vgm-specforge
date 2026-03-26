import {
  SpecforgeError,
  type AuditDriver,
  type AuditEvent,
  type DriftStrategy,
  type GitPort,
  type MergeResult,
  type WorkflowRun,
} from "@specforge/contracts";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { evaluateRules } from "../orchestration/rule-evaluation.js";

export type DriftCheckpoint = "pre_implementation" | "pre_completion";

export interface AutomatedDriftInput {
  run: WorkflowRun;
  checkpoint: DriftCheckpoint;
  mainBranch: string;
  approveDriftAnalysis?: boolean;
  auditDriver: AuditDriver;
  gitPort: GitPort;
  context: CommandContext;
  now: () => string;
  createEventId: () => string;
}

export interface AutomatedDriftOutput {
  drifted: boolean;
  misalignmentDetected: boolean;
  strategyRequested: DriftStrategy;
  strategyApplied: DriftStrategy;
  mergeStatus?: MergeResult["status"];
}

export async function runAutomatedDriftIntegration(input: AutomatedDriftInput): Promise<AutomatedDriftOutput> {
  const strategyRequested = evaluateRules(input.context.ruleSources).effectiveRules.driftStrategy;
  const strategyApplied: AutomatedDriftOutput["strategyApplied"] = strategyRequested;
  const drifted = await input.gitPort.isMainDrifted(input.mainBranch);

  if (!drifted) {
    return {
      drifted: false,
      misalignmentDetected: false,
      strategyRequested,
      strategyApplied,
    };
  }

  const driftPaths = await input.gitPort.listDriftPaths(input.mainBranch);

  const events: AuditEvent[] = [
    {
      id: input.createEventId(),
      run: input.run.key,
      type: "drift_detected",
      actor: input.context.actor,
      createdAt: input.now(),
      payload: {
        checkpoint: input.checkpoint,
        mainBranch: input.mainBranch,
        requestId: input.context.requestId,
      },
    },
    {
      id: input.createEventId(),
      run: input.run.key,
      type: "main_merge_started",
      actor: input.context.actor,
      createdAt: input.now(),
      payload: {
        checkpoint: input.checkpoint,
        mainBranch: input.mainBranch,
        strategyRequested,
        strategyApplied,
        requestId: input.context.requestId,
      },
    },
  ];

  const mergeResult = await input.gitPort.mergeMainIntoCurrent(input.mainBranch, strategyApplied);

  if (mergeResult.status === "conflict") {
    const conflictFiles = mergeResult.conflictFiles ?? [];
    const resolutionPlan = buildConflictResolutionPlan(conflictFiles, mergeResult.message);

    events.push({
      id: input.createEventId(),
      run: input.run.key,
      type: "merge_conflict_detected",
      actor: input.context.actor,
      createdAt: input.now(),
      payload: {
        checkpoint: input.checkpoint,
        mainBranch: input.mainBranch,
        strategyRequested,
        strategyApplied,
        conflictFiles,
        message: mergeResult.message,
        requestId: input.context.requestId,
      },
    });
    events.push({
      id: input.createEventId(),
      run: input.run.key,
      type: "merge_conflict_resolution_proposed",
      actor: input.context.actor,
      createdAt: input.now(),
      payload: {
        checkpoint: input.checkpoint,
        mainBranch: input.mainBranch,
        strategyRequested,
        strategyApplied,
        conflictFiles,
        resolutionPlan,
        requestId: input.context.requestId,
      },
    });

    await appendEvents(input.auditDriver, events);
    throw new SpecforgeError("DRIFT_CONFLICT_REQUIRES_RESOLUTION", "drift integration detected merge conflicts; run drift resolve", {
      run: input.run.key,
      checkpoint: input.checkpoint,
      mainBranch: input.mainBranch,
      strategyRequested,
      conflictFiles,
      resolutionPlan,
    });
  }

  const impactAnalysis = analyzeDriftImpact({
    run: input.run,
    checkpoint: input.checkpoint,
    mergeResult,
    driftPaths,
  });

  events.push({
    id: input.createEventId(),
    run: input.run.key,
    type: "main_merge_completed",
    actor: input.context.actor,
    createdAt: input.now(),
    payload: {
      checkpoint: input.checkpoint,
      mainBranch: input.mainBranch,
      strategyRequested,
      strategyApplied,
      status: mergeResult.status,
      message: mergeResult.message,
      requestId: input.context.requestId,
      impactAnalysis,
    },
  });

  await appendEvents(input.auditDriver, events);

  if (mergeResult.status === "failed") {
    throw new SpecforgeError("DRIFT_INTEGRATION_FAILED", "drift integration failed", {
      run: input.run.key,
      checkpoint: input.checkpoint,
      mainBranch: input.mainBranch,
      strategyRequested,
      message: mergeResult.message,
    });
  }

  if (input.approveDriftAnalysis !== true) {
    throw new SpecforgeError(
      "DRIFT_CONFIRMATION_REQUIRED",
      "drift impact analysis requires explicit confirmation; rerun with --approve-drift-analysis",
      {
        run: input.run.key,
        checkpoint: input.checkpoint,
        mainBranch: input.mainBranch,
        strategyRequested,
        impactAnalysis,
      },
    );
  }

  return {
    drifted: true,
    misalignmentDetected: impactAnalysis.misalignmentDetected,
    strategyRequested,
    strategyApplied,
    mergeStatus: mergeResult.status,
  };
}

function analyzeDriftImpact(args: {
  run: WorkflowRun;
  checkpoint: DriftCheckpoint;
  mergeResult: MergeResult;
  driftPaths: readonly string[];
}): {
  checkpoint: DriftCheckpoint;
  mergeStatus: MergeResult["status"];
  misalignmentDetected: boolean;
  driftPaths: string[];
  signals: string[];
  summary: string;
} {
  const sectionTokens = runSectionTokens(args.run);
  const specPaths = args.driftPaths.filter(isSpecPath);
  const planPaths = args.driftPaths.filter(isPlanPath);
  const implementationPaths = args.driftPaths.filter(isImplementationPath);

  const specPathMismatch = specPaths.some((path) => {
    const token = featureSpecToken(path);
    if (token === null) {
      return false;
    }
    return !sectionTokens.has(token);
  });

  const implementationMismatch = implementationPaths.length > 0 && sectionTokens.size === 0;
  const planMismatch = planPaths.length > 0 && sectionTokens.size === 0;

  const signals: string[] = [];

  if (args.mergeResult.status === "merged") {
    signals.push("main_updates_integrated");
  }
  if (args.driftPaths.length > 0) {
    signals.push("drift_paths_detected");
  }
  if (specPathMismatch) {
    signals.push("spec_paths_outside_confirmed_scope");
  }
  if (implementationMismatch) {
    signals.push("implementation_paths_without_scope");
  }
  if (planMismatch) {
    signals.push("plan_paths_without_scope");
  }
  if (args.run.affectedSectionIds.length === 0) {
    signals.push("no_confirmed_scope_sections");
  }

  const misalignmentDetected =
    specPathMismatch ||
    implementationMismatch ||
    planMismatch ||
    metadataBoolean(args.run, "simulateDriftMisalignment") ||
    metadataCheckpointHint(args.run, args.checkpoint);

  const summary = misalignmentDetected
    ? `Drift integration indicates potential misalignment (${signals.join(", ") || "unspecified"}) and requires rework`
    : "Drift integration completed with no misalignment signals";

  return {
    checkpoint: args.checkpoint,
    mergeStatus: args.mergeResult.status,
    misalignmentDetected,
    driftPaths: [...args.driftPaths],
    signals,
    summary,
  };
}

function metadataBoolean(run: WorkflowRun, key: string): boolean {
  return run.metadata?.[key] === true;
}

function metadataCheckpointHint(run: WorkflowRun, checkpoint: DriftCheckpoint): boolean {
  const value = run.metadata?.simulateDriftMisalignmentCheckpoints;
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((entry) => entry === checkpoint);
}

function runSectionTokens(run: WorkflowRun): Set<string> {
  const tokens = new Set<string>();

  for (const sectionId of run.affectedSectionIds) {
    const normalized = sectionId.trim().toLowerCase();
    if (normalized.length === 0) {
      continue;
    }
    tokens.add(normalized);
    tokens.add(normalized.replace(/^sec-/, ""));
  }

  return tokens;
}

function isSpecPath(path: string): boolean {
  return path === "docs/master/root-spec.md" || path.startsWith("docs/master/features/");
}

function isPlanPath(path: string): boolean {
  return (
    path === "docs/master/implementation.md" ||
    path === "docs/master/decision-log.md" ||
    path.includes("/plan") ||
    path.includes("plans/")
  );
}

function isImplementationPath(path: string): boolean {
  if (path.startsWith("docs/")) {
    return false;
  }

  if (path.startsWith("src/") || path.startsWith("packages/")) {
    return true;
  }

  const dotIndex = path.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === path.length - 1) {
    return false;
  }

  const extension = path.slice(dotIndex).toLowerCase();
  return [".ts", ".tsx", ".js", ".jsx", ".go", ".py", ".rs", ".java", ".kt", ".cs"].includes(extension);
}

function featureSpecToken(path: string): string | null {
  if (!path.startsWith("docs/master/features/") || !path.endsWith(".md")) {
    return null;
  }

  const fileName = path.split("/").pop();
  if (fileName === undefined) {
    return null;
  }

  return fileName.replace(/\.md$/i, "").toLowerCase();
}

function buildConflictResolutionPlan(conflictFiles: readonly string[], message: string | undefined): string {
  if (conflictFiles.length === 0) {
    return "Resolve merge conflicts by preserving workflow intent, then continue integration";
  }

  const detail =
    typeof message === "string" && message.trim().length > 0 ? ` Merge output summary: ${message.trim()}.` : "";

  return `Review and resolve conflicts in: ${conflictFiles.slice(0, 5).join(", ")}. Keep workflow intent and reconcile with main updates before continuing integration.${detail}`;
}
