import { PresentationForm } from "@/components/presentation-form";
import { PreviewCard } from "@/components/preview-card";
import { requireAdminPageUser } from "@/lib/auth";
import { readErrorsFromSearchParams } from "@/lib/form-feedback";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewPresentationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminPageUser();
  const errors = readErrorsFromSearchParams(await searchParams);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>New Presentation</h1>
          <p>初期実装では PDF 本体ではなくパス文字列のみ管理します。</p>
        </div>
      </div>

      <div className="grid-two">
        <PresentationForm
          action="/api/presentations"
          cancelHref="/presentations"
          mode="create"
          record={{ type: "oral", scope: "domestic" }}
          errors={errors}
        />
        <div className="card preview stack">
          <h3>Preview</h3>
          <PreviewCard kind="presentation" record={{}} />
        </div>
      </div>
    </div>
  );
}
