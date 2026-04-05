import Link from "next/link";

import { requireAdminPageUser } from "@/lib/auth";
import { listPublicationYears, listPublications } from "@/lib/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminPageUser();
  const params = await searchParams;
  const q = firstValue(params.q) ?? "";
  const year = firstValue(params.year) ?? "";

  const [items, years] = await Promise.all([
    listPublications({ q, year }),
    listPublicationYears(),
  ]);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Publications</h1>
          <p>D1 に保存された正本データを管理します。</p>
        </div>
        <Link className="button" href="/publications/new">
          追加
        </Link>
      </div>

      <div className="card toolbar">
        <form action="/publications" method="get">
          <div className="field">
            <label htmlFor="q">検索</label>
            <input id="q" name="q" defaultValue={q} placeholder="title / author / journal" />
          </div>
          <div className="field">
            <label htmlFor="year">年</label>
            <select id="year" name="year" defaultValue={year}>
              <option value="">All years</option>
              {years.map((itemYear) => (
                <option key={itemYear} value={String(itemYear)}>
                  {itemYear}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-actions">
            <button type="submit">検索</button>
            <Link className="button secondary" href="/publications">
              リセット
            </Link>
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="empty">該当する publication はありません。</div>
      ) : (
        <div className="list">
          {items.map((item) => (
            <article className="list-item" key={item.id}>
              <header>
                <div>
                  <div className="meta">
                    <span>{item.year}</span>
                    {item.selected ? <span className="tag selected">selected</span> : null}
                  </div>
                  <h3>{item.titleEn}</h3>
                </div>
              </header>

              <div className="muted">{item.authorsEn}</div>
              <div>{item.journalEn}</div>

              <div className="inline-actions">
                <Link className="button secondary" href={`/publications/${item.id}`}>
                  編集
                </Link>
                <form action={`/api/publications/${item.id}/duplicate`} method="post">
                  <button className="secondary" type="submit">
                    複製
                  </button>
                </form>
                <form action={`/api/publications/${item.id}`} method="post">
                  <input type="hidden" name="_method" value="DELETE" />
                  <button className="danger" type="submit">
                    削除
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
