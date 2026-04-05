type ExportPanelProps = {
  publicationCount: number;
  presentationCount: number;
};

export function ExportPanel({
  publicationCount,
  presentationCount,
}: ExportPanelProps) {
  return (
    <div className="card stack">
      <div>
        <h2>Export</h2>
        <p className="muted">
          D1 に保存されている正本データから、公開サイト互換の JS を生成して
          ダウンロードします。
        </p>
      </div>

      <div className="meta">
        <span>{publicationCount} publications</span>
        <span>{presentationCount} presentations</span>
      </div>

      <div className="inline-actions">
        <a className="button" href="/api/export/publications">
          publications_data.js
        </a>
        <a className="button secondary" href="/api/export/presentations">
          presentations_data.js
        </a>
      </div>
    </div>
  );
}
