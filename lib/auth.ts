import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE_NAME = "smart_scraper_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getPasscode(): string {
  return process.env.APP_PASSCODE?.trim() || "oveersea2026";
}

function getSigningSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.FIRECRAWL_API_KEY?.trim() ||
    "smart-scraper-oveersea2026-hmac-secret"
  );
}

/**
 * Constant-time comparison between user-provided passcode and configured passcode.
 */
export function verifyPasscode(input: string): boolean {
  const expected = getPasscode();
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) {
    // Perform a dummy timingSafeEqual to avoid leaking length timing
    crypto.timingSafeEqual(b, b);
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

/**
 * Creates a signed session token valid for 7 days.
 */
export function createSessionToken(): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ auth: true, exp })).toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verifies the HMAC signature and expiration of a session token.
 */
export function verifySessionToken(token?: string | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");

  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { auth?: boolean; exp?: number };
    if (!decoded.auth || typeof decoded.exp !== "number") return false;
    return decoded.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/**
 * Checks authentication cookie on an incoming NextRequest (API routes).
 */
export function isRequestAuthenticated(req: NextRequest): boolean {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

/**
 * Checks authentication cookie in a Next.js Server Component.
 */
export function isServerAuthenticated(): boolean {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    return verifySessionToken(token);
  } catch {
    return false;
  }
}

