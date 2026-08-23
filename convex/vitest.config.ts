import { defineConfig } from "vitest/config";

/** Runs only handler integration coverage; the existing Node tests stay unchanged. */
export default defineConfig({
  test: {
    include: ["convex/**/*.integration.vitest.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
