import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { entitlementsForPlan } from "../src/auth.js";
import { seedUser } from "./setup.js";

describe("entitlementsForPlan", () => {
  it("returns just the plan", () => {
    expect(entitlementsForPlan("free")).toEqual({ plan: "free" });
    expect(entitlementsForPlan("pro")).toEqual({ plan: "pro" });
  });
});

describe("/api/auth/me response (smoke)", () => {
  beforeEach(async () => {
    await env.CLAUGE_DB.prepare("DELETE FROM users").run();
  });

  it("includes credits and entitlements", async () => {
    const userId = await seedUser({ slug: "u_me" });
    await env.CLAUGE_DB.prepare(
      `UPDATE users SET plan='pro', subscription_status='active',
         credit_allowance_per_cycle=1000, credits_remaining=600,
         current_period_end='2026-06-16T00:00:00Z'
       WHERE user_id=?`
    )
      .bind(userId)
      .run();
    const { buildMeResponse } = await import("../src/auth.js");
    const resp = await buildMeResponse(env, userId);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.plan).toBe("pro");
    expect(body.entitlements.credits.remaining).toBe(600);
    expect(body.entitlements.credits.allowance).toBe(1000);
    expect(body.entitlements.credits.resets_at).toBe("2026-06-16T00:00:00Z");
  });
});

