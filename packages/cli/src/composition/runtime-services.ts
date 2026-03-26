import type {
  AuditService,
  CompletionService,
  DriftService,
  PlanService,
  ScopeService,
  SpecService,
  ValidationService,
  WorkflowService,
} from "@specforge/application";
import { createCliContainer } from "./container.js";

export interface RuntimeServices {
  workflowService: WorkflowService;
  scopeService: ScopeService;
  specService: SpecService;
  planService: PlanService;
  validationService: ValidationService;
  completionService: CompletionService;
  driftService: DriftService;
  auditService: AuditService;
  close(): Promise<void>;
}

export async function createRuntimeServices(projectRoot: string): Promise<RuntimeServices> {
  const container = await createCliContainer(projectRoot);

  return {
    workflowService: container.workflowService,
    scopeService: container.scopeService,
    specService: container.specService,
    planService: container.planService,
    validationService: container.validationService,
    completionService: container.completionService,
    driftService: container.driftService,
    auditService: container.auditService,
    close: container.close,
  };
}
