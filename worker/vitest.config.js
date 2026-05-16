import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        d1Databases: ["CLAUGE_DB"],
        kvNamespaces: ["CLAUGE_KV"],
        bindings: {
          POLAR_WEBHOOK_SECRET: "test_webhook_secret",
          POLAR_API_KEY: "test_api_key",
          POLAR_PRODUCT_MONTHLY: "prod_test_monthly",
          POLAR_PRODUCT_YEARLY: "prod_test_yearly",
          AI_UPSTREAM_MODEL: "test-model",
          AI_UPSTREAM_API_KEY: "test_upstream_key",
          AI_UPSTREAM_URL: "https://upstream.test.invalid/chat/completions",
        },
      },
    }),
  ],
  test: {
    globalSetup: ["./test/globalSetup.js"],
    setupFiles: ["./test/setup.js"],
  },
});
