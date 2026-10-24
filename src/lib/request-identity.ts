import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";

export interface RequestIdentity {
  ipKey: string;
  trustedIp: boolean;
}

export class OriginConfigurationError extends Error {
  readonly userMessage = "Request origin validation is not configured.";
}

function validIp(value: string | null): string | undefined {
  const candidate = value?.trim();
  return candidate && isIP(candidate) ? candidate : undefined;
}

/** Vercel overwrites these headers; outside Vercel we deliberately use one shared bucket. */
export function getRequestIdentity(req: NextRequest): RequestIdentity {
  if (process.env.NODE_ENV === "production" && process.env.VERCEL === "1") {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0] ?? null;
    const ip = validIp(req.headers.get("x-real-ip")) ?? validIp(forwarded);
    return ip ? { ipKey: `ip-${createHash("sha256").update(ip).digest("hex")}`, trustedIp: true } : { ipKey: "unknown-vercel-client", trustedIp: false };
  }
  return { ipKey: "local-client", trustedIp: false };
}

export function assertRequestOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (process.env.NODE_ENV !== "production" && !origin) return;
  if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN?.trim()) throw new OriginConfigurationError("APP_ORIGIN is required in production");
  if (!origin) throw new OriginConfigurationError("Origin header is required in production");
  const expected = process.env.APP_ORIGIN?.trim();
  if (expected && origin !== expected) throw new Error("Request origin is not allowed.");
}
