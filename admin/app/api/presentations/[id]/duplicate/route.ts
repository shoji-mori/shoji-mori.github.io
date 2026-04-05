import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { duplicatePresentation } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser(request);
  const { id } = await params;
  const duplicated = await duplicatePresentation(id, user);

  if (!duplicated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.redirect(
    new URL(`/presentations/${duplicated.id}?saved=1`, request.url),
    303,
  );
}
