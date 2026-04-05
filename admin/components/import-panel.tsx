"use client";

import type { FormEvent } from "react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ImportItem = {
  dataset: "publications" | "presentations";
  count: number;
  filename: string;
};

export function ImportPanel() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportItem[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImports([]);

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const response = await fetch("/api/import", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | { ok: true; imports: ImportItem[] }
        | { error?: string; filename?: string };

      if (!response.ok || !("ok" in payload)) {
        const filename =
          "filename" in payload && payload.filename ? ` (${payload.filename})` : "";
        const errorMessage =
          "error" in payload ? payload.error : "アップロードに失敗しました。";
        setError((errorMessage ?? "アップロードに失敗しました。") + filename);
        return;
      }

      setImports(payload.imports);
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <div className="card stack">
      <div>
        <h2>Import</h2>
        <p className="muted">
          `publications_data.js` / `presentations_data.js` または同等の JSON
          配列をアップロードして、D1 の正本データを置き換えます。
        </p>
      </div>

      <form className="stack" ref={formRef} onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="import-files">アップロードするファイル</label>
          <input
            id="import-files"
            name="files"
            type="file"
            accept=".js,.json,application/javascript,application/json"
            multiple
            required
          />
        </div>

        <div className="inline-actions">
          <button type="submit" disabled={isPending}>
            {isPending ? "Uploading..." : "Upload to D1"}
          </button>
        </div>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      {imports.length > 0 ? (
        <div className="notice stack">
          <strong>アップロード完了</strong>
          {imports.map((item) => (
            <span key={`${item.dataset}:${item.filename}`}>
              {item.dataset}: {item.count} 件 ({item.filename})
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
