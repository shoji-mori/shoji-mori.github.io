import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createPublication, listPublications } from "@/lib/db";
import { buildErrorRedirectUrl } from "@/lib/form-feedback";
import { parsePublicationInput } from "@/lib/validation";

async function getInput(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  return request.formData();
}

export async function GET(request: Request) {
  await getAuthenticatedUser(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const year = url.searchParams.get("year") ?? "";
  const items = await listPublications({ q, year });
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  const input = await getInput(request);
  const parsed = parsePublicationInput(input);
  if (!parsed.ok) {
    return NextResponse.redirect(
      buildErrorRedirectUrl(request, "/publications/new", parsed.errors),
      303,
    );
  }

  const created = await createPublication(parsed.data, user);
  return NextResponse.redirect(
    new URL(`/publications/${created.id}?saved=1`, request.url),
    303,
  );
}
