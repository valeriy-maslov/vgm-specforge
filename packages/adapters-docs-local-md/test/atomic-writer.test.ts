import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncOperation } from "@specforge/contracts";
import { AtomicFileWriter } from "../src/atomic-writer.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AtomicFileWriter", () => {
  it("rolls back all files on failure", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "specforge-docs-atomic-"));
    tempDirectories.push(rootDir);

    await writeFile(join(rootDir, "existing.md"), "existing\n", "utf8");

    const writer = new AtomicFileWriter();
    const operations: SyncOperation[] = [
      {
        kind: "update",
        path: "existing.md",
        description: "update existing",
      },
      {
        kind: "create",
        path: "created.md",
        description: "create new",
      },
    ];

    await expect(
      writer.apply({
        rootDir,
        operations,
        contentForOperation: async (operation) => {
          if (operation.path === "created.md") {
            throw new Error("simulated failure");
          }
          return "updated\n";
        },
      }),
    ).rejects.toThrow("rolled back changes");

    const existing = await readFile(join(rootDir, "existing.md"), "utf8");
    expect(existing).toBe("existing\n");

    await expect(readFile(join(rootDir, "created.md"), "utf8")).rejects.toThrow();
  });
});
