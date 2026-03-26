export interface AuditConfig {
  driver: "postgres" | "memory";
  connectionString?: string;
  schema?: string;
  filePath?: string;
}

export interface LocalMarkdownDocStoreConfig {
  provider: "local-md";
  rootDir: string;
}

export interface SystemAssetsConfig {
  manifestPath: string;
  assetsDir: string;
}

export interface PullRequestConfig {
  provider: "none" | "memory";
  mode?: "success" | "fail";
  url?: string;
  failureMessage?: string;
}

export interface SpecforgeConfig {
  initialized: boolean;
  mainBranch: string;
  audit: AuditConfig;
  docsStore: LocalMarkdownDocStoreConfig;
  systemAssets: SystemAssetsConfig;
  pullRequest?: PullRequestConfig;
  retainCompletedRunArtifactsByDefault: boolean;
}
