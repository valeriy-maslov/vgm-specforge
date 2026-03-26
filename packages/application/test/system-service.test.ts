import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultSystemService } from "../src/services/system-service.js";
import { InMemorySystemAssetsPort } from "./helpers/in-memory.js";

describe("DefaultSystemService", () => {
  it("updates managed assets and returns deterministic ordering", async () => {
    const systemAssetsPort = new InMemorySystemAssetsPort();
    systemAssetsPort.nextResult = {
      updatedFiles: ["skills/review.md", "prompts/start.md"],
      skippedFiles: ["command-contracts/system-update.json"],
      removedFiles: ["skills/old.md"],
    };

    const service = new DefaultSystemService({
      systemAssetsPort,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.updateManagedAssets(
      {
        dryRun: true,
      },
      context,
    );

    expect(systemAssetsPort.calls).toEqual([
      {
        dryRun: true,
      },
    ]);
    expect(output).toEqual({
      updatedFiles: ["prompts/start.md", "skills/review.md"],
      skippedFiles: ["command-contracts/system-update.json"],
      removedFiles: ["skills/old.md"],
    });
  });

  it("passes empty update options when dryRun is omitted", async () => {
    const systemAssetsPort = new InMemorySystemAssetsPort();
    const service = new DefaultSystemService({
      systemAssetsPort,
    });

    const context = createCommandContext({
      actor: { kind: "user" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await service.updateManagedAssets({}, context);
    expect(systemAssetsPort.calls).toEqual([{}]);
  });
});
