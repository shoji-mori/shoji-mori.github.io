import type { PublicationRecord } from "@/lib/types";

type PublicationFormProps = {
  action: string;
  cancelHref: string;
  mode: "create" | "edit";
  record: Partial<PublicationRecord>;
  saved?: boolean;
  errors?: string[];
};

export function PublicationForm({
  action,
  cancelHref,
  mode,
  record,
  saved,
  errors,
}: PublicationFormProps) {
  return (
    <div className="card stack">
      <div>
        <h2>{mode === "create" ? "Publication を追加" : "Publication を編集"}</h2>
        <p className="muted">
          公開サイトに出す構造に近い形で編集します。`authorsEn` / `authorsJa`
          は HTML を含んでも構いません。
        </p>
      </div>

      {saved ? <div className="notice">保存しました。</div> : null}
      {errors && errors.length > 0 ? (
        <ul className="error-list">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <form action={action} method="post" className="stack">
        {mode === "edit" ? <input type="hidden" name="_method" value="PUT" /> : null}

        <div className="field-row">
          <div className="field">
            <label htmlFor="year">year</label>
            <input
              id="year"
              name="year"
              type="number"
              defaultValue={record.year ?? new Date().getFullYear()}
              min={1900}
              max={2100}
              required
            />
          </div>

          <label className="checkbox-row" htmlFor="selected">
            <input
              id="selected"
              name="selected"
              type="checkbox"
              defaultChecked={record.selected ?? false}
            />
            <span>公開サイトの selected 論文に含める</span>
          </label>
        </div>

        <div className="field full">
          <label htmlFor="titleEn">titleEn</label>
          <input id="titleEn" name="titleEn" defaultValue={record.titleEn ?? ""} required />
        </div>

        <div className="field full">
          <label htmlFor="titleJa">titleJa</label>
          <input id="titleJa" name="titleJa" defaultValue={record.titleJa ?? ""} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="authorsEn">authorsEn</label>
            <textarea
              id="authorsEn"
              name="authorsEn"
              defaultValue={record.authorsEn ?? ""}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="authorsJa">authorsJa</label>
            <textarea
              id="authorsJa"
              name="authorsJa"
              defaultValue={record.authorsJa ?? ""}
              required
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="journalEn">journalEn</label>
            <input
              id="journalEn"
              name="journalEn"
              defaultValue={record.journalEn ?? ""}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="journalJa">journalJa</label>
            <input id="journalJa" name="journalJa" defaultValue={record.journalJa ?? ""} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="publicationUrl">publicationUrl</label>
            <input
              id="publicationUrl"
              name="publicationUrl"
              defaultValue={record.publicationUrl ?? ""}
            />
          </div>

          <div className="field">
            <label htmlFor="arxivUrl">arxivUrl</label>
            <input id="arxivUrl" name="arxivUrl" defaultValue={record.arxivUrl ?? ""} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="adsUrl">adsUrl</label>
          <input id="adsUrl" name="adsUrl" defaultValue={record.adsUrl ?? ""} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="abstractEn">abstractEn</label>
            <textarea id="abstractEn" name="abstractEn" defaultValue={record.abstractEn ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="abstractJa">abstractJa</label>
            <textarea id="abstractJa" name="abstractJa" defaultValue={record.abstractJa ?? ""} />
          </div>
        </div>

        <div className="inline-actions">
          <button type="submit">{mode === "create" ? "作成" : "保存"}</button>
          <a className="button secondary" href={cancelHref}>
            戻る
          </a>
        </div>
      </form>
    </div>
  );
}
