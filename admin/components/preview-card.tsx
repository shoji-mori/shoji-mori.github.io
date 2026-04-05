import type { PresentationRecord, PublicationRecord } from "@/lib/types";

type PreviewCardProps =
  | { kind: "publication"; record: Partial<PublicationRecord> }
  | { kind: "presentation"; record: Partial<PresentationRecord> };

export function PreviewCard(props: PreviewCardProps) {
  if (props.kind === "publication") {
    const { record } = props;
    return (
      <div className="preview-card">
        <div className="meta">
          <span>{record.year ?? "YYYY"}</span>
          {record.selected ? <span className="tag selected">selected</span> : null}
        </div>
        <h4>{record.titleEn ?? "Publication title"}</h4>
        <p className="muted">{record.authorsEn ?? "Authors"}</p>
        <p>{record.journalEn ?? "Journal"}</p>
      </div>
    );
  }

  const { record } = props;
  return (
    <div className="preview-card">
      <div className="meta">
        <span>{record.year ?? "YYYY"}</span>
        {record.type ? <span className="tag">{record.type}</span> : null}
        {record.scope ? <span className="tag">{record.scope}</span> : null}
      </div>
      <h4>{record.titleEn ?? "Presentation title"}</h4>
      <p className="muted">{record.authorsEn ?? "Authors"}</p>
      <p>{record.confEn ?? "Conference"}</p>
      <p className="muted">
        {[record.dateText, record.placeEn].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
