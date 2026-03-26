import { createHash, randomUUID } from "node:crypto";
import {
  SpecforgeError,
  type AuditDriver,
  type ScopeAnalyzeInput,
  type ScopeAnalyzeOutput,
  type ScopeConfirmInput,
  type ScopeConfirmOutput,
} from "@specforge/contracts";
import { transitionWorkflow } from "@specforge/domain";
import type { CommandContext } from "../orchestration/command-context.js";
import { appendEvents } from "../orchestration/event-emitter.js";
import { defaultRules, loadRunOrThrow, saveRunSanitized } from "./internal.js";

export interface ScopeService {
  analyze(input: ScopeAnalyzeInput, ctx: CommandContext): Promise<ScopeAnalyzeOutput>;
  confirm(input: ScopeConfirmInput, ctx: CommandContext): Promise<ScopeConfirmOutput>;
}

export interface ScopeServiceDependencies {
  auditDriver: AuditDriver;
  now?: () => string;
  createEventId?: () => string;
}

export class DefaultScopeService implements ScopeService {
  private readonly auditDriver: AuditDriver;

  private readonly now: () => string;

  private readonly createEventId: () => string;

  constructor(dependencies: ScopeServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createEventId = dependencies.createEventId ?? (() => randomUUID());
  }

  async analyze(input: ScopeAnalyzeInput, ctx: CommandContext): Promise<ScopeAnalyzeOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for scope analyze");

    const proposedSectionIds = proposeSectionIds({
      strictSectionIds: input.strictSectionIds,
      freeText: input.freeText,
      fallbackFromRun: run.affectedSectionIds,
    });

    const affectedAreas = deriveAffectedAreas(proposedSectionIds);

    const nowIso = this.now();
    await appendEvents(this.auditDriver, [
      {
        id: this.createEventId(),
        run: run.key,
        type: "scope_proposed",
        actor: ctx.actor,
        createdAt: nowIso,
        payload: {
          strictSectionIds: input.strictSectionIds ?? [],
          freeText: input.freeText ?? "",
          proposedSectionIds,
          affectedAreas,
          requestId: ctx.requestId,
        },
      },
    ]);

    return {
      proposedSectionIds,
      affectedAreas,
    };
  }

  async confirm(input: ScopeConfirmInput, ctx: CommandContext): Promise<ScopeConfirmOutput> {
    const run = await loadRunOrThrow(this.auditDriver, input.run, "workflow run not found for scope confirm");

    const transition = transitionWorkflow({
      run,
      action: {
        type: "confirm_scope",
        affectedSectionIds: input.sectionIds,
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
      confirmedSectionIds: transition.nextRun.affectedSectionIds,
      state: transition.nextRun.state,
    };
  }
}

function proposeSectionIds(args: {
  strictSectionIds: string[] | undefined;
  freeText: string | undefined;
  fallbackFromRun: string[];
}): string[] {
  const strict = normalizeSectionIds(args.strictSectionIds ?? []);
  if (strict.length > 0) {
    return strict;
  }

  const inferred = inferSectionIds(args.freeText ?? "");
  if (inferred.length > 0) {
    return inferred;
  }

  return normalizeSectionIds(args.fallbackFromRun);
}

function normalizeSectionIds(sectionIds: readonly string[]): string[] {
  return [...new Set(sectionIds.map((sectionId) => sectionId.trim()).filter((sectionId) => sectionId.length > 0))];
}

function inferSectionIds(freeText: string): string[] {
  const words = freeText
    .toLowerCase()
    .match(/[a-z0-9_-]{4,}/g)
    ?.slice(0, 3)
    .map((word) => word.replace(/[^a-z0-9_-]/g, ""))
    .filter((word) => word.length > 0);

  if (words === undefined || words.length === 0) {
    if (freeText.trim().length === 0) {
      return [];
    }
    const fallbackHash = createHash("sha1").update(freeText).digest("hex").slice(0, 8);
    return [`sec-inferred-${fallbackHash}`];
  }

  return [...new Set(words.map((word) => `sec-${word}`))];
}

function deriveAffectedAreas(sectionIds: readonly string[]): string[] {
  return sectionIds.map((sectionId) => sectionId.replace(/^sec-/, "").replaceAll("-", " "));
}