// Regression guard for the post-login race where exchange returned a thin
// `entitlements: { plan }` payload — Rust's `apply_from_entitlements` then
// populated `credits: None, subscription: None`, and the next /api/ai/balance
// event created `{remaining, allowance: 0}` until the user navigated and
// triggered a /api/auth/me fetch ~30-90s later. Exchange now returns the
// SAME enriched body as /api/auth/me (plus the tokens), so the in-memory
// snapshot is fully populated on first paint of the Account tab.
//
// Each test below covers one user tier. The intent is to prove the wire
// shape NEVER contains nulls in fields the Rust client struct requires
// (CloudCredits.{remaining,allowance}: i64, CloudSubscription.{status,
// cancel_at_period_end,is_lifetime}). Nullable fields are wrapped in
// Option<...> on the Rust side and are allowed to be null here.
describe("exchange response shape per user tier", () => {
  beforeEach(async () => {
    await env.CLAUGE_DB.prepare("DELETE FROM users").run();
  });

  /** Asserts the fields Rust's CloudCredits + CloudSubscription require
   *  to be non-null (per their non-Option types) are indeed non-null. */
  function assertRustSafeShape(body) {
    expect(body.token).toBe("fake_at");
    expect(typeof body.plan).toBe("string");
    expect(body.user).toBeTruthy();
    expect(Array.isArray(body.providers)).toBe(true);

    // CloudCredits.remaining + allowance are i64 in Rust → must be numbers.
    expect(typeof body.entitlements.credits.remaining).toBe("number");
    expect(typeof body.entitlements.credits.allowance).toBe("number");
    // resets_at is Option<String> in Rust → null is fine.

    // CloudSubscription.{status, cancel_at_period_end, is_lifetime} are
    // non-Option in Rust → must be non-null primitives.
    expect(typeof body.entitlements.subscription.status).toBe("string");
    expect(typeof body.entitlements.subscription.cancel_at_period_end).toBe(
      "boolean"
    );
    expect(typeof body.entitlements.subscription.is_lifetime).toBe("boolean");
  }

  it("free user (defaults) — Rust-safe shape, plan='free', status='inactive'", async () => {
    const userId = await seedUser({ slug: "u_free" });
    // No UPDATE — let DB defaults take over. plan defaults to 'free',
    // subscription_status to 'inactive', allowance/remaining to 0.
    const { buildAuthSuccess } = await import("../src/auth.js");
    const resp = await buildAuthSuccess(env, userId, { token: "fake_at" });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    assertRustSafeShape(body);

    expect(body.plan).toBe("free");
    expect(body.entitlements.credits.remaining).toBe(0);
    expect(body.entitlements.credits.allowance).toBe(0);
    expect(body.entitlements.credits.resets_at).toBeNull();
    expect(body.entitlements.subscription.status).toBe("inactive");
    expect(body.entitlements.subscription.cancel_at_period_end).toBe(false);
    expect(body.entitlements.subscription.is_lifetime).toBe(false);
    expect(body.entitlements.subscription.interval).toBeNull();
    expect(body.entitlements.subscription.price_usd).toBeNull();
  });

  it("pro monthly subscriber — interval='monthly', price_usd from billing_pricing", async () => {
    const userId = await seedUser({ slug: "u_mo" });
    // 30-day window → monthly via the length heuristic in buildMeBody.
    await env.CLAUGE_DB.prepare(
      `UPDATE users SET plan='pro', subscription_status='active',
         credit_allowance_per_cycle=1000, credits_remaining=700,
         current_period_start='2026-05-17T00:00:00Z',
         current_period_end='2026-06-16T00:00:00Z'
       WHERE user_id=?`
    )
      .bind(userId)
      .run();
    const { buildAuthSuccess } = await import("../src/auth.js");
    const resp = await buildAuthSuccess(env, userId, { token: "fake_at" });
    const body = await resp.json();
    assertRustSafeShape(body);

    expect(body.plan).toBe("pro");
    expect(body.entitlements.credits.remaining).toBe(700);
    expect(body.entitlements.credits.allowance).toBe(1000);
    expect(body.entitlements.subscription.status).toBe("active");
    expect(body.entitlements.subscription.interval).toBe("monthly");
    expect(body.entitlements.subscription.is_lifetime).toBe(false);
    expect(body.entitlements.subscription.price_usd).toBe(12); // seeded by 0005
  });

  it("pro yearly subscriber — interval='yearly', price_usd from billing_pricing", async () => {
    const userId = await seedUser({ slug: "u_yr" });
    // ~365-day window → yearly via the length heuristic (>35 days).
    await env.CLAUGE_DB.prepare(
      `UPDATE users SET plan='pro', subscription_status='active',
         credit_allowance_per_cycle=12000, credits_remaining=8000,
         current_period_start='2026-05-17T00:00:00Z',
         current_period_end='2027-05-17T00:00:00Z'
       WHERE user_id=?`
    )
      .bind(userId)
      .run();
    const { buildAuthSuccess } = await import("../src/auth.js");
    const resp = await buildAuthSuccess(env, userId, { token: "fake_at" });
    const body = await resp.json();
    assertRustSafeShape(body);

    expect(body.plan).toBe("pro");
    expect(body.entitlements.credits.allowance).toBe(12000);
    expect(body.entitlements.subscription.interval).toBe("yearly");
    expect(body.entitlements.subscription.is_lifetime).toBe(false);
    expect(body.entitlements.subscription.price_usd).toBe(100); // seeded by 0005
  });

  it("pro lifetime subscriber — interval='lifetime', is_lifetime=true, price_usd from billing_pricing", async () => {
    const userId = await seedUser({ slug: "u_lt" });
    // is_lifetime=1 takes precedence over the length heuristic, so even
    // though the synthesised period below is ~365 days we expect 'lifetime'.
    await env.CLAUGE_DB.prepare(
      `UPDATE users SET plan='pro', subscription_status='active', is_lifetime=1,
         credit_allowance_per_cycle=20000, credits_remaining=18000,
         current_period_start='2026-05-17T00:00:00Z',
         current_period_end='2027-05-17T00:00:00Z'
       WHERE user_id=?`
    )
      .bind(userId)
      .run();
    const { buildAuthSuccess } = await import("../src/auth.js");
    const resp = await buildAuthSuccess(env, userId, { token: "fake_at" });
    const body = await resp.json();
    assertRustSafeShape(body);

    expect(body.plan).toBe("pro");
    expect(body.entitlements.credits.allowance).toBe(20000);
    expect(body.entitlements.subscription.interval).toBe("lifetime");
    expect(body.entitlements.subscription.is_lifetime).toBe(true);
    expect(body.entitlements.subscription.price_usd).toBe(299); // seeded by 0005
  });

  it("cancelled-at-period-end subscriber — cancel_at_period_end=true reaches the wire", async () => {
    const userId = await seedUser({ slug: "u_cx" });
    await env.CLAUGE_DB.prepare(
      `UPDATE users SET plan='pro', subscription_status='active',
         cancel_at_period_end=1, credit_allowance_per_cycle=1000,
         credits_remaining=300,
         current_period_start='2026-05-01T00:00:00Z',
         current_period_end='2026-05-31T00:00:00Z'
       WHERE user_id=?`
    )
      .bind(userId)
      .run();
    const { buildAuthSuccess } = await import("../src/auth.js");
    const resp = await buildAuthSuccess(env, userId, { token: "fake_at" });
    const body = await resp.json();
    assertRustSafeShape(body);

    expect(body.entitlements.subscription.cancel_at_period_end).toBe(true);
    expect(body.entitlements.subscription.status).toBe("active");
  });
});

