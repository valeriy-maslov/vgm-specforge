import type {
  SystemAssetsPort,
  SystemUpdateInput,
  SystemUpdateOutput,
} from "@specforge/contracts";
import type { CommandContext } from "../orchestration/command-context.js";

export interface SystemService {
  updateManagedAssets(input: SystemUpdateInput, ctx: CommandContext): Promise<SystemUpdateOutput>;
}

export interface SystemServiceDependencies {
  systemAssetsPort: SystemAssetsPort;
}

export class DefaultSystemService implements SystemService {
  private readonly systemAssetsPort: SystemAssetsPort;

  constructor(dependencies: SystemServiceDependencies) {
    this.systemAssetsPort = dependencies.systemAssetsPort;
  }

  async updateManagedAssets(input: SystemUpdateInput, _ctx: CommandContext): Promise<SystemUpdateOutput> {
    const result = await this.systemAssetsPort.update(
      input.dryRun === undefined
        ? {}
        : {
            dryRun: input.dryRun,
          },
    );

    return {
      updatedFiles: [...result.updatedFiles].sort((left, right) => left.localeCompare(right)),
      skippedFiles: [...result.skippedFiles].sort((left, right) => left.localeCompare(right)),
      removedFiles: [...result.removedFiles].sort((left, right) => left.localeCompare(right)),
    };
  }
}
