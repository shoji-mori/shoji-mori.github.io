import type {
  PresentationInput,
  PresentationScope,
  PresentationType,
  PublicationInput,
} from "@/lib/types";
import {
  parsePresentationInput,
  parsePublicationInput,
} from "@/lib/validation";

type ImportDataset = "publications" | "presentations";

type ParsedImportFile = {
  dataset: ImportDataset;
  items: unknown[];
};

type ImportParseSuccess<T> = {
  ok: true;
  dataset: ImportDataset;
  items: T[];
};

type ImportParseFailure = {
  ok: false;
  error: string;
};

export type ImportResult<T> = ImportParseSuccess<T> | ImportParseFailure;

const knownInternationalConferences = new Set([
  "Magnetohydrodynamical Flows in Young Circumstellar Disks",
  "SPIDI: The Inner Disk of Young Stars: Accretion, Ejection, and Planet Formation",
  "Protostars and Planets VII",
]);

function parseWindowAssignment(
  source: string,
  variableName: "publicationsData" | "presentationsData",
) {
  const matcher = new RegExp(
    `window\\.${variableName}\\s*=\\s*(\\[[\\s\\S]*\\])\\s*;?\\s*$`,
    "m",
  );
  const match = source.match(matcher);
  if (!match) {
    return null;
  }

  return JSON.parse(match[1]) as unknown[];
}

function parseSource(source: string): ParsedImportFile {
  const trimmed = source.trim();

  const publications = parseWindowAssignment(trimmed, "publicationsData");
  if (publications) {
    return { dataset: "publications", items: publications };
  }

  const presentations = parseWindowAssignment(trimmed, "presentationsData");
  if (presentations) {
    return { dataset: "presentations", items: presentations };
  }

  const payload = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("JSON upload must be an array.");
  }

  const firstItem = payload.find((item) => item && typeof item === "object");
  if (!firstItem || typeof firstItem !== "object") {
    throw new Error("Could not detect dataset type from uploaded file.");
  }

  if ("journalEn" in firstItem || "publicationUrl" in firstItem) {
    return { dataset: "publications", items: payload };
  }

  if ("confEn" in firstItem || "date" in firstItem || "type" in firstItem) {
    return { dataset: "presentations", items: payload };
  }

  throw new Error("Could not detect dataset type from uploaded file.");
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function inferPresentationScope(item: Record<string, unknown>): PresentationScope {
  const rawScope = item.scope;
  if (rawScope === "international" || rawScope === "domestic") {
    return rawScope;
  }

  const confEn = String(item.confEn ?? "");
  if (knownInternationalConferences.has(confEn)) {
    return "international";
  }

  const placeEn = String(item.placeEn ?? "");
  if (placeEn && !placeEn.includes("Japan") && !placeEn.includes("Online")) {
    return "international";
  }

  return "domestic";
}

function inferPresentationType(item: Record<string, unknown>): PresentationType {
  const rawType = item.type;
  if (rawType === "oral" || rawType === "poster" || rawType === "invited") {
    return rawType;
  }
  return "oral";
}

function normalizePublicationItem(item: unknown): Record<string, unknown> {
  const record = asRecord(item);
  return {
    year: record.year ?? "",
    selected: record.selected ?? false,
    titleEn: record.titleEn ?? "",
    titleJa: record.titleJa ?? "",
    authorsEn: record.authorsEn ?? "",
    authorsJa: record.authorsJa ?? "",
    journalEn: record.journalEn ?? record.journal ?? "",
    journalJa: record.journalJa ?? record.journal ?? "",
    publicationUrl: record.publicationUrl ?? record.url ?? "",
    arxivUrl: record.arxivUrl ?? "",
    adsUrl: record.adsUrl ?? "",
    abstractEn: record.abstractEn ?? "",
    abstractJa: record.abstractJa ?? "",
  };
}

function normalizePresentationItem(item: unknown): Record<string, unknown> {
  const record = asRecord(item);
  return {
    year: record.year ?? "",
    dateText: record.dateText ?? record.date ?? "",
    titleEn: record.titleEn ?? "",
    titleJa: record.titleJa ?? "",
    authorsEn: record.authorsEn ?? "",
    authorsJa: record.authorsJa ?? "",
    confEn: record.confEn ?? "",
    confJa: record.confJa ?? "",
    type: inferPresentationType(record),
    scope: inferPresentationScope(record),
    placeEn: record.placeEn ?? "",
    placeJa: record.placeJa ?? "",
    url: record.url ?? "",
    slideUrl: record.slideUrl ?? "",
    posterUrl: record.posterUrl ?? "",
    videoUrl: record.videoUrl ?? "",
    noteEn: record.noteEn ?? "",
    noteJa: record.noteJa ?? "",
  };
}

export function parsePublicationImport(source: string): ImportResult<PublicationInput> {
  let parsed: ParsedImportFile;
  try {
    parsed = parseSource(source);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not parse uploaded file.",
    };
  }

  if (parsed.dataset !== "publications") {
    return { ok: false, error: "Uploaded file is not publications data." };
  }

  const items: PublicationInput[] = [];
  const errors: string[] = [];

  for (const [index, item] of parsed.items.entries()) {
    const result = parsePublicationInput(normalizePublicationItem(item));
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `#${index + 1}: ${error}`));
      continue;
    }
    items.push(result.data);
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join(" ") };
  }

  return { ok: true, dataset: "publications", items };
}

export function parsePresentationImport(
  source: string,
): ImportResult<PresentationInput> {
  let parsed: ParsedImportFile;
  try {
    parsed = parseSource(source);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not parse uploaded file.",
    };
  }

  if (parsed.dataset !== "presentations") {
    return { ok: false, error: "Uploaded file is not presentations data." };
  }

  const items: PresentationInput[] = [];
  const errors: string[] = [];

  for (const [index, item] of parsed.items.entries()) {
    const result = parsePresentationInput(normalizePresentationItem(item));
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `#${index + 1}: ${error}`));
      continue;
    }
    items.push(result.data);
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join(" ") };
  }

  return { ok: true, dataset: "presentations", items };
}
