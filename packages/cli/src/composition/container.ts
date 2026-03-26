import {
  createCommandContext,
  DefaultAuditService,
  DefaultCompletionService,
  DefaultDriftService,
  DefaultPlanService,
  DefaultScopeService,
  DefaultSpecService,
  DefaultValidationService,
  DefaultWorkflowService,
  type AuditService,
  type CompletionService,
  type DriftService,
  type PlanService,
  type ScopeService,
  type SpecService,
  type ValidationService,
  type WorkflowService,
  type CommandContext,
} from "@specforge/application";
import { type Actor, type RuleSources } from "@specforge/contracts";
import { LocalConfigStore } from "./local-config-store.js";
import { LocalInitializationStore } from "./local-initialization-store.js";
import { loadRuntimePlugins } from "./plugin-loader.js";

export interface CliContainer {
  workflowService: WorkflowService;
  scopeService: ScopeService;
  specService: SpecService;
  planService: PlanService;
  validationService: ValidationService;
  completionService: CompletionService;
  driftService: DriftService;
  auditService: AuditService;
  createContext(input: {
    actor: Actor;
    cwd: string;
    requestId?: string;
    ruleSources?: RuleSources;
  }): CommandContext;
  close(): Promise<void>;
}

export async function createCliContainer(projectRoot: string): Promise<CliContainer> {
  const configStore = new LocalConfigStore({
    projectRoot,
  });
  const initializationStore = new LocalInitializationStore({
    projectRoot,
  });
  const config = await configStore.load(projectRoot);
  const plugins = await loadRuntimePlugins({
    projectRoot,
    config,
  });

  return {
    workflowService: new DefaultWorkflowService({
      auditDriver: plugins.auditDriver,
      gitPort: plugins.gitPort,
      initializationStore,
    }),
    scopeService: new DefaultScopeService({
      auditDriver: plugins.auditDriver,
    }),
    specService: new DefaultSpecService({
      auditDriver: plugins.auditDriver,
    }),
    planService: new DefaultPlanService({
      auditDriver: plugins.auditDriver,
    }),
    validationService: new DefaultValidationService({
      auditDriver: plugins.auditDriver,
      gitPort: plugins.gitPort,
    }),
    completionService: new DefaultCompletionService({
      auditDriver: plugins.auditDriver,
      masterDocStore: plugins.masterDocStore,
      gitPort: plugins.gitPort,
      ...(plugins.pullRequestPort !== undefined
        ? {
            pullRequestPort: plugins.pullRequestPort,
          }
        : {}),
    }),
    driftService: new DefaultDriftService({
      auditDriver: plugins.auditDriver,
      gitPort: plugins.gitPort,
    }),
    auditService: new DefaultAuditService({
      auditDriver: plugins.auditDriver,
    }),
    createContext(input): CommandContext {
      return createCommandContext({
        actor: input.actor,
        cwd: input.cwd,
        projectRoot,
        ...(input.requestId !== undefined
          ? {
              requestId: input.requestId,
            }
          : {}),
        ...(input.ruleSources !== undefined
          ? {
              ruleSources: input.ruleSources,
            }
          : {}),
      });
    },
    close: plugins.close,
  };
}
