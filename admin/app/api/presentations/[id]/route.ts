import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import {
  deletePresentation,
  getPresentation,
  updatePresentation,
} from "@/lib/db";
import { buildErrorRedirectUrl } from "@/lib/form-feedback";
import { parsePresentationInput } from "@/lib/validation";

async function getInput(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  return request.formData();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await getAuthenticatedUser(request);
  const { id } = await params;
  const presentation = await getPresentation(id);
  if (!presentation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(presentation);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const formData = await request.formData();
  const method = String(formData.get("_method") ?? "POST").toUpperCase();
  const { id } = await params;
  const user = await getAuthenticatedUser(request);

  if (method === "DELETE") {
    await deletePresentation(id, user);
    return NextResponse.redirect(new URL("/presentations", request.url), 303);
  }

  const parsed = parsePresentationInput(formData);
  if (!parsed.ok) {
    return NextResponse.redirect(
      buildErrorRedirectUrl(request, `/presentations/${id}`, parsed.errors),
      303,
    );
  }

  const updated = await updatePresentation(id, parsed.data, user);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(
    new URL(`/presentations/${updated.id}?saved=1`, request.url),
    303,
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request);
  const { id } = await params;
  const parsed = parsePresentationInput(await getInput(request));
  if (!parsed.ok) {
    return NextResponse.json(
      {
        errors: parsed.errors,
      },
      {
        status: 400,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  const updated = await updatePresentation(id, parsed.data, user);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request);
  const { id } = await params;
  const deleted = await deletePresentation(id, user);
  return NextResponse.json({ deleted });
}
