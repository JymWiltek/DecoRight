export const SESSION_COOKIE = "dr_session";
export const SESSION_TTL_DAYS = 7;

const encoder = new TextEncoder();

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function strToB64Url(s: string): string {
  return bytesToB64Url(encoder.encode(s));
}

function b64UrlToStr(b: string): string {
  const pad = "=".repeat((4 - (b.length % 4)) % 4);
  return atob(b.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToB64Url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type SessionPayload = { sub: string; iat: number; exp: number };

export async function createSession(sub = "admin", ttlDays = SESSION_TTL_DAYS): Promise<string> {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error("APP_SESSION_SECRET missing");
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { sub, iat: now, exp: now + ttlDays * 86400 };
  const data = strToB64Url(JSON.stringify(payload));
  const sig = await hmacSign(secret, data);
  return `${data}.${sig}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = await hmacSign(secret, data);
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(b64UrlToStr(data)) as SessionPayload;
    if (typeof payload.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
