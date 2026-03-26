import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManagedAssetManifest } from "../src/asset-manifest.js";
import { ManagedSystemAssetsAdapter } from "../src/managed-system-assets-adapter.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ManagedSystemAssetsAdapter", () => {
  it("loads assets from manifest and applies managed updates", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-project-"));
    const assetsRoot = await mkdtemp(join(tmpdir(), "specforge-assets-"));
    tempDirectories.push(projectRoot, assetsRoot);

    const assetFiles = {
      "prompts/start.md": "# Start\n",
      "skills/review.md": "# Review\n",
    };

    const manifest = createManagedAssetManifest(assetFiles, "2026-03-26T15:00:00.000Z");
    await writeFile(join(assetsRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    for (const [path, content] of Object.entries(assetFiles)) {
      const absolutePath = join(assetsRoot, path);
      await mkdir(dirname(absolutePath), {
        recursive: true,
      });
      await writeFile(absolutePath, content, "utf8");
    }

    const adapter = new ManagedSystemAssetsAdapter({
      projectRoot,
      assetsDir: assetsRoot,
      manifestPath: join(assetsRoot, "manifest.json"),
    });

    const preview = await adapter.update({ dryRun: true });
    expect(preview.updatedFiles).toEqual(["prompts/start.md", "skills/review.md"]);

    await expect(readFile(join(projectRoot, ".specforge/system/prompts/start.md"), "utf8")).rejects.toThrow();

    const result = await adapter.update({});
    expect(result.updatedFiles).toEqual(["prompts/start.md", "skills/review.md"]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.removedFiles).toEqual([]);

    const storedPrompt = await readFile(join(projectRoot, ".specforge/system/prompts/start.md"), "utf8");
    expect(storedPrompt).toBe("# Start\n");
  });

  it("fails when manifest references missing source files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-project-"));
    const assetsRoot = await mkdtemp(join(tmpdir(), "specforge-assets-"));
    tempDirectories.push(projectRoot, assetsRoot);

    const manifest = createManagedAssetManifest({
      "prompts/start.md": "# Start\n",
    });
    await writeFile(join(assetsRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const adapter = new ManagedSystemAssetsAdapter({
      projectRoot,
      assetsDir: assetsRoot,
      manifestPath: join(assetsRoot, "manifest.json"),
    });

    await expect(adapter.update({})).rejects.toThrow("unable to read managed asset source file");
  });
});
