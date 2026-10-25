import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { ConsentConfigurationError } from "@/lib/consent-store";

export const SESSION_COOKIE_NAME = "__Host-second-gear-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60;
const SESSION_VERSION = "s1";

function secret(): Buffer {
  const configured = process.env.CONSENT_SIGNING_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || Buffer.byteLength(configured) < 32)) {
    throw new ConsentConfigurationError("CONSENT_SIGNING_SECRET is required for sessions");
  }
  return Buffer.from(configured && Buffer.byteLength(configured) >= 32 ? configured : "second-gear-local-session-secret");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function encode(id: string, expires: number): string {
  const value = `${SESSION_VERSION}.${id}.${expires}`;
  return `${value}.${sign(value)}`;
}

function verify(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [version, id, expiresText, signature, extra] = value.split(".");
  const expires = Number(expiresText);
  if (extra || version !== SESSION_VERSION || !/^[a-f0-9]{64}$/.test(id ?? "") || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return undefined;
  const expected = Buffer.from(sign(`${version}.${id}.${expires}`));
  const given = Buffer.from(signature ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : undefined;
}

export function getSessionId(req: NextRequest): string | undefined {
  return verify(req.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export function hasSessionCookie(req: NextRequest): boolean {
  return req.cookies.get(SESSION_COOKIE_NAME) !== undefined;
}

export function createSession(): { id: string; value: string } {
  const id = randomBytes(32).toString("hex");
  return { id, value: encode(id, Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS) };
}

export function setSessionCookie(response: NextResponse, value: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    // The __Host- prefix requires Secure unconditionally, in every
    // environment — browsers silently refuse to set it otherwise. Chrome
    // treats http://localhost as a secure context, so this still works in
    // local dev without TLS.
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}
