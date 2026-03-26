import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCliJson } from "./harness.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI E2E: init scenarios", () => {
  it("initializes a new project and persists bundled approval pending state", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-e2e-new-"));
    tempDirectories.push(projectRoot);

    const result = await runCliJson(["init", "--mode", "new", "--project-root", projectRoot], projectRoot);

    expect(result.code).toBe(0);
    const payload = result.json as {
      ok: boolean;
      data: {
        initialized: boolean;
        mode: string;
        pendingBundledApproval: boolean;
        generatedArtifacts: string[];
        createdArtifacts: string[];
      };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.mode).toBe("new");
    expect(payload.data.initialized).toBe(false);
    expect(payload.data.pendingBundledApproval).toBe(true);
    expect(payload.data.generatedArtifacts).toContain("README.md");
    expect(payload.data.createdArtifacts).toEqual(
      expect.arrayContaining(["README.md", "AGENTS.md", "CONSTITUTION.md", "docs/master/root-spec.md"]),
    );

    const state = JSON.parse(
      await readFile(join(projectRoot, ".specforge/state/initialization.json"), "utf8"),
    ) as {
      mode: string;
      initialized: boolean;
      pendingBundledApproval: boolean;
    };

    expect(state.mode).toBe("new");
    expect(state.initialized).toBe(false);
    expect(state.pendingBundledApproval).toBe(true);

    await expect(readFile(join(projectRoot, "README.md"), "utf8")).resolves.toContain("#");
    await expect(readFile(join(projectRoot, "AGENTS.md"), "utf8")).resolves.toContain("AGENTS");
    await expect(readFile(join(projectRoot, "CONSTITUTION.md"), "utf8")).resolves.toContain("Constitution");
    await expect(readFile(join(projectRoot, "docs/master/root-spec.md"), "utf8")).resolves.toContain("{#sec-");
  });

  it("initializes existing project with reconciliation and approval flow", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-e2e-existing-"));
    tempDirectories.push(projectRoot);

    await writeFile(join(projectRoot, "AGENTS.md"), "# Existing Agent Guide\n", "utf8");
    await writeFile(join(projectRoot, "README.md"), "# Existing\n", "utf8");

    const firstPass = await runCliJson(["init", "--mode", "existing", "--project-root", projectRoot], projectRoot);
    expect(firstPass.code).toBe(0);

    const firstPayload = firstPass.json as {
      ok: boolean;
      data: {
        mode: string;
        initialized: boolean;
        reconciliationRequired: boolean;
        pendingBundledApproval: boolean;
        reconciliationReportPath?: string;
      };
    };

    expect(firstPayload.ok).toBe(true);
    expect(firstPayload.data.mode).toBe("existing");
    expect(firstPayload.data.initialized).toBe(false);
    expect(firstPayload.data.reconciliationRequired).toBe(true);
    expect(firstPayload.data.pendingBundledApproval).toBe(true);
    expect(firstPayload.data.reconciliationReportPath).toBe(".specforge/reports/initialization-reconciliation.md");

    const approvedPass = await runCliJson(
      ["init", "--mode", "existing", "--approved", "--project-root", projectRoot],
      projectRoot,
    );
    expect(approvedPass.code).toBe(0);

    const approvedPayload = approvedPass.json as {
      ok: boolean;
      data: {
        mode: string;
        initialized: boolean;
        reconciliationRequired: boolean;
        pendingBundledApproval: boolean;
      };
    };

    expect(approvedPayload.ok).toBe(true);
    expect(approvedPayload.data.mode).toBe("existing");
    expect(approvedPayload.data.initialized).toBe(true);
    expect(approvedPayload.data.reconciliationRequired).toBe(false);
    expect(approvedPayload.data.pendingBundledApproval).toBe(false);

    const existingAgents = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(existingAgents).toContain("Existing Agent Guide");
  });
});
