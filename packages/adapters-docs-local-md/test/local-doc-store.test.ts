import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncChangeSet } from "@specforge/contracts";
import { LocalMarkdownDocStore } from "../src/local-doc-store.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LocalMarkdownDocStore", () => {
  it("produces deterministic sync previews", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "specforge-doc-store-"));
    tempDirectories.push(rootDir);

    await mkdir(join(rootDir, "docs"), { recursive: true });
    await writeFile(join(rootDir, "docs/existing.md"), "# Existing\n", "utf8");

    const store = new LocalMarkdownDocStore({ rootDir });
    const changeSet: SyncChangeSet = {
      run: {
        branchName: "sf/feature/docs",
        startedAt: "2026-03-25T00:00:00.000Z",
      },
      operations: [
        { kind: "update", path: "docs/z.md", description: "update z" },
        { kind: "create", path: "docs/a.md", description: "create a" },
        { kind: "delete", path: "docs/missing.md", description: "remove missing" },
      ],
    };

    const previewOne = await store.planSync(changeSet);
    const previewTwo = await store.planSync(changeSet);

    expect(previewOne.operations).toEqual(previewTwo.operations);
    expect(previewOne.operations.map((operation) => operation.path)).toEqual([
      "docs/a.md",
      "docs/missing.md",
      "docs/z.md",
    ]);
    expect(previewOne.warnings.some((warning) => warning.includes("missing file"))).toBe(true);
  });

  it("plans large sync previews within a bounded time", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "specforge-doc-store-"));
    tempDirectories.push(rootDir);

    const store = new LocalMarkdownDocStore({ rootDir });
    const operations: SyncChangeSet["operations"] = [];
    for (let index = 0; index < 2000; index += 1) {
      operations.push({
        kind: "create",
        path: `docs/perf/doc-${index.toString().padStart(4, "0")}.md`,
        description: `create doc ${index}`,
      });
    }

    const startedAt = Date.now();
    const preview = await store.planSync({
      run: {
        branchName: "sf/feature/perf",
        startedAt: "2026-03-26T12:00:00.000Z",
      },
      operations,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(preview.operations).toHaveLength(2000);
    expect(preview.warnings).toEqual([]);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("applies sync operations atomically and supports section-id backfill", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "specforge-doc-store-"));
    tempDirectories.push(rootDir);

    const store = new LocalMarkdownDocStore({ rootDir });

    const changeSet: SyncChangeSet = {
      run: {
        branchName: "sf/feature/docs",
        startedAt: "2026-03-25T00:10:00.000Z",
      },
      operations: [
        { kind: "create", path: "docs/master/root-spec.md", description: "create root spec" },
        { kind: "create", path: "docs/master/features/alpha.md", description: "create alpha spec" },
      ],
      metadata: {
        contents: {
          "docs/master/root-spec.md": "# Root\n## Index\n",
          "docs/master/features/alpha.md": "# Alpha\n## Scope\n",
        },
      },
    };

    const result = await store.applySync(changeSet);
    expect(result.success).toBe(true);
    expect(result.appliedOperations).toHaveLength(2);

    const rootSpec = await readFile(join(rootDir, "docs/master/root-spec.md"), "utf8");
    expect(rootSpec).toContain("# Root");

    const backfill = await store.ensureSectionIds("docs/master/root-spec.md");
    expect(backfill.generated.length).toBe(2);
    const backfilledDoc = await readFile(join(rootDir, "docs/master/root-spec.md"), "utf8");
    expect(backfilledDoc).toContain("{#sec-root}");
    expect(backfilledDoc).toContain("{#sec-index}");
  });

  it("rejects document paths that escape repository root", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "specforge-doc-store-"));
    tempDirectories.push(rootDir);

    const store = new LocalMarkdownDocStore({ rootDir });

    await expect(
      store.load({
        path: "../outside.md",
      }),
    ).rejects.toThrow("escapes repository root");

    await expect(
      store.applySync({
        run: {
          branchName: "sf/feature/docs",
          startedAt: "2026-03-25T00:20:00.000Z",
        },
        operations: [
          {
            kind: "create",
            path: "../outside.md",
            description: "invalid path",
          },
        ],
      }),
    ).rejects.toThrow("escapes repository root");
  });

  it("rejects symlink traversal outside repository root", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "specforge-doc-store-"));
    tempDirectories.push(rootDir);

    const outsideDir = await mkdtemp(join(tmpdir(), "specforge-doc-store-outside-"));
    tempDirectories.push(outsideDir);

    await symlink(outsideDir, join(rootDir, "docs-link"));

    const store = new LocalMarkdownDocStore({ rootDir });

    await expect(
      store.applySync({
        run: {
          branchName: "sf/feature/docs",
          startedAt: "2026-03-25T00:30:00.000Z",
        },
        operations: [
          {
            kind: "create",
            path: "docs-link/escaped.md",
            description: "attempt symlink escape",
          },
        ],
      }),
    ).rejects.toThrow("symbolic link");
  });
});
