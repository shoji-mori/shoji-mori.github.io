import Link from "next/link";

import { requireAdminPageUser } from "@/lib/auth";
import { listPresentationYears, listPresentations } from "@/lib/db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PresentationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminPageUser();
  const params = await searchParams;
  const q = firstValue(params.q) ?? "";
  const year = firstValue(params.year) ?? "";

  const [items, years] = await Promise.all([
    listPresentations({ q, year }),
    listPresentationYears(),
  ]);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Presentations</h1>
          <p>発表データを一覧・編集します。</p>
        </div>
        <Link className="button" href="/presentations/new">
          追加
        </Link>
      </div>

      <div className="card toolbar">
        <form action="/presentations" method="get">
          <div className="field">
            <label htmlFor="q">検索</label>
            <input id="q" name="q" defaultValue={q} placeholder="title / author / conference" />
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
            <Link className="button secondary" href="/presentations">
              リセット
            </Link>
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="empty">該当する presentation はありません。</div>
      ) : (
        <div className="list">
          {items.map((item) => (
            <article className="list-item" key={item.id}>
              <header>
                <div>
                  <div className="meta">
                    <span>{item.year}</span>
                    <span className="tag">{item.type}</span>
                    <span className="tag">{item.scope}</span>
                  </div>
                  <h3>{item.titleEn}</h3>
                </div>
              </header>

              <div className="muted">{item.authorsEn}</div>
              <div>{item.confEn}</div>
              <div className="meta">
                <span>{item.dateText}</span>
                {item.placeEn ? <span>{item.placeEn}</span> : null}
              </div>

              <div className="inline-actions">
                <Link className="button secondary" href={`/presentations/${item.id}`}>
                  編集
                </Link>
                <form action={`/api/presentations/${item.id}/duplicate`} method="post">
                  <button className="secondary" type="submit">
                    複製
                  </button>
                </form>
                <form action={`/api/presentations/${item.id}`} method="post">
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
