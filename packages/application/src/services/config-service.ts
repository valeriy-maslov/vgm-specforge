import { SpecforgeError, type ConfigGetInput, type ConfigGetOutput, type ConfigSetInput, type ConfigSetOutput, type ConfigStore } from "@specforge/contracts";
import type { CommandContext } from "../orchestration/command-context.js";

export interface ConfigService {
  get(input: ConfigGetInput, ctx: CommandContext): Promise<ConfigGetOutput>;
  set(input: ConfigSetInput, ctx: CommandContext): Promise<ConfigSetOutput>;
}

export interface ConfigServiceDependencies {
  configStore: ConfigStore;
}

export class DefaultConfigService implements ConfigService {
  private readonly configStore: ConfigStore;

  constructor(dependencies: ConfigServiceDependencies) {
    this.configStore = dependencies.configStore;
  }

  async get(input: ConfigGetInput, ctx: CommandContext): Promise<ConfigGetOutput> {
    const config = await this.configStore.load(ctx.projectRoot);
    if (input.key === undefined) {
      return {
        value: config,
      };
    }

    return {
      value: readByPath(config, input.key),
    };
  }

  async set(input: ConfigSetInput, ctx: CommandContext): Promise<ConfigSetOutput> {
    if (input.key.trim().length === 0) {
      throw new SpecforgeError("CONFIG_ERROR", "config key cannot be empty");
    }

    const current = await this.configStore.load(ctx.projectRoot);
    const previousValue = readByPath(current, input.key);
    const next = writeByPath(current, input.key, input.value);
    await this.configStore.save(ctx.projectRoot, next);

    return {
      key: input.key,
      previousValue,
      currentValue: input.value,
    };
  }
}

function readByPath(config: Record<string, unknown>, dottedPath: string): unknown {
  const segments = parsePathSegments(dottedPath);

  let current: unknown = config;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function writeByPath(config: Record<string, unknown>, dottedPath: string, value: unknown): Record<string, unknown> {
  const segments = parsePathSegments(dottedPath);
  const next = structuredClone(config);

  let cursor: Record<string, unknown> = next;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    const isLeaf = index === segments.length - 1;

    if (isLeaf) {
      cursor[segment] = value;
      continue;
    }

    const existing = cursor[segment];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      const nested: Record<string, unknown> = {};
      cursor[segment] = nested;
      cursor = nested;
      continue;
    }

    cursor = existing as Record<string, unknown>;
  }

  return next;
}

function parsePathSegments(dottedPath: string): string[] {
  const segments = dottedPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new SpecforgeError("CONFIG_ERROR", "config key cannot be empty");
  }

  return segments;
}
