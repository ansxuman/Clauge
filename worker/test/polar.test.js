import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { verifyPolarSignature, checkReplayWindow, parsePolarEvent } from "../src/polar.js";

// Build a Standard-Webhooks-shaped signed request (matches what Polar sends).
async function buildSignedHeaders(rawBody, opts = {}) {
  const enc = new TextEncoder();
  const id = opts.id ?? "msg_test_1";
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secret = opts.secret ?? env.POLAR_WEBHOOK_SECRET;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${rawBody}`));
  const sigBytes = new Uint8Array(mac);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const sigB64 = btoa(bin);

  return new Headers({
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${sigB64}`,
  });
}

describe("verifyPolarSignature (Standard Webhooks)", () => {
  it("returns true for a correctly signed delivery", async () => {
    const body = '{"type":"order.paid","data":{}}';
    const headers = await buildSignedHeaders(body);
    expect(await verifyPolarSignature(body, headers, env)).toBe(true);
  });

  it("returns false when body is tampered", async () => {
    const goodBody = '{"type":"order.paid","data":{}}';
    const headers = await buildSignedHeaders(goodBody);
    expect(await verifyPolarSignature('{"type":"order.refunded"}', headers, env)).toBe(false);
  });

  it("returns false when secret used to sign differs", async () => {
    const body = "{}";
    const headers = await buildSignedHeaders(body, { secret: "wrong_secret" });
    expect(await verifyPolarSignature(body, headers, env)).toBe(false);
  });

  it("returns false when any required header is missing", async () => {
    const body = "{}";
    const full = await buildSignedHeaders(body);
    // drop webhook-id
    const missingId = new Headers(full);
    missingId.delete("webhook-id");
    expect(await verifyPolarSignature(body, missingId, env)).toBe(false);
    // drop webhook-timestamp
    const missingTs = new Headers(full);
    missingTs.delete("webhook-timestamp");
    expect(await verifyPolarSignature(body, missingTs, env)).toBe(false);
    // drop webhook-signature
    const missingSig = new Headers(full);
    missingSig.delete("webhook-signature");
    expect(await verifyPolarSignature(body, missingSig, env)).toBe(false);
  });

  it("returns false when timestamp is outside the replay window", async () => {
    const body = "{}";
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const headers = await buildSignedHeaders(body, { timestamp: stale });
    expect(await verifyPolarSignature(body, headers, env)).toBe(false);
  });

  it("accepts when multiple v1 sigs are present and ours matches one", async () => {
    const body = "{}";
    const full = await buildSignedHeaders(body);
    const goodSig = full.get("webhook-signature");
    // Prepend a bogus v1 entry — verification should still pass via the second one
    full.set("webhook-signature", `v1,YmFkc2lndmFsdWU= ${goodSig}`);
    expect(await verifyPolarSignature(body, full, env)).toBe(true);
  });

  it("ignores non-v1 signature versions", async () => {
    const body = "{}";
    const headers = await buildSignedHeaders(body);
    // Replace v1 with v2 (unknown version) — should fail
    headers.set("webhook-signature", headers.get("webhook-signature").replace("v1,", "v2,"));
    expect(await verifyPolarSignature(body, headers, env)).toBe(false);
  });
});

describe("checkReplayWindow", () => {
  it("accepts a unix-second timestamp within 5 minutes", () => {
    const recent = String(Math.floor(Date.now() / 1000) - 60);
    expect(checkReplayWindow(recent)).toBe(true);
  });

  it("rejects a unix-second timestamp older than 5 minutes", () => {
    const old = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(checkReplayWindow(old)).toBe(false);
  });

  it("rejects future-dated timestamps beyond the window", () => {
    const future = String(Math.floor(Date.now() / 1000) + 6 * 60);
    expect(checkReplayWindow(future)).toBe(false);
  });

  it("rejects unparseable timestamps", () => {
    expect(checkReplayWindow("not-a-number")).toBe(false);
    expect(checkReplayWindow("")).toBe(false);
  });
});

describe("parsePolarEvent", () => {
  it("parses well-formed event JSON", () => {
    const evt = parsePolarEvent('{"type":"order.paid","data":{"id":"ord_1"}}');
    expect(evt.type).toBe("order.paid");
    expect(evt.data.id).toBe("ord_1");
  });

  it("returns null on malformed JSON", () => {
    expect(parsePolarEvent("{ not json")).toBeNull();
  });

  it("returns null when type is missing", () => {
    expect(parsePolarEvent('{"data":{}}')).toBeNull();
  });

  it("returns null on non-object payload", () => {
    expect(parsePolarEvent('"just a string"')).toBeNull();
    expect(parsePolarEvent("null")).toBeNull();
  });
});
