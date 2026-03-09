import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@docproof/core": path.resolve(__dirname, "packages/core/src"),
    },
  },
});
