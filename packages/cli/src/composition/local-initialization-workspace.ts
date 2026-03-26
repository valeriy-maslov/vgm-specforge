import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { LocalMarkdownDocStore } from "@specforge/adapters-docs-local-md";
import {
  type InitializationBootstrapInput,
  type InitializationBootstrapOutput,
  type InitializationFinding,
  type InitializationScanSummary,
  type InitializationWorkspacePort,
} from "@specforge/contracts";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".specforge", "dist", "coverage"]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
]);

interface WorkspaceScan {
  summary: InitializationScanSummary;
  files: Set<string>;
}

interface ArtifactSpec {
  path: string;
  body(input: InitializationBootstrapInput): string;
}

const NEW_MODE_ARTIFACTS: readonly ArtifactSpec[] = [
  {
    path: "README.md",
    body: (input) => `# ${input.projectName?.trim() || "Project"}\n\nInitialized with SpecForge.\n`,
  },
  {
    path: "AGENTS.md",
    body: () => "# AGENTS.md\n\nProject-level guidance for coding agents.\n",
  },
  {
    path: "CONSTITUTION.md",
    body: (input) => `# Project Constitution\n\nProject: ${input.projectName?.trim() || "Project"}\n\n- Follow spec-driven delivery.\n- Preserve workflow hard-gate policies.\n`,
  },
  {
    path: "docs/master/root-spec.md",
    body: (input) =>
      `# Root Master Spec\n\n## Product\n\n${input.projectName?.trim() || "Project"}\n\n## Master Feature Index\n\n- Placeholder entry\n`,
  },
];

const EXISTING_MODE_ARTIFACTS: readonly ArtifactSpec[] = [
  {
    path: "CONSTITUTION.md",
    body: (input) => `# Project Constitution\n\nProject: ${input.projectName?.trim() || "Project"}\n\n- Follow spec-driven delivery.\n`,
  },
  {
    path: "docs/master/root-spec.md",
    body: (input) =>
      `# Root Master Spec\n\n## Product\n\n${input.projectName?.trim() || "Project"}\n\n## Master Feature Index\n\n- Placeholder entry\n`,
  },
  {
    path: "AGENTS.md",
    body: () => "# AGENTS.md\n\nProject-level guidance for coding agents.\n",
  },
];

export interface LocalInitializationWorkspaceOptions {
  projectRoot: string;
}

export class LocalInitializationWorkspace implements InitializationWorkspacePort {
  private readonly projectRoot: string;

  constructor(options: LocalInitializationWorkspaceOptions) {
    this.projectRoot = resolve(options.projectRoot);
  }

  async bootstrap(input: InitializationBootstrapInput): Promise<InitializationBootstrapOutput> {
    const scan = await scanWorkspace(this.projectRoot, input.nowIso);
    const preInitializationFiles = new Set(scan.files);
    const createdArtifacts: string[] = [];
    const updatedArtifacts: string[] = [];
    const artifacts = this.artifactsForMode(input.mode, scan.files);

    for (const artifact of artifacts) {
      const relativePath = toPosixPath(artifact.path);
      if (scan.files.has(relativePath)) {
        continue;
      }

      const absolutePath = resolve(this.projectRoot, relativePath);
      await mkdir(dirname(absolutePath), {
        recursive: true,
      });
      await writeFile(absolutePath, withTrailingNewline(artifact.body(input)), "utf8");
      createdArtifacts.push(relativePath);
      scan.files.add(relativePath);
    }

    await backfillMasterDocSectionIds(this.projectRoot, {
      onUpdated: (path) => {
        if (createdArtifacts.includes(path) || updatedArtifacts.includes(path)) {
          return;
        }
        updatedArtifacts.push(path);
      },
    });

    const reconciliationFindings = buildReconciliationFindings(preInitializationFiles, scan.summary, input);
    const reconciliationRequired = input.mode === "existing" && reconciliationFindings.length > 0;

    const reconciliationReportPath = reconciliationRequired
      ? await writeReconciliationReport({
          projectRoot: this.projectRoot,
          summary: scan.summary,
          findings: reconciliationFindings,
          ...(input.promptContext !== undefined
            ? {
                promptContext: input.promptContext,
              }
            : {}),
        })
      : undefined;

    const generatedArtifacts = uniqueSorted([...createdArtifacts, ...updatedArtifacts]);

    return {
      generatedArtifacts,
      createdArtifacts: uniqueSorted(createdArtifacts),
      updatedArtifacts: uniqueSorted(updatedArtifacts),
      reconciliationRequired,
      reconciliationFindings,
      ...(reconciliationReportPath !== undefined
        ? {
            reconciliationReportPath,
          }
        : {}),
      scanSummary: scan.summary,
    };
  }

