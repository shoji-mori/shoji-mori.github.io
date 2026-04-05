export type AdminUser = {
  email: string;
  sub: string;
  country?: string;
};

export type RecordFilters = {
  q?: string;
  year?: string;
};

export type PublicationRecord = {
  id: string;
  sortOrder: number;
  year: number;
  selected: boolean;
  titleEn: string;
  titleJa: string | null;
  authorsEn: string;
  authorsJa: string;
  journalEn: string;
  journalJa: string | null;
  publicationUrl: string | null;
  arxivUrl: string | null;
  adsUrl: string | null;
  abstractEn: string | null;
  abstractJa: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type PublicationInput = {
  year: number;
  selected: boolean;
  titleEn: string;
  titleJa: string | null;
  authorsEn: string;
  authorsJa: string;
  journalEn: string;
  journalJa: string | null;
  publicationUrl: string | null;
  arxivUrl: string | null;
  adsUrl: string | null;
  abstractEn: string | null;
  abstractJa: string | null;
};

export type PresentationType = "oral" | "poster" | "invited";
export type PresentationScope = "international" | "domestic";

export type PresentationRecord = {
  id: string;
  sortOrder: number;
  year: number;
  dateText: string;
  sortDate: string | null;
  titleEn: string;
  titleJa: string | null;
  authorsEn: string;
  authorsJa: string;
  confEn: string;
  confJa: string;
  type: PresentationType;
  scope: PresentationScope;
  placeEn: string | null;
  placeJa: string | null;
  url: string | null;
  slideUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  noteEn: string | null;
  noteJa: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type PresentationInput = {
  year: number;
  dateText: string;
  titleEn: string;
  titleJa: string | null;
  authorsEn: string;
  authorsJa: string;
  confEn: string;
  confJa: string;
  type: PresentationType;
  scope: PresentationScope;
  placeEn: string | null;
  placeJa: string | null;
  url: string | null;
  slideUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  noteEn: string | null;
  noteJa: string | null;
};

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };
