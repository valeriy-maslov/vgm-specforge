import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalInitializationWorkspace } from "../src/composition/local-initialization-workspace.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LocalInitializationWorkspace", () => {
  it("creates required artifacts for new mode and backfills section ids", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-init-workspace-new-"));
    tempDirectories.push(projectRoot);

    const workspace = new LocalInitializationWorkspace({
      projectRoot,
    });

    const output = await workspace.bootstrap({
      projectRoot,
      mode: "new",
      projectName: "Demo",
      nowIso: "2026-03-26T09:30:00.000Z",
    });

    expect(output.createdArtifacts).toEqual(
      expect.arrayContaining(["README.md", "AGENTS.md", "CONSTITUTION.md", "docs/master/root-spec.md"]),
    );

    const rootSpec = await readFile(join(projectRoot, "docs/master/root-spec.md"), "utf8");
    expect(rootSpec).toContain("{#sec-root-master-spec}");
    expect(rootSpec).toContain("{#sec-product}");
  });

  it("does not generate AGENTS.md in existing mode when already present", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-init-workspace-existing-agents-"));
    tempDirectories.push(projectRoot);

    await writeFile(join(projectRoot, "AGENTS.md"), "# Existing\n", "utf8");

    const workspace = new LocalInitializationWorkspace({
      projectRoot,
    });

    const output = await workspace.bootstrap({
      projectRoot,
      mode: "existing",
      nowIso: "2026-03-26T09:40:00.000Z",
    });

    expect(output.createdArtifacts).not.toContain("AGENTS.md");
  });

  it("generates reconciliation report for existing mode mismatches", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-init-workspace-existing-report-"));
    tempDirectories.push(projectRoot);

    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src/index.ts"), "export const x = 1;\n", "utf8");

    const workspace = new LocalInitializationWorkspace({
      projectRoot,
    });

    const output = await workspace.bootstrap({
      projectRoot,
      mode: "existing",
      promptContext: "Please reconcile docs with current code",
      nowIso: "2026-03-26T09:50:00.000Z",
    });

    expect(output.reconciliationRequired).toBe(true);
    expect(output.reconciliationFindings.length).toBeGreaterThan(0);
    expect(output.reconciliationReportPath).toBe(".specforge/reports/initialization-reconciliation.md");

    const report = await readFile(join(projectRoot, ".specforge/reports/initialization-reconciliation.md"), "utf8");
    expect(report).toContain("Initialization Reconciliation Report");
    expect(report).toContain("missing_root_master_spec");
  });
});
