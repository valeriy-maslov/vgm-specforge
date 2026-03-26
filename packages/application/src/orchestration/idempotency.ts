import { createHash } from "node:crypto";
import type { WorkflowRunKey } from "@specforge/contracts";

export interface IdempotencyKeyInput {
  command: string;
  nowIso: string;
  actorId?: string;
  run?: WorkflowRunKey;
  payload?: unknown;
}

function runIdentity(run: WorkflowRunKey | undefined): string {
  if (run === undefined) {
    return "-";
  }
  return `${run.branchName}::${run.startedAt}`;
}

export function buildIdempotencyKey(input: IdempotencyKeyInput): string {
  const hash = createHash("sha256");
  hash.update(input.command);
  hash.update("|");
  hash.update(input.nowIso);
  hash.update("|");
  hash.update(input.actorId ?? "-");
  hash.update("|");
  hash.update(runIdentity(input.run));
  hash.update("|");
  hash.update(JSON.stringify(input.payload ?? null));
  return hash.digest("hex").slice(0, 24);
}
