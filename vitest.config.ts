import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/tests/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["src/tests/**/*.e2e.test.ts", "tests/**/*.e2e.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
