import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { replaceAllPresentations, replaceAllPublications } from "@/lib/db";
import {
  parsePresentationImport,
  parsePublicationImport,
} from "@/lib/import";
import type { PresentationInput, PublicationInput } from "@/lib/types";

type ImportSummary = {
  dataset: "publications" | "presentations";
  count: number;
  filename: string;
};

type PendingImport =
  | {
      dataset: "publications";
      filename: string;
      count: number;
      items: PublicationInput[];
    }
  | {
      dataset: "presentations";
      filename: string;
      count: number;
      items: PresentationInput[];
    };

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "アップロードする data.js または JSON を選択してください。" },
      { status: 400 },
    );
  }

  const pendingImports: PendingImport[] = [];
  const importedDatasets = new Set<string>();

  for (const file of files) {
    const source = await file.text();
    const publicationResult = parsePublicationImport(source);

    if (publicationResult.ok) {
      if (importedDatasets.has("publications")) {
        return NextResponse.json(
          { error: "publications データは一度に 1 ファイルだけアップロードできます。" },
          { status: 400 },
        );
      }

      importedDatasets.add("publications");
      pendingImports.push({
        dataset: "publications",
        count: publicationResult.items.length,
        items: publicationResult.items,
        filename: file.name,
      });
      continue;
    }

    const presentationResult = parsePresentationImport(source);
    if (presentationResult.ok) {
      if (importedDatasets.has("presentations")) {
        return NextResponse.json(
          { error: "presentations データは一度に 1 ファイルだけアップロードできます。" },
          { status: 400 },
        );
      }

      importedDatasets.add("presentations");
      pendingImports.push({
        dataset: "presentations",
        count: presentationResult.items.length,
        items: presentationResult.items,
        filename: file.name,
      });
      continue;
    }

    return NextResponse.json(
      {
        error:
          publicationResult.error === "Uploaded file is not publications data."
            ? presentationResult.error
            : publicationResult.error,
        filename: file.name,
      },
      { status: 400 },
    );
  }

  const summaries: ImportSummary[] = [];
  for (const pendingImport of pendingImports) {
    if (pendingImport.dataset === "publications") {
      await replaceAllPublications(pendingImport.items, user);
    } else {
      await replaceAllPresentations(pendingImport.items, user);
    }

    summaries.push({
      dataset: pendingImport.dataset,
      count: pendingImport.count,
      filename: pendingImport.filename,
    });
  }

  return NextResponse.json({
    ok: true,
    imports: summaries,
  });
}
