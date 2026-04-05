import { notFound } from "next/navigation";

import { PublicationForm } from "@/components/publication-form";
import { PreviewCard } from "@/components/preview-card";
import { requireAdminPageUser } from "@/lib/auth";
import { getPublication } from "@/lib/db";
import { firstValue, readErrorsFromSearchParams } from "@/lib/form-feedback";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PublicationDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireAdminPageUser();
  const { id } = await params;
  const publication = await getPublication(id);
  if (!publication) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const saved = firstValue(resolvedSearchParams.saved) === "1";
  const errors = readErrorsFromSearchParams(resolvedSearchParams);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Edit Publication</h1>
          <p>D1 のレコードを更新します。</p>
        </div>
      </div>

      <div className="grid-two">
        <PublicationForm
          action={`/api/publications/${publication.id}`}
          cancelHref="/publications"
          mode="edit"
          record={publication}
          saved={saved}
          errors={errors}
        />
        <div className="card preview stack">
          <h3>Current Preview</h3>
          <PreviewCard kind="publication" record={publication} />
          <p className="muted">更新者: {publication.updatedBy}</p>
        </div>
      </div>
    </div>
  );
}
