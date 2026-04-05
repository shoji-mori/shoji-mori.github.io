import type { PresentationRecord } from "@/lib/types";
import { parsePresentationDateText } from "@/lib/presentation-dates";

type PresentationFormProps = {
  action: string;
  cancelHref: string;
  mode: "create" | "edit";
  record: Partial<PresentationRecord>;
  saved?: boolean;
  errors?: string[];
};

export function PresentationForm({
  action,
  cancelHref,
  mode,
  record,
  saved,
  errors,
}: PresentationFormProps) {
  const { startDate, endDate } = parsePresentationDateText(record.dateText);

  return (
    <div className="card stack">
      <div>
        <h2>{mode === "create" ? "Presentation を追加" : "Presentation を編集"}</h2>
        <p className="muted">
          開始日・終了日はカレンダーから選択し、保存時に公開サイト互換の `date`
          文字列へ自動変換します。
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
        <input type="hidden" name="dateText" defaultValue={record.dateText ?? ""} />

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

          <div className="field">
            <label htmlFor="startDate">startDate</label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={startDate ?? ""}
              required
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="endDate">endDate</label>
          <input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={endDate ?? ""}
          />
          <p className="muted">
            1 日だけの発表なら空欄のままで構いません。保存時は開始日と同じ日付を使います。
          </p>
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
            <label htmlFor="confEn">confEn</label>
            <input id="confEn" name="confEn" defaultValue={record.confEn ?? ""} required />
          </div>

          <div className="field">
            <label htmlFor="confJa">confJa</label>
            <input id="confJa" name="confJa" defaultValue={record.confJa ?? ""} required />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="type">type</label>
            <select id="type" name="type" defaultValue={record.type ?? "oral"}>
              <option value="oral">oral</option>
              <option value="poster">poster</option>
              <option value="invited">invited</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="scope">scope</label>
            <select id="scope" name="scope" defaultValue={record.scope ?? "domestic"}>
              <option value="domestic">domestic</option>
              <option value="international">international</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="placeEn">placeEn</label>
            <input id="placeEn" name="placeEn" defaultValue={record.placeEn ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="placeJa">placeJa</label>
            <input id="placeJa" name="placeJa" defaultValue={record.placeJa ?? ""} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="url">url</label>
          <input id="url" name="url" defaultValue={record.url ?? ""} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="slideUrl">slideUrl</label>
            <input id="slideUrl" name="slideUrl" defaultValue={record.slideUrl ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="posterUrl">posterUrl</label>
            <input id="posterUrl" name="posterUrl" defaultValue={record.posterUrl ?? ""} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="videoUrl">videoUrl</label>
          <input id="videoUrl" name="videoUrl" defaultValue={record.videoUrl ?? ""} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="noteEn">noteEn</label>
            <textarea id="noteEn" name="noteEn" defaultValue={record.noteEn ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="noteJa">noteJa</label>
            <textarea id="noteJa" name="noteJa" defaultValue={record.noteJa ?? ""} />
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
