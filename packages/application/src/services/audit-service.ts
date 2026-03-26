import type { AuditDriver, AuditQueryInput, AuditQueryOutput } from "@specforge/contracts";
import type { CommandContext } from "../orchestration/command-context.js";

export interface AuditService {
  query(input: AuditQueryInput, ctx: CommandContext): Promise<AuditQueryOutput>;
}

export interface AuditServiceDependencies {
  auditDriver: AuditDriver;
}

export class DefaultAuditService implements AuditService {
  private readonly auditDriver: AuditDriver;

  constructor(dependencies: AuditServiceDependencies) {
    this.auditDriver = dependencies.auditDriver;
  }

  async query(input: AuditQueryInput, _ctx: CommandContext): Promise<AuditQueryOutput> {
    const events = await this.auditDriver.query(input);
    return {
      events,
    };
  }
}
