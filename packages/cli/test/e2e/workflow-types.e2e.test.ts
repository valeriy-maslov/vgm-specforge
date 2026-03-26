import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createPreparedProject, moveToReadyToComplete, prepareRunAtPlanApproved, previewApproveAndSync } from "./workflow-helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: work type variants", () => {
  it("runs refinement workflow end-to-end", async () => {
    const projectRoot = await createPreparedProject({
      prefix: "specforge-e2e-refinement-",
    });
    tempDirectories.push(projectRoot);

    const run = await prepareRunAtPlanApproved({
      projectRoot,
      title: "Refinement flow",
      prompt: "Refine checkout behavior",
      workType: "refinement",
      sectionId: "sec-refinement",
    });

    expect(run.workType).toBe("refinement");

    await moveToReadyToComplete(projectRoot, run);
    const result = await previewApproveAndSync(projectRoot, run);

    expect(result.sync.state).toBe("completed");
    expect(result.sync.result.success).toBe(true);
    const operationPaths = (result.preview.preview.operations as Array<{ path: string }>).map((operation) => operation.path);
    expect(operationPaths).toContain("docs/master/features/affected-feature-specs-index.md");
  });

  it("runs refactor workflow end-to-end with refactor-specific sync operations", async () => {
    const projectRoot = await createPreparedProject({
      prefix: "specforge-e2e-refactor-",
    });
    tempDirectories.push(projectRoot);

    const run = await prepareRunAtPlanApproved({
      projectRoot,
      title: "Refactor flow",
      prompt: "Refactor core modules",
      workType: "refactor",
      sectionId: "sec-refactor",
    });

    expect(run.workType).toBe("refactor");

    await moveToReadyToComplete(projectRoot, run);
    const result = await previewApproveAndSync(projectRoot, run);

    expect(result.sync.state).toBe("completed");
    expect(result.sync.result.success).toBe(true);

    const operationPaths = (result.preview.preview.operations as Array<{ path: string }>).map((operation) => operation.path);
    expect(operationPaths).toContain("docs/master/architecture.md");
    expect(operationPaths).toContain("docs/master/implementation.md");
    expect(operationPaths).toContain("docs/master/features/affected-feature-specs.md");
    expect(operationPaths).not.toContain("docs/master/features/affected-feature-specs-index.md");
  });
});
