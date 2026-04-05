import Link from "next/link";

import { requireAdminPageUser } from "@/lib/auth";
import { getDashboardCounts } from "@/lib/db";

export default async function DashboardPage() {
  await requireAdminPageUser();
  const counts = await getDashboardCounts();

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Publications / Presentations の管理と export の入口です。</p>
        </div>
      </div>

      <div className="stats">
        <div className="card">
          <div className="stat-value">{counts.publications}</div>
          <div className="stat-label">Publications</div>
        </div>
        <div className="card">
          <div className="stat-value">{counts.presentations}</div>
          <div className="stat-label">Presentations</div>
        </div>
      </div>

      <div className="stats">
        <Link href="/publications" className="card stack">
          <h2>Publications</h2>
          <p className="muted">一覧、検索、追加、編集、削除、複製</p>
        </Link>

        <Link href="/presentations" className="card stack">
          <h2>Presentations</h2>
          <p className="muted">一覧、検索、追加、編集、削除、複製</p>
        </Link>

        <Link href="/export" className="card stack">
          <h2>Export</h2>
          <p className="muted">公開サイト互換の data.js を生成してダウンロード</p>
        </Link>
      </div>
    </div>
  );
}
