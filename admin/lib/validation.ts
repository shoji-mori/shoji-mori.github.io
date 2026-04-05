import type {
  PresentationInput,
  PresentationScope,
  PresentationType,
  PublicationInput,
  ValidationResult,
} from "@/lib/types";
import {
  formatPresentationDateText,
  isValidIsoDate,
} from "@/lib/presentation-dates";

type InputSource = FormData | Record<string, unknown>;

function getRawValue(source: InputSource, key: string): unknown {
  if (source instanceof FormData) {
    return source.get(key);
  }
  return source[key];
}

function getString(source: InputSource, key: string): string {
  const value = getRawValue(source, key);
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function getOptionalText(source: InputSource, key: string): string | null {
  const value = getString(source, key);
  return value === "" ? null : value;
}

function getRequiredText(
  source: InputSource,
  key: string,
  label: string,
  errors: string[],
): string {
  const value = getString(source, key);
  if (!value) {
    errors.push(`${label} は必須です。`);
  }
  return value;
}

function getBoolean(source: InputSource, key: string): boolean {
  const rawValue = getRawValue(source, key);
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    return ["on", "true", "1", "yes"].includes(rawValue.toLowerCase());
  }
  return false;
}

function getYear(source: InputSource, errors: string[]): number {
  const yearString = getRequiredText(source, "year", "year", errors);
  const year = Number.parseInt(yearString, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    errors.push("year は 1900-2100 の整数で入力してください。");
  }
  return year;
}

function getPresentationType(
  source: InputSource,
  errors: string[],
): PresentationType {
  const value = getRequiredText(source, "type", "type", errors);
  if (value === "oral" || value === "poster" || value === "invited") {
    return value;
  }
  errors.push("type は oral / poster / invited のいずれかにしてください。");
  return "oral";
}

function getPresentationScope(
  source: InputSource,
  errors: string[],
): PresentationScope {
  const value = getRequiredText(source, "scope", "scope", errors);
  if (value === "international" || value === "domestic") {
    return value;
  }
  errors.push(
    "scope は international / domestic のいずれかにしてください。",
  );
  return "domestic";
}

function getPresentationDateText(source: InputSource, errors: string[]) {
  const startDate = getString(source, "startDate");
  const endDateInput = getString(source, "endDate");
  const rawDateText = getString(source, "dateText");

  if (!startDate && !endDateInput) {
    return getRequiredText(source, "dateText", "date", errors);
  }

  if (!startDate) {
    errors.push("startDate は必須です。");
    return rawDateText;
  }

  const endDate = endDateInput || startDate;

  if (!isValidIsoDate(startDate)) {
    errors.push("startDate は日付として正しく入力してください。");
    return rawDateText;
  }

  if (!isValidIsoDate(endDate)) {
    errors.push("endDate は日付として正しく入力してください。");
    return rawDateText;
  }

  if (endDate < startDate) {
    errors.push("endDate は startDate 以降の日付にしてください。");
    return rawDateText;
  }

  return formatPresentationDateText(startDate, endDate);
}

function validateUrlFields(
  values: Array<string | null>,
  label: string,
  errors: string[],
) {
  const isValid = values.every((value) => {
    if (!value) {
      return true;
    }
    return (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("files/") ||
      value.startsWith("/")
    );
  });

  if (!isValid) {
    errors.push(`${label} は URL または相対パスで入力してください。`);
  }
}

export function parsePublicationInput(
  source: InputSource,
): ValidationResult<PublicationInput> {
  const errors: string[] = [];
  const data: PublicationInput = {
    year: getYear(source, errors),
    selected: getBoolean(source, "selected"),
    titleEn: getRequiredText(source, "titleEn", "titleEn", errors),
    titleJa: getOptionalText(source, "titleJa"),
    authorsEn: getRequiredText(source, "authorsEn", "authorsEn", errors),
    authorsJa: getRequiredText(source, "authorsJa", "authorsJa", errors),
    journalEn: getRequiredText(source, "journalEn", "journalEn", errors),
    journalJa: getOptionalText(source, "journalJa"),
    publicationUrl: getOptionalText(source, "publicationUrl"),
    arxivUrl: getOptionalText(source, "arxivUrl"),
    adsUrl: getOptionalText(source, "adsUrl"),
    abstractEn: getOptionalText(source, "abstractEn"),
    abstractJa: getOptionalText(source, "abstractJa"),
  };

  validateUrlFields(
    [data.publicationUrl, data.arxivUrl, data.adsUrl],
    "publicationUrl / arxivUrl / adsUrl",
    errors,
  );

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data };
}

export function parsePresentationInput(
  source: InputSource,
): ValidationResult<PresentationInput> {
  const errors: string[] = [];
  const data: PresentationInput = {
    year: getYear(source, errors),
    dateText: getPresentationDateText(source, errors),
    titleEn: getRequiredText(source, "titleEn", "titleEn", errors),
    titleJa: getOptionalText(source, "titleJa"),
    authorsEn: getRequiredText(source, "authorsEn", "authorsEn", errors),
    authorsJa: getRequiredText(source, "authorsJa", "authorsJa", errors),
    confEn: getRequiredText(source, "confEn", "confEn", errors),
    confJa: getRequiredText(source, "confJa", "confJa", errors),
    type: getPresentationType(source, errors),
    scope: getPresentationScope(source, errors),
    placeEn: getOptionalText(source, "placeEn"),
    placeJa: getOptionalText(source, "placeJa"),
    url: getOptionalText(source, "url"),
    slideUrl: getOptionalText(source, "slideUrl"),
    posterUrl: getOptionalText(source, "posterUrl"),
    videoUrl: getOptionalText(source, "videoUrl"),
    noteEn: getOptionalText(source, "noteEn"),
    noteJa: getOptionalText(source, "noteJa"),
  };

  validateUrlFields(
    [data.url, data.slideUrl, data.posterUrl, data.videoUrl],
    "url / slideUrl / posterUrl / videoUrl",
    errors,
  );

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data };
}
