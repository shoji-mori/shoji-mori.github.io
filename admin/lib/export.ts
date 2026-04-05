import type { PresentationRecord, PublicationRecord } from "@/lib/types";

function stringifyWindowAssignment(name: string, payload: unknown) {
  return `window.${name} = ${JSON.stringify(payload, null, 2)};\n`;
}

export function buildPublicationsDataJs(records: PublicationRecord[]) {
  const exportPayload = records.map((record) => ({
    year: String(record.year),
    selected: record.selected,
    titleEn: record.titleEn,
    titleJa: record.titleJa ?? record.titleEn,
    authorsEn: record.authorsEn,
    authorsJa: record.authorsJa,
    journalEn: record.journalEn,
    journalJa: record.journalJa ?? record.journalEn,
    publicationUrl: record.publicationUrl,
    arxivUrl: record.arxivUrl,
    adsUrl: record.adsUrl,
    abstractEn: record.abstractEn ?? "",
    abstractJa: record.abstractJa ?? "",
  }));

  return stringifyWindowAssignment("publicationsData", exportPayload);
}

export function buildPresentationsDataJs(records: PresentationRecord[]) {
  const exportPayload = records.map((record) => {
    const item: Record<string, string> = {
      year: String(record.year),
      date: record.dateText,
      titleEn: record.titleEn,
      titleJa: record.titleJa ?? record.titleEn,
      authorsEn: record.authorsEn,
      authorsJa: record.authorsJa,
      confEn: record.confEn,
      confJa: record.confJa,
      type: record.type,
      scope: record.scope,
    };

    if (record.placeEn) {
      item.placeEn = record.placeEn;
    }
    if (record.placeJa ?? record.placeEn) {
      item.placeJa = record.placeJa ?? record.placeEn ?? "";
    }
    if (record.url !== null) {
      item.url = record.url;
    }
    if (record.slideUrl) {
      item.slideUrl = record.slideUrl;
    }
    if (record.posterUrl) {
      item.posterUrl = record.posterUrl;
    }
    if (record.videoUrl) {
      item.videoUrl = record.videoUrl;
    }
    if (record.noteEn) {
      item.noteEn = record.noteEn;
    }
    if (record.noteJa ?? record.noteEn) {
      item.noteJa = record.noteJa ?? record.noteEn ?? "";
    }

    return item;
  });

  return stringifyWindowAssignment("presentationsData", exportPayload);
}

export function buildDownloadHeaders(filename: string) {
  return {
    "content-type": "application/javascript; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  };
}
