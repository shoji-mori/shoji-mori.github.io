import { PublicationForm } from "@/components/publication-form";
import { PreviewCard } from "@/components/preview-card";
import { requireAdminPageUser } from "@/lib/auth";
import { readErrorsFromSearchParams } from "@/lib/form-feedback";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewPublicationPage({
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
          <h1>New Publication</h1>
          <p>まずは最小項目を入れて保存し、必要に応じて追記します。</p>
        </div>
      </div>

      <div className="grid-two">
        <PublicationForm
          action="/api/publications"
          cancelHref="/publications"
          mode="create"
          record={{ selected: false }}
          errors={errors}
        />
        <div className="card preview stack">
          <h3>Preview</h3>
          <PreviewCard kind="publication" record={{}} />
        </div>
      </div>
    </div>
  );
}
