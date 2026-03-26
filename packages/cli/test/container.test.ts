import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCliContainer } from "../src/composition/container.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("createCliContainer", () => {
  it("fails with CONFIG_ERROR when runtime plugins are not configured", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-container-"));
    tempDirectories.push(projectRoot);

    await expect(createCliContainer(projectRoot)).rejects.toThrow("config.audit is required");
  });

  it("creates container when memory audit provider is configured", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-container-"));
    tempDirectories.push(projectRoot);

    await mkdir(join(projectRoot, ".specforge"), {
      recursive: true,
    });
    await writeFile(
      join(projectRoot, ".specforge/config.yaml"),
      `${JSON.stringify(
        {
          audit: {
            driver: "memory",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const container = await createCliContainer(projectRoot);
    await container.close();
  });
});