  private artifactsForMode(mode: InitializationBootstrapInput["mode"], scannedFiles: ReadonlySet<string>): ArtifactSpec[] {
    if (mode === "new") {
      return [...NEW_MODE_ARTIFACTS];
    }

    return EXISTING_MODE_ARTIFACTS.filter((artifact) => artifact.path !== "AGENTS.md" || !scannedFiles.has("AGENTS.md"));
  }
}

async function scanWorkspace(projectRoot: string, scannedAt: string): Promise<WorkspaceScan> {
  const files = new Set<string>();
  let sourceFileCount = 0;
  let markdownDocCount = 0;

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = toPosixPath(relative(projectRoot, absolutePath));

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.add(relativePath);

      if (relativePath.endsWith(".md")) {
        markdownDocCount += 1;
      }

      const extension = extensionOf(relativePath);
      if (extension !== null && SOURCE_EXTENSIONS.has(extension)) {
        sourceFileCount += 1;
      }
    }
  };

  await walk(projectRoot);

  return {
    summary: {
      scannedAt,
      fileCount: files.size,
      sourceFileCount,
      markdownDocCount,
    },
    files,
  };
}

function buildReconciliationFindings(
  files: ReadonlySet<string>,
  summary: InitializationScanSummary,
  input: InitializationBootstrapInput,
): InitializationFinding[] {
  if (input.mode !== "existing") {
    return [];
  }

  const findings: InitializationFinding[] = [];

  if (!files.has("CONSTITUTION.md")) {
    findings.push({
      code: "missing_constitution",
      message: "Existing project is missing CONSTITUTION.md before initialization.",
    });
  }

  if (!files.has("docs/master/root-spec.md")) {
    findings.push({
      code: "missing_root_master_spec",
      message: "Existing project is missing docs/master/root-spec.md before initialization.",
    });
  }

  if (summary.sourceFileCount > 0 && summary.markdownDocCount === 0) {
    findings.push({
      code: "code_without_docs",
      message: "Source files exist, but no markdown documentation was found.",
    });
  }

  const sourceTokens = sourceModuleTokens(files);
  const featureSpecTokens = masterFeatureSpecTokens(files);

  if (sourceTokens.size > 0 && featureSpecTokens.size === 0) {
    findings.push({
      code: "missing_feature_specs",
      message: "Source modules were detected, but no docs/master/features/*.md specs were found.",
    });
  }

  const uncoveredSourceTokens = [...sourceTokens].filter((token) => !featureSpecTokens.has(token));
  if (uncoveredSourceTokens.length > 0) {
    findings.push({
      code: "source_to_spec_mismatch",
      message: `Detected source areas without matching feature specs: ${uncoveredSourceTokens.slice(0, 5).join(", ")}`,
    });
  }

  if (typeof input.promptContext === "string" && input.promptContext.trim().length > 0) {
    findings.push({
      code: "prompt_context_review",
      message: "Initialization prompt context was provided and must be reviewed in reconciliation.",
    });
  }

  return findings;
}

