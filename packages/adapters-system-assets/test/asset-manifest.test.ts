import { describe, expect, it } from "vitest";
import {
  createManagedAssetManifest,
  normalizeManagedAssetPath,
  validateManagedAssetManifest,
  verifyManagedAssetBundle,
} from "../src/asset-manifest.js";
import { sha256Hex } from "../src/checksum.js";

describe("asset-manifest", () => {
  it("creates deterministic manifest entries with checksums", () => {
    const manifest = createManagedAssetManifest(
      {
        "skills/review.md": "review skill",
        "prompts/start.md": "start prompt",
        "command-contracts/system-update.json": "{\"command\":\"system update\"}",
      },
      "2026-03-26T00:00:00.000Z",
    );

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generatedAt).toBe("2026-03-26T00:00:00.000Z");
    expect(manifest.files.map((file) => file.path)).toEqual([
      "command-contracts/system-update.json",
      "prompts/start.md",
      "skills/review.md",
    ]);
    expect(manifest.files[1]?.sha256).toBe(sha256Hex("start prompt"));
    expect(manifest.files[1]?.bytes).toBe(Buffer.byteLength("start prompt"));
  });

  it("validates and normalizes manifest paths", () => {
    const manifest = validateManagedAssetManifest({
      schemaVersion: 1,
      generatedAt: "2026-03-26T08:30:00.000Z",
      files: [
        {
          path: "skills\\planner.md",
          sha256: sha256Hex("planner"),
          bytes: Buffer.byteLength("planner"),
        },
      ],
    });

    expect(manifest.files[0]?.path).toBe("skills/planner.md");
  });

  it("rejects paths outside supported managed layout", () => {
    expect(() => normalizeManagedAssetPath("README.md")).toThrow("supported root and file name");
    expect(() => normalizeManagedAssetPath("../skills/review.md")).toThrow("traversal segments");
  });

  it("reports missing extra and mismatched bundle files", () => {
    const manifest = createManagedAssetManifest({
      "prompts/start.md": "start",
      "skills/review.md": "review",
    });

    const verification = verifyManagedAssetBundle(manifest, {
      "prompts/start.md": "start changed",
      "command-contracts/new.json": "{}",
    });

    expect(verification.missingFiles).toEqual(["skills/review.md"]);
    expect(verification.extraFiles).toEqual(["command-contracts/new.json"]);
    expect(verification.checksumMismatches).toEqual(["prompts/start.md"]);
  });
});
