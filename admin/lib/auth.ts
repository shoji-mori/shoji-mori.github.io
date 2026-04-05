import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { AdminUser } from "@/lib/types";
import { getCloudflareEnv } from "@/lib/db";

type AccessTokenPayload = JWTPayload & {
  email?: string;
  country?: string;
  sub?: string;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  const cached = jwksCache.get(teamDomain);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(
    new URL(`${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`),
  );
  jwksCache.set(teamDomain, jwks);
  return jwks;
}

function assertAllowedEmail(email: string, csv?: string) {
  if (!csv) {
    return;
  }

  const allowed = new Set(
    csv
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  if (allowed.size > 0 && !allowed.has(email.toLowerCase())) {
    throw new Error("Authenticated user is not allowed to access this admin site.");
  }
}

function getDevFallbackUser(): AdminUser | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const env = getCloudflareEnv();
  return {
    email: env.ADMIN_DEV_EMAIL ?? "local@example.com",
    sub: "local-dev",
    country: "local",
  };
}

export async function getAuthenticatedUser(
  request?: Request,
): Promise<AdminUser> {
  const env = getCloudflareEnv();
  const issuer = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
  const audience = env.CLOUDFLARE_ACCESS_AUD;

  if (!issuer || !audience) {
    const fallback = getDevFallbackUser();
    if (fallback) {
      return fallback;
    }
    throw new Error("Missing Cloudflare Access configuration.");
  }

  const requestHeaders = request ? request.headers : await headers();
  const token = requestHeaders.get("cf-access-jwt-assertion");

  if (!token) {
    const fallback = getDevFallbackUser();
    if (fallback) {
      return fallback;
    }
    throw new Error("Missing Cf-Access-Jwt-Assertion header.");
  }

  const { payload } = await jwtVerify(token, getJwks(issuer), {
    issuer,
    audience,
  });

  const accessPayload = payload as AccessTokenPayload;
  const email = accessPayload.email;

  if (!email) {
    throw new Error("Cloudflare Access token did not contain an email claim.");
  }

  assertAllowedEmail(email, env.ADMIN_ALLOWED_EMAILS);

  return {
    email,
    sub: accessPayload.sub ?? email,
    country: accessPayload.country,
  };
}

export async function requireAdminPageUser(): Promise<AdminUser> {
  try {
    return await getAuthenticatedUser();
  } catch {
    redirect("/login");
  }
}

export async function getOptionalAdminUser(): Promise<AdminUser | null> {
  try {
    return await getAuthenticatedUser();
  } catch {
    return null;
  }
}
