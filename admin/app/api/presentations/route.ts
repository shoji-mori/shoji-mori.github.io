import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { createPresentation, listPresentations } from "@/lib/db";
import { buildErrorRedirectUrl } from "@/lib/form-feedback";
import { parsePresentationInput } from "@/lib/validation";

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
  const items = await listPresentations({ q, year });
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  const parsed = parsePresentationInput(await getInput(request));
  if (!parsed.ok) {
    return NextResponse.redirect(
      buildErrorRedirectUrl(request, "/presentations/new", parsed.errors),
      303,
    );
  }

  const created = await createPresentation(parsed.data, user);
  return NextResponse.redirect(
    new URL(`/presentations/${created.id}?saved=1`, request.url),
    303,
  );
}