async function writeReconciliationReport(args: {
  projectRoot: string;
  summary: InitializationScanSummary;
  findings: readonly InitializationFinding[];
  promptContext?: string;
}): Promise<string> {
  const reportPath = ".specforge/reports/initialization-reconciliation.md";
  const absolutePath = resolve(args.projectRoot, reportPath);

  await mkdir(dirname(absolutePath), {
    recursive: true,
  });

  const lines: string[] = [];
  lines.push("# Initialization Reconciliation Report");
  lines.push("");
  lines.push(`Generated at: ${args.summary.scannedAt}`);
  lines.push("");
  lines.push("## Scan Summary");
  lines.push("");
  lines.push(`- Files scanned: ${args.summary.fileCount}`);
  lines.push(`- Source files: ${args.summary.sourceFileCount}`);
  lines.push(`- Markdown docs: ${args.summary.markdownDocCount}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  for (const finding of args.findings) {
    lines.push(`- [${finding.code}] ${finding.message}`);
  }

  if (typeof args.promptContext === "string" && args.promptContext.trim().length > 0) {
    lines.push("");
    lines.push("## Prompt Context");
    lines.push("");
    lines.push(args.promptContext.trim());
  }

  await writeFile(absolutePath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

async function backfillMasterDocSectionIds(
  projectRoot: string,
  options: {
    onUpdated(path: string): void;
  },
): Promise<void> {
  const docsMasterDir = resolve(projectRoot, "docs/master");
  const exists = await pathExists(docsMasterDir);
  if (!exists) {
    return;
  }

  const markdownFiles = await collectMarkdownFiles(projectRoot, docsMasterDir);
  if (markdownFiles.length === 0) {
    return;
  }

  const store = new LocalMarkdownDocStore({
    rootDir: projectRoot,
  });

  for (const filePath of markdownFiles) {
    const backfill = await store.ensureSectionIds(filePath);
    if (backfill.generated.length > 0) {
      options.onUpdated(filePath);
    }
  }
}

async function collectMarkdownFiles(projectRoot: string, rootDir: string): Promise<string[]> {
  const collected: string[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      collected.push(toPosixPath(relative(projectRoot, absolutePath)));
    }
  };

  await walk(rootDir);
  return collected;
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function extensionOf(pathValue: string): string | null {
  const index = pathValue.lastIndexOf(".");
  if (index <= 0 || index === pathValue.length - 1) {
    return null;
  }

  return pathValue.slice(index).toLowerCase();
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sourceModuleTokens(files: ReadonlySet<string>): Set<string> {
  const tokens = new Set<string>();

  for (const path of files) {
    if (!isSourceFilePath(path)) {
      continue;
    }

    if (path.startsWith("src/")) {
      const segments = path.split("/");
      const token = segments[1] ?? stripExtension(segments[0] ?? "");
      const normalized = normalizeToken(token);
      if (normalized.length > 0) {
        tokens.add(normalized);
      }
      continue;
    }

    if (path.startsWith("packages/")) {
      const token = path.split("/")[1] ?? "";
      const normalized = normalizeToken(token);
      if (normalized.length > 0) {
        tokens.add(normalized);
      }
      continue;
    }

    const fileName = path.split("/").pop() ?? "";
    const normalized = normalizeToken(stripExtension(fileName));
    if (normalized.length > 0) {
      tokens.add(normalized);
    }
  }

  return tokens;
}

function masterFeatureSpecTokens(files: ReadonlySet<string>): Set<string> {
  const tokens = new Set<string>();

  for (const path of files) {
    if (!path.startsWith("docs/master/features/") || !path.endsWith(".md")) {
      continue;
    }

    const fileName = path.split("/").pop() ?? "";
    const token = normalizeToken(stripExtension(fileName));
    if (token.length > 0) {
      tokens.add(token);
    }
  }

  return tokens;
}

function isSourceFilePath(path: string): boolean {
  const extension = extensionOf(path);
  return extension !== null && SOURCE_EXTENSIONS.has(extension);
}

function stripExtension(pathSegment: string): string {
  const dotIndex = pathSegment.lastIndexOf(".");
  if (dotIndex <= 0) {
    return pathSegment;
  }

  return pathSegment.slice(0, dotIndex);
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}
