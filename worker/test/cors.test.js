import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { env } from "cloudflare:test";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

describe("CORS route ordering", () => {
  it("webhook is reachable without Origin header (server-to-server)", async () => {
    const req = new Request("https://worker.invalid/api/billing/webhook", {
      method: "POST",
      body: "{}",
    });
    const res = await worker.fetch(req, env, ctx);
    // Must NOT be 404 (route found) and must reach the handler (401 missing signature)
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toMatch(/signature/i);
  });

  it("AI chat with disallowed Origin still reaches auth layer (not 404)", async () => {
    const req = new Request("https://worker.invalid/api/ai/chat", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    const res = await worker.fetch(req, env, ctx);
    // 403 (CORS block) or 401/400 (auth/parse) are all acceptable — NOT 404
    expect([400, 401, 403]).toContain(res.status);
  });
});
