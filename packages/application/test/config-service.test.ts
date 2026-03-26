import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultConfigService } from "../src/services/config-service.js";
import { InMemoryConfigStore } from "./helpers/in-memory.js";

describe("DefaultConfigService", () => {
  it("returns full config when key is omitted", async () => {
    const configStore = new InMemoryConfigStore();
    configStore.seed("/repo", {
      mainBranch: "main",
      audit: {
        schema: "public",
      },
    });

    const service = new DefaultConfigService({
      configStore,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.get({}, context);
    expect(output.value).toMatchObject({
      mainBranch: "main",
      audit: {
        schema: "public",
      },
    });
  });

  it("returns nested value by dotted key", async () => {
    const configStore = new InMemoryConfigStore();
    configStore.seed("/repo", {
      systemAssets: {
        assetsDir: ".specforge/assets",
      },
    });

    const service = new DefaultConfigService({
      configStore,
    });

    const context = createCommandContext({
      actor: { kind: "user" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.get(
      {
        key: "systemAssets.assetsDir",
      },
      context,
    );

    expect(output.value).toBe(".specforge/assets");
  });

  it("sets nested value and returns previous value", async () => {
    const configStore = new InMemoryConfigStore();
    configStore.seed("/repo", {
      audit: {
        schema: "public",
      },
    });

    const service = new DefaultConfigService({
      configStore,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const output = await service.set(
      {
        key: "audit.schema",
        value: "specforge",
      },
      context,
    );

    expect(output).toEqual({
      key: "audit.schema",
      previousValue: "public",
      currentValue: "specforge",
    });

    const stored = await configStore.load("/repo");
    expect(stored).toMatchObject({
      audit: {
        schema: "specforge",
      },
    });
  });

  it("rejects empty config key", async () => {
    const configStore = new InMemoryConfigStore();
    const service = new DefaultConfigService({
      configStore,
    });

    const context = createCommandContext({
      actor: { kind: "user" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await expect(
      service.set(
        {
          key: "",
          value: "x",
        },
        context,
      ),
    ).rejects.toThrow("config key cannot be empty");
  });
});
