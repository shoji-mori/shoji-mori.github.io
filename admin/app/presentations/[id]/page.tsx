import { notFound } from "next/navigation";

import { PresentationForm } from "@/components/presentation-form";
import { PreviewCard } from "@/components/preview-card";
import { requireAdminPageUser } from "@/lib/auth";
import { getPresentation } from "@/lib/db";
import { firstValue, readErrorsFromSearchParams } from "@/lib/form-feedback";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PresentationDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireAdminPageUser();
  const { id } = await params;
  const presentation = await getPresentation(id);
  if (!presentation) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const saved = firstValue(resolvedSearchParams.saved) === "1";
  const errors = readErrorsFromSearchParams(resolvedSearchParams);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Edit Presentation</h1>
          <p>D1 の発表データを更新します。</p>
        </div>
      </div>

      <div className="grid-two">
        <PresentationForm
          action={`/api/presentations/${presentation.id}`}
          cancelHref="/presentations"
          mode="edit"
          record={presentation}
          saved={saved}
          errors={errors}
        />
        <div className="card preview stack">
          <h3>Current Preview</h3>
          <PreviewCard kind="presentation" record={presentation} />
          <p className="muted">更新者: {presentation.updatedBy}</p>
        </div>
      </div>
    </div>
  );
}
