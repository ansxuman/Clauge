// Polar webhook verification — Standard Webhooks spec.
// https://www.standardwebhooks.com/
//
// Headers from Polar:
//   webhook-id         — UUID of the delivery (use as the dedup key)
//   webhook-timestamp  — unix epoch seconds (use for replay window)
//   webhook-signature  — space-separated list of `v1,<base64sig>` entries
//
// Signature: HMAC-SHA256 over message `${id}.${timestamp}.${body}`,
// base64-encoded. The HMAC key is the raw secret bytes from
// env.POLAR_WEBHOOK_SECRET (Polar provides secrets prefixed like
// `polar_whs_...`; we use those bytes directly).
//
// Replay defense: reject if abs(now_seconds - webhook-timestamp) > 300.

const REPLAY_WINDOW_SECONDS = 5 * 60;

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function base64Encode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64Decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256Base64(secretBytes, messageBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, messageBytes);
  return base64Encode(new Uint8Array(mac));
}

// Verifies a Polar webhook delivery. `headers` is a Headers instance (or any
// object with a `.get(name)` method that returns a header value or null).
// Returns true if signature matches AND timestamp is within the replay window.
export async function verifyPolarSignature(rawBody, headers, env) {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  if (!checkReplayWindow(webhookTimestamp)) return false;

  const enc = new TextEncoder();
  const secretBytes = enc.encode(env.POLAR_WEBHOOK_SECRET ?? "");
  if (secretBytes.length === 0) return false;

  const message = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expectedB64 = await hmacSha256Base64(secretBytes, enc.encode(message));
  const expectedBytes = base64Decode(expectedB64);

  // The signature header is space-separated `v1,<base64>` entries (potentially multiple versions).
  // Accept if any entry's signature matches our computed one.
  for (const entry of webhookSignature.split(" ")) {
    const commaIdx = entry.indexOf(",");
    if (commaIdx < 0) continue;
    const version = entry.slice(0, commaIdx);
    if (version !== "v1") continue;
    const sigB64 = entry.slice(commaIdx + 1);
    let providedBytes;
    try {
      providedBytes = base64Decode(sigB64);
    } catch {
      continue;
    }
    if (constantTimeEqual(expectedBytes, providedBytes)) return true;
  }
  return false;
}

// `timestampHeaderValue` is the raw string from the `webhook-timestamp` header
// (unix epoch seconds as a string).
export function checkReplayWindow(timestampHeaderValue) {
  const ts = Number(timestampHeaderValue);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - ts) <= REPLAY_WINDOW_SECONDS;
}

export function parsePolarEvent(rawBody) {
  try {
    const obj = JSON.parse(rawBody);
    if (typeof obj !== "object" || obj === null) return null;
    if (typeof obj.type !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}
