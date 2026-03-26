import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@specforge/contracts": resolve(currentDirectory, "../contracts/src/index.ts"),
      "@specforge/application": resolve(currentDirectory, "../application/src/index.ts"),
      "@specforge/adapters-audit-postgres": resolve(currentDirectory, "../adapters-audit-postgres/src/index.ts"),
      "@specforge/adapters-docs-local-md": resolve(currentDirectory, "../adapters-docs-local-md/src/index.ts"),
      "@specforge/adapters-git": resolve(currentDirectory, "../adapters-git/src/index.ts"),
      "@specforge/adapters-system-assets": resolve(currentDirectory, "../adapters-system-assets/src/index.ts"),
    },
  },
});