// CRITICAL money-leak fix: deleting a Pro account must cancel the user's
// Polar subscription, or they'll keep being charged forever with no app
// to access. These tests cover every branch of cancelPolarSubscriptionIfNeeded
// without making real HTTP calls (the fetch impl is injectable for mocking).
describe("cancelPolarSubscriptionIfNeeded (delete-account Polar revoke)", () => {
  /** Mock fetch that records calls and returns canned responses. */
  function mockFetch(responses) {
    const calls = [];
    let i = 0;
    const fn = async (url, init) => {
      calls.push({ url, init });
      const r = responses[i++] ?? { status: 500, body: "no canned response" };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: async () => r.body ?? "",
      };
    };
    fn.calls = calls;
    return fn;
  }

  const polarEnv = {
    POLAR_API_KEY: "fake_polar_key",
    POLAR_API_BASE: "https://api.polar.sh",
  };

  it("free user (no polar_subscription_id) — skipped, no HTTP call", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: null, subscription_status: "inactive" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("no-subscription");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("lifetime user — skipped (no recurring charge to cancel)", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 1, polar_subscription_id: "sub_xyz", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("lifetime");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("already-cancelled subscription — skipped (status not active/past_due)", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_xyz", subscription_status: "canceled" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("status=canceled");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("pro monthly active — hits Polar DELETE with Bearer auth", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 200, body: '{"status":"canceled"}' }]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_abc123", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe(
      "https://api.polar.sh/v1/subscriptions/sub_abc123",
    );
    expect(fetchImpl.calls[0].init.method).toBe("DELETE");
    expect(fetchImpl.calls[0].init.headers.authorization).toBe(
      "Bearer fake_polar_key",
    );
  });

  it("past_due subscription — still cancelled (stops further retry charges)", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 200, body: "{}" }]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_pd", subscription_status: "past_due" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("Polar 404 — idempotent success (already revoked out-of-band)", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 404, body: '{"error":"not_found"}' }]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_gone", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("polar-404");
  });

  it("Polar 409 — idempotent success (conflict, typically already cancelled)", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 409, body: '{"error":"conflict"}' }]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_cf", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("polar-409");
  });

  it("Polar 403 (auth) — blocks deletion, surfaces error", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([
      { status: 403, body: '{"error":"forbidden"}' },
    ]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_x", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("403");
  });

  it("Polar 500 (outage) — blocks deletion so user can retry", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 500, body: "internal error" }]);
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_x", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("network error — blocks deletion with network: prefix in error", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    const result = await cancelPolarSubscriptionIfNeeded(
      polarEnv,
      { is_lifetime: 0, polar_subscription_id: "sub_x", subscription_status: "active" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network:");
    expect(result.error).toContain("ECONNRESET");
  });

  it("falls back to default api.polar.sh when POLAR_API_BASE is unset", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 200, body: "{}" }]);
    await cancelPolarSubscriptionIfNeeded(
      { POLAR_API_KEY: "k" }, // no POLAR_API_BASE
      { is_lifetime: 0, polar_subscription_id: "sub_d", subscription_status: "active" },
      fetchImpl,
    );
    expect(fetchImpl.calls[0].url).toBe(
      "https://api.polar.sh/v1/subscriptions/sub_d",
    );
  });

  it("respects POLAR_API_BASE override (e.g. sandbox)", async () => {
    const { cancelPolarSubscriptionIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 200, body: "{}" }]);
    await cancelPolarSubscriptionIfNeeded(
      { POLAR_API_KEY: "k", POLAR_API_BASE: "https://sandbox-api.polar.sh" },
      { is_lifetime: 0, polar_subscription_id: "sub_s", subscription_status: "active" },
      fetchImpl,
    );
    expect(fetchImpl.calls[0].url).toBe(
      "https://sandbox-api.polar.sh/v1/subscriptions/sub_s",
    );
  });
});

