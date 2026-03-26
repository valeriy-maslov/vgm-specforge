import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildManagedAssetBundle, FileSystemAssetUpdater } from "../src/asset-updater.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FileSystemAssetUpdater", () => {
  it("writes managed assets and manifest into the system directory", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-assets-"));
    tempDirectories.push(projectRoot);

    const updater = new FileSystemAssetUpdater({ projectRoot });
    const bundle = buildManagedAssetBundle(
      {
        "prompts/start.md": "# Start\n",
        "skills/review.md": "# Review\n",
      },
      "2026-03-26T10:00:00.000Z",
    );

    const result = await updater.update({ bundle });

    expect(result.updatedFiles).toEqual(["prompts/start.md", "skills/review.md"]);
    expect(result.skippedFiles).toEqual([]);
    expect(result.removedFiles).toEqual([]);

    const startPrompt = await readFile(join(projectRoot, ".specforge/system/prompts/start.md"), "utf8");
    expect(startPrompt).toBe("# Start\n");

    const manifest = JSON.parse(await readFile(join(projectRoot, ".specforge/system/manifest.json"), "utf8")) as {
      files: Array<{ path: string }>;
    };
    expect(manifest.files.map((entry) => entry.path)).toEqual(["prompts/start.md", "skills/review.md"]);
  });

  it("updates only managed files and keeps unmanaged files untouched", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-assets-"));
    tempDirectories.push(projectRoot);

    const updater = new FileSystemAssetUpdater({ projectRoot });
    const initialBundle = buildManagedAssetBundle(
      {
        "prompts/start.md": "# Start\n",
        "skills/review.md": "# Review\n",
      },
      "2026-03-26T11:00:00.000Z",
    );

    await updater.update({ bundle: initialBundle });
    await writeFile(join(projectRoot, ".specforge/system/local-notes.md"), "local", "utf8");

    const nextBundle = buildManagedAssetBundle(
      {
        "prompts/start.md": "# Start v2\n",
        "command-contracts/system-update.json": "{\"name\":\"system update\"}\n",
      },
      "2026-03-26T11:30:00.000Z",
    );

    const result = await updater.update({ bundle: nextBundle });

    expect(result.updatedFiles).toEqual(["command-contracts/system-update.json", "prompts/start.md"]);
    expect(result.removedFiles).toEqual(["skills/review.md"]);

    const unmanaged = await readFile(join(projectRoot, ".specforge/system/local-notes.md"), "utf8");
    expect(unmanaged).toBe("local");

    const updatedPrompt = await readFile(join(projectRoot, ".specforge/system/prompts/start.md"), "utf8");
    expect(updatedPrompt).toBe("# Start v2\n");
  });

  it("supports dry-run previews without changing files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-assets-"));
    tempDirectories.push(projectRoot);

    const updater = new FileSystemAssetUpdater({ projectRoot });
    const initialBundle = buildManagedAssetBundle(
      {
        "prompts/start.md": "# Start\n",
      },
      "2026-03-26T12:00:00.000Z",
    );

    await updater.update({ bundle: initialBundle });

    const nextBundle = buildManagedAssetBundle(
      {
        "prompts/start.md": "# Start changed\n",
      },
      "2026-03-26T12:30:00.000Z",
    );

    const preview = await updater.preview(nextBundle);
    expect(preview.updatedFiles).toEqual(["prompts/start.md"]);

    const fileAfterPreview = await readFile(join(projectRoot, ".specforge/system/prompts/start.md"), "utf8");
    expect(fileAfterPreview).toBe("# Start\n");
  });

  it("fails when bundle content does not match manifest checksums", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-assets-"));
    tempDirectories.push(projectRoot);

    const updater = new FileSystemAssetUpdater({ projectRoot });
    const bundle = buildManagedAssetBundle(
      {
        "prompts/start.md": "# Start\n",
      },
      "2026-03-26T13:00:00.000Z",
    );

    const tamperedBundle = {
      ...bundle,
      manifest: {
        ...bundle.manifest,
        files: bundle.manifest.files.map((file, index) =>
          index === 0
            ? {
                ...file,
                sha256: "0".repeat(64),
              }
            : file,
        ),
      },
    };

    await expect(updater.update({ bundle: tamperedBundle })).rejects.toThrow("does not match manifest");
  });
});
