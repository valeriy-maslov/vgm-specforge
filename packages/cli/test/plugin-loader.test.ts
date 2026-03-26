import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimePlugins } from "../src/composition/plugin-loader.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("loadRuntimePlugins", () => {
  it("fails when audit configuration is missing", async () => {
    await expect(
      loadRuntimePlugins({
        projectRoot: "/repo",
        config: {},
      }),
    ).rejects.toThrow("config.audit is required");
  });

  it("fails on unsupported audit provider", async () => {
    await expect(
      loadRuntimePlugins({
        projectRoot: "/repo",
        config: {
          audit: {
            driver: "sqlite",
            connectionString: "postgres://localhost/specforge",
          },
        },
      }),
    ).rejects.toThrow("config.audit.driver must be 'postgres' or 'memory'");
  });

  it("loads memory audit plugin without postgres connection", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-plugin-loader-"));
    tempDirectories.push(projectRoot);

    const runtime = await loadRuntimePlugins({
      projectRoot,
      config: {
        audit: {
          driver: "memory",
        },
      },
    });

    await runtime.close();
  });

  it("fails on unsupported docs store provider", async () => {
    await expect(
      loadRuntimePlugins({
        projectRoot: "/repo",
        config: {
          audit: {
            connectionString: "postgres://localhost/specforge",
          },
          docsStore: {
            provider: "remote-store",
          },
        },
      }),
    ).rejects.toThrow("config.docsStore.provider must be 'local-md'");
  });

  it("fails on unsupported pull request provider", async () => {
    await expect(
      loadRuntimePlugins({
        projectRoot: "/repo",
        config: {
          audit: {
            driver: "memory",
          },
          pullRequest: {
            provider: "gh",
          },
        },
      }),
    ).rejects.toThrow("config.pullRequest.provider must be 'none' or 'memory'");
  });

  it("loads memory pull request provider and creates a URL", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-plugin-loader-pr-"));
    tempDirectories.push(projectRoot);

    const runtime = await loadRuntimePlugins({
      projectRoot,
      config: {
        audit: {
          driver: "memory",
        },
        pullRequest: {
          provider: "memory",
          mode: "success",
          url: "https://example.com/pr/77",
        },
      },
    });

    const result = await runtime.pullRequestPort?.create({
      branchName: "sf/feature/x",
      title: "PR",
    });

    expect(result?.url).toBe("https://example.com/pr/77");
    await runtime.close();
  });
});