// CRITICAL silent-under-charge fix: deleting a Pro account must ALSO delete
// the Polar Customer record. Without this, Polar's customer survives with a
// stale `external_id` pointing at the deleted D1 row; on the next signup +
// purchase with the same email, Polar reuses the orphan customer and the
// resulting `order.paid` webhook resolves to a user_id that no longer exists,
// so `handleLifetimeOrderPaid` silently no-ops and the new paying user stays
// on free tier. These tests cover every branch of deletePolarCustomerIfNeeded
// (success, idempotent 404, abort on 403/422/5xx/network, skip when no
// customer_id) without making real HTTP calls.
describe("deletePolarCustomerIfNeeded (delete-account Polar customer cleanup)", () => {
  function mockFetch(responses) {
    const calls = [];
    let i = 0;
    const fn = async (url, init) => {
      calls.push({ url, init });
      const r = responses[i++] ?? { status: 500, body: "no canned response" };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: async () => r.body ?? "",
      };
    };
    fn.calls = calls;
    return fn;
  }

  const polarEnv = {
    POLAR_API_KEY: "fake_polar_key",
    POLAR_API_BASE: "https://api.polar.sh",
  };

  it("free user (no polar_customer_id) — skipped, no HTTP call", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([]);
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: null },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("no-customer");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("active customer — hits Polar DELETE with Bearer auth, returns 204", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 204, body: "" }]);
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: "cus_3d1ec5c9" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe(
      "https://api.polar.sh/v1/customers/cus_3d1ec5c9",
    );
    expect(fetchImpl.calls[0].init.method).toBe("DELETE");
    expect(fetchImpl.calls[0].init.headers.authorization).toBe(
      "Bearer fake_polar_key",
    );
  });

  it("Polar 404 — idempotent success (already deleted out-of-band)", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 404, body: '{"error":"not_found"}' }]);
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: "cus_gone" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe("polar-404");
  });

  it("Polar 422 (validation) — blocks deletion so user can retry", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([
      { status: 422, body: '{"error":"validation"}' },
    ]);
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: "cus_x" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toContain("422");
  });

  it("Polar 403 (insufficient scope) — blocks deletion, surfaces error", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([
      { status: 403, body: '{"error":"insufficient_scope"}' },
    ]);
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: "cus_x" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("Polar 500 (outage) — blocks deletion so user can retry later", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 500, body: "internal error" }]);
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: "cus_x" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("network error — blocks deletion with network: prefix in error", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = async () => {
      throw new Error("ETIMEDOUT");
    };
    const result = await deletePolarCustomerIfNeeded(
      polarEnv,
      { polar_customer_id: "cus_x" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network:");
    expect(result.error).toContain("ETIMEDOUT");
  });

  it("respects POLAR_API_BASE override (sandbox)", async () => {
    const { deletePolarCustomerIfNeeded } = await import("../src/auth.js");
    const fetchImpl = mockFetch([{ status: 204, body: "" }]);
    await deletePolarCustomerIfNeeded(
      { POLAR_API_KEY: "k", POLAR_API_BASE: "https://sandbox-api.polar.sh" },
      { polar_customer_id: "cus_sandbox" },
      fetchImpl,
    );
    expect(fetchImpl.calls[0].url).toBe(
      "https://sandbox-api.polar.sh/v1/customers/cus_sandbox",
    );
  });
});
