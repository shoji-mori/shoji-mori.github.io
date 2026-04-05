import { ExportPanel } from "@/components/export-panel";
import { ImportPanel } from "@/components/import-panel";
import { requireAdminPageUser } from "@/lib/auth";
import { getDashboardCounts } from "@/lib/db";

export default async function ExportPage() {
  await requireAdminPageUser();
  const counts = await getDashboardCounts();

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Export</h1>
          <p>公開サイト用の `window.*Data` 形式の JS を生成します。</p>
        </div>
      </div>

      <ExportPanel
        publicationCount={counts.publications}
        presentationCount={counts.presentations}
      />

      <ImportPanel />

      <div className="card stack">
        <h2>運用メモ</h2>
        <p className="muted">
          生成された JS を確認したうえで、公開サイト repo の
          `publications_data.js` / `presentations_data.js` に反映します。
        </p>
      </div>
    </div>
  );
}
