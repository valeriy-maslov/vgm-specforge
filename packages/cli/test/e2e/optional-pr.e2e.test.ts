import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createPreparedProject, moveToReadyToComplete, prepareRunAtPlanApproved, previewApproveAndSync } from "./workflow-helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: optional pull request integration", () => {
  it("does not block completion when requested PR creation fails", async () => {
    const projectRoot = await createPreparedProject({
      prefix: "specforge-e2e-pr-failure-",
      config: {
        pullRequest: {
          provider: "memory",
          mode: "fail",
          failureMessage: "simulated pr failure",
        },
      },
    });
    tempDirectories.push(projectRoot);

    const run = await prepareRunAtPlanApproved({
      projectRoot,
      title: "PR optional",
      prompt: "Validate optional PR path",
      workType: "feature",
    });

    await moveToReadyToComplete(projectRoot, run);
    const result = await previewApproveAndSync(projectRoot, run, ["--request-pr", "--pr-title", "SpecForge PR"]).then(
      ({ sync }) => sync,
    );

    expect(result.state).toBe("completed");
    expect(result.result.success).toBe(true);
    expect(result.pullRequest.requested).toBe(true);
    expect(result.pullRequest.created).toBe(false);
    expect(String(result.pullRequest.message)).toContain("simulated pr failure");
    expect(String(result.result.message)).toContain("pull request creation failed");
  });
});
