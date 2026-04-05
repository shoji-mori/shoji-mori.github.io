import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { deletePublication, getPublication, updatePublication } from "@/lib/db";
import { buildErrorRedirectUrl } from "@/lib/form-feedback";
import { parsePublicationInput } from "@/lib/validation";

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
  const publication = await getPublication(id);
  if (!publication) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(publication);
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
    await deletePublication(id, user);
    return NextResponse.redirect(new URL("/publications", request.url), 303);
  }

  const parsed = parsePublicationInput(formData);
  if (!parsed.ok) {
    return NextResponse.redirect(
      buildErrorRedirectUrl(request, `/publications/${id}`, parsed.errors),
      303,
    );
  }

  const updated = await updatePublication(id, parsed.data, user);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(
    new URL(`/publications/${updated.id}?saved=1`, request.url),
    303,
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request);
  const { id } = await params;
  const parsed = parsePublicationInput(await getInput(request));
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

  const updated = await updatePublication(id, parsed.data, user);
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
  const deleted = await deletePublication(id, user);
  return NextResponse.json({ deleted });
}
