import { createCommandContext } from "@specforge/application";
import { DOMAIN_EVENT_NAMES, type AuditQueryOutput, type CliResult, type DomainEventName } from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import { invalidArguments, parseCommonCommandOptions, parseOptionalRunKey } from "./shared.js";

export interface ExecuteAuditOptions {
  cwd: string;
}

export async function executeAudit(
  args: readonly string[],
  options: ExecuteAuditOptions,
): Promise<CliResult<AuditQueryOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  const parsed = parseAuditQuery(common.value.rest);
  if (!parsed.ok) {
    return parsed.result;
  }

  const runtime = await createRuntimeServices(common.value.projectRoot);
  try {
    const context = createCommandContext({
      actor: common.value.actor,
      cwd: options.cwd,
      projectRoot: common.value.projectRoot,
      ...(common.value.ruleSources !== undefined
        ? {
            ruleSources: common.value.ruleSources,
          }
        : {}),
    });

    const output = await runtime.auditService.query(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseAuditQuery(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run?: {
          branchName: string;
          startedAt: string;
        };
        branchName?: string;
        eventTypes?: DomainEventName[];
        fromIso?: string;
        toIso?: string;
        limit?: number;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  const eventTypes: DomainEventName[] = [];
  let fromIso: string | undefined;
  let toIso: string | undefined;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;
    if (token === "--branch") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--branch requires a value");
      }
      branchName = value;
      index += 1;
      continue;
    }
    if (token === "--started-at") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--started-at requires a value");
      }
      startedAt = value;
      index += 1;
      continue;
    }
    if (token === "--event-type") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--event-type requires a value");
      }
      if (!DOMAIN_EVENT_NAMES.includes(value as DomainEventName)) {
        return invalidArguments(`unknown domain event type '${value}'`);
      }
      eventTypes.push(value as DomainEventName);
      index += 1;
      continue;
    }
    if (token === "--from") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--from requires a value");
      }
      fromIso = value;
      index += 1;
      continue;
    }
    if (token === "--to") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--to requires a value");
      }
      toIso = value;
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--limit requires a value");
      }
      const parsedLimit = Number.parseInt(value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        return invalidArguments("--limit must be a positive integer");
      }
      limit = parsedLimit;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for audit query`);
  }

  const run = parseOptionalRunKey(branchName, startedAt);
  if (!run.ok) {
    return run;
  }

  return {
    ok: true,
    input: {
      ...(run.value !== undefined
        ? {
            run: run.value,
          }
        : branchName !== undefined
          ? {
              branchName,
            }
          : {}),
      ...(eventTypes.length > 0
        ? {
            eventTypes,
          }
        : {}),
      ...(fromIso !== undefined
        ? {
            fromIso,
          }
        : {}),
      ...(toIso !== undefined
        ? {
            toIso,
          }
        : {}),
      ...(limit !== undefined
        ? {
            limit,
          }
        : {}),
    },
  };
}
