import { getCloudflareContext } from "@opennextjs/cloudflare";

import type {
  AdminUser,
  PresentationInput,
  PresentationRecord,
  RecordFilters,
  PublicationInput,
  PublicationRecord,
} from "@/lib/types";

type PublicationRow = {
  id: string;
  sort_order: number;
  year: number;
  selected: number;
  title_en: string;
  title_ja: string | null;
  authors_en: string;
  authors_ja: string;
  journal_en: string;
  journal_ja: string | null;
  publication_url: string | null;
  arxiv_url: string | null;
  ads_url: string | null;
  abstract_en: string | null;
  abstract_ja: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
};

type PresentationRow = {
  id: string;
  sort_order: number;
  year: number;
  date_text: string;
  sort_date: string | null;
  title_en: string;
  title_ja: string | null;
  authors_en: string;
  authors_ja: string;
  conf_en: string;
  conf_ja: string;
  type: "oral" | "poster" | "invited";
  scope: "international" | "domestic";
  place_en: string | null;
  place_ja: string | null;
  url: string | null;
  slide_url: string | null;
  poster_url: string | null;
  video_url: string | null;
  note_en: string | null;
  note_ja: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
};

type AuditAction = "create" | "update" | "delete" | "duplicate" | "import";

function mapPublicationRow(row: PublicationRow): PublicationRecord {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    year: row.year,
    selected: Boolean(row.selected),
    titleEn: row.title_en,
    titleJa: row.title_ja,
    authorsEn: row.authors_en,
    authorsJa: row.authors_ja,
    journalEn: row.journal_en,
    journalJa: row.journal_ja,
    publicationUrl: row.publication_url,
    arxivUrl: row.arxiv_url,
    adsUrl: row.ads_url,
    abstractEn: row.abstract_en,
    abstractJa: row.abstract_ja,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapPresentationRow(row: PresentationRow): PresentationRecord {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    year: row.year,
    dateText: row.date_text,
    sortDate: row.sort_date,
    titleEn: row.title_en,
    titleJa: row.title_ja,
    authorsEn: row.authors_en,
    authorsJa: row.authors_ja,
    confEn: row.conf_en,
    confJa: row.conf_ja,
    type: row.type,
    scope: row.scope,
    placeEn: row.place_en,
    placeJa: row.place_ja,
    url: row.url,
    slideUrl: row.slide_url,
    posterUrl: row.poster_url,
    videoUrl: row.video_url,
    noteEn: row.note_en,
    noteJa: row.note_ja,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function likeTerm(value: string) {
  return `%${value.trim()}%`;
}

function guessSortDate(dateText: string): string | null {
  const match = dateText.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?/);
  if (!match) {
    return null;
  }

  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = (match[3] ?? "1").padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

async function firstRow<T>(statement: D1PreparedStatement): Promise<T | null> {
  return statement.first<T>();
}

async function nextSortOrder(table: "publications" | "presentations") {
  const db = getDb();
  const row = await firstRow<{ next_sort_order: number }>(
    db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order FROM ${table}`,
      )
      .bind(),
  );
  return row?.next_sort_order ?? 1;
}

async function insertAuditLog(
  entityType: "publication" | "presentation",
  entityId: string,
  action: AuditAction,
  beforeJson: unknown,
  afterJson: unknown,
  actor: string,
) {
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO audit_log (
        entity_type,
        entity_id,
        action,
        before_json,
        after_json,
        actor,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entityType,
      entityId,
      action,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
      actor,
      nowIso(),
    )
    .run();
}

export function getCloudflareEnv(): CloudflareEnv {
  return getCloudflareContext().env as CloudflareEnv;
}

export function getDb(): D1Database {
  const db = getCloudflareEnv().ADMIN_DB;
  if (!db) {
    throw new Error("Missing ADMIN_DB D1 binding.");
  }
  return db;
}

export async function getDashboardCounts() {
  const db = getDb();
  const [publicationCount, presentationCount] = await Promise.all([
    firstRow<{ total: number }>(
      db.prepare("SELECT COUNT(*) AS total FROM publications").bind(),
    ),
    firstRow<{ total: number }>(
      db.prepare("SELECT COUNT(*) AS total FROM presentations").bind(),
    ),
  ]);

  return {
    publications: publicationCount?.total ?? 0,
    presentations: presentationCount?.total ?? 0,
  };
}

export async function listPublicationYears() {
  const rows = await allRows<{ year: number }>(
    getDb()
      .prepare("SELECT DISTINCT year FROM publications ORDER BY year DESC")
      .bind(),
  );
  return rows.map((row) => row.year);
}

export async function listPublications(filters: RecordFilters = {}) {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    const term = likeTerm(filters.q);
    clauses.push(
      `(
        title_en LIKE ? OR
        COALESCE(title_ja, '') LIKE ? OR
        authors_en LIKE ? OR
        authors_ja LIKE ? OR
        journal_en LIKE ? OR
        COALESCE(journal_ja, '') LIKE ?
      )`,
    );
    params.push(term, term, term, term, term, term);
  }

  if (filters.year) {
    clauses.push("year = ?");
    params.push(Number.parseInt(filters.year, 10));
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await allRows<PublicationRow>(
    db
      .prepare(
        `SELECT
          id,
          sort_order,
          year,
          selected,
          title_en,
          title_ja,
          authors_en,
          authors_ja,
          journal_en,
          journal_ja,
          publication_url,
          arxiv_url,
          ads_url,
          abstract_en,
          abstract_ja,
          created_at,
          updated_at,
          updated_by
        FROM publications
        ${where}
        ORDER BY year DESC, sort_order DESC`,
      )
      .bind(...params),
  );
  return rows.map(mapPublicationRow);
}

export async function listPublicationsForExport() {
  const rows = await allRows<PublicationRow>(
    getDb()
      .prepare(
        `SELECT
          id,
          sort_order,
          year,
          selected,
          title_en,
          title_ja,
          authors_en,
          authors_ja,
          journal_en,
          journal_ja,
          publication_url,
          arxiv_url,
          ads_url,
          abstract_en,
          abstract_ja,
          created_at,
          updated_at,
          updated_by
        FROM publications
        ORDER BY sort_order DESC`,
      )
      .bind(),
  );
  return rows.map(mapPublicationRow);
}

export async function getPublication(id: string) {
  const row = await firstRow<PublicationRow>(
    getDb()
      .prepare(
        `SELECT
          id,
          sort_order,
          year,
          selected,
          title_en,
          title_ja,
          authors_en,
          authors_ja,
          journal_en,
          journal_ja,
          publication_url,
          arxiv_url,
          ads_url,
          abstract_en,
          abstract_ja,
          created_at,
          updated_at,
          updated_by
        FROM publications
        WHERE id = ?`,
      )
      .bind(id),
  );
  return row ? mapPublicationRow(row) : null;
}

export async function createPublication(input: PublicationInput, actor: AdminUser) {
  const db = getDb();
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const sortOrder = await nextSortOrder("publications");

  await db
    .prepare(
      `INSERT INTO publications (
        id,
        sort_order,
        year,
        selected,
        title_en,
        title_ja,
        authors_en,
        authors_ja,
        journal_en,
        journal_ja,
        publication_url,
        arxiv_url,
        ads_url,
        abstract_en,
        abstract_ja,
        created_at,
        updated_at,
        updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      sortOrder,
      input.year,
      input.selected ? 1 : 0,
      input.titleEn,
      input.titleJa,
      input.authorsEn,
      input.authorsJa,
      input.journalEn,
      input.journalJa,
      input.publicationUrl,
      input.arxivUrl,
      input.adsUrl,
      input.abstractEn,
      input.abstractJa,
      timestamp,
      timestamp,
      actor.email,
    )
    .run();

  const created = await getPublication(id);
  if (!created) {
    throw new Error("Failed to read created publication.");
  }

  await insertAuditLog("publication", id, "create", null, created, actor.email);
  return created;
}

export async function updatePublication(
  id: string,
  input: PublicationInput,
  actor: AdminUser,
) {
  const before = await getPublication(id);
  if (!before) {
    return null;
  }

  await getDb()
    .prepare(
      `UPDATE publications
      SET
        year = ?,
        selected = ?,
        title_en = ?,
        title_ja = ?,
        authors_en = ?,
        authors_ja = ?,
        journal_en = ?,
        journal_ja = ?,
        publication_url = ?,
        arxiv_url = ?,
        ads_url = ?,
        abstract_en = ?,
        abstract_ja = ?,
        updated_at = ?,
        updated_by = ?
      WHERE id = ?`,
    )
    .bind(
      input.year,
      input.selected ? 1 : 0,
      input.titleEn,
      input.titleJa,
      input.authorsEn,
      input.authorsJa,
      input.journalEn,
      input.journalJa,
      input.publicationUrl,
      input.arxivUrl,
      input.adsUrl,
      input.abstractEn,
      input.abstractJa,
      nowIso(),
      actor.email,
      id,
    )
    .run();

  const after = await getPublication(id);
  if (!after) {
    throw new Error("Failed to read updated publication.");
  }

  await insertAuditLog("publication", id, "update", before, after, actor.email);
  return after;
}

export async function deletePublication(id: string, actor: AdminUser) {
  const before = await getPublication(id);
  if (!before) {
    return false;
  }

  await getDb().prepare("DELETE FROM publications WHERE id = ?").bind(id).run();
  await insertAuditLog("publication", id, "delete", before, null, actor.email);
  return true;
}

export async function duplicatePublication(id: string, actor: AdminUser) {
  const source = await getPublication(id);
  if (!source) {
    return null;
  }

  const duplicated = await createPublication(
    {
      year: source.year,
      selected: source.selected,
      titleEn: source.titleEn,
      titleJa: source.titleJa,
      authorsEn: source.authorsEn,
      authorsJa: source.authorsJa,
      journalEn: source.journalEn,
      journalJa: source.journalJa,
      publicationUrl: source.publicationUrl,
      arxivUrl: source.arxivUrl,
      adsUrl: source.adsUrl,
      abstractEn: source.abstractEn,
      abstractJa: source.abstractJa,
    },
    actor,
  );

  await insertAuditLog(
    "publication",
    duplicated.id,
    "duplicate",
    source,
    duplicated,
    actor.email,
  );

  return duplicated;
}

export async function replaceAllPublications(
  inputs: PublicationInput[],
  actor: AdminUser,
) {
  const db = getDb();
  const timestamp = nowIso();
  const beforeCount = (await getDashboardCounts()).publications;
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM publications").bind(),
  ];

  for (const [index, input] of inputs.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO publications (
            id,
            sort_order,
            year,
            selected,
            title_en,
            title_ja,
            authors_en,
            authors_ja,
            journal_en,
            journal_ja,
            publication_url,
            arxiv_url,
            ads_url,
            abstract_en,
            abstract_ja,
            created_at,
            updated_at,
            updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          inputs.length - index,
          input.year,
          input.selected ? 1 : 0,
          input.titleEn,
          input.titleJa,
          input.authorsEn,
          input.authorsJa,
          input.journalEn,
          input.journalJa,
          input.publicationUrl,
          input.arxivUrl,
          input.adsUrl,
          input.abstractEn,
          input.abstractJa,
          timestamp,
          timestamp,
          actor.email,
        ),
    );
  }

  await db.batch(statements);
  await insertAuditLog(
    "publication",
    "bulk-import",
    "import",
    { count: beforeCount },
    { count: inputs.length },
    actor.email,
  );
}

export async function listPresentationYears() {
  const rows = await allRows<{ year: number }>(
    getDb()
      .prepare("SELECT DISTINCT year FROM presentations ORDER BY year DESC")
      .bind(),
  );
  return rows.map((row) => row.year);
}

export async function listPresentations(filters: RecordFilters = {}) {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    const term = likeTerm(filters.q);
    clauses.push(
      `(
        title_en LIKE ? OR
        COALESCE(title_ja, '') LIKE ? OR
        authors_en LIKE ? OR
        authors_ja LIKE ? OR
        conf_en LIKE ? OR
        conf_ja LIKE ?
      )`,
    );
    params.push(term, term, term, term, term, term);
  }

  if (filters.year) {
    clauses.push("year = ?");
    params.push(Number.parseInt(filters.year, 10));
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await allRows<PresentationRow>(
    db
      .prepare(
        `SELECT
          id,
          sort_order,
          year,
          date_text,
          sort_date,
          title_en,
          title_ja,
          authors_en,
          authors_ja,
          conf_en,
          conf_ja,
          type,
          scope,
          place_en,
          place_ja,
          url,
          slide_url,
          poster_url,
          video_url,
          note_en,
          note_ja,
          created_at,
          updated_at,
          updated_by
        FROM presentations
        ${where}
        ORDER BY COALESCE(sort_date, printf('%04d-01-01', year)) DESC, sort_order DESC`,
      )
      .bind(...params),
  );
  return rows.map(mapPresentationRow);
}

export async function listPresentationsForExport() {
  const rows = await allRows<PresentationRow>(
    getDb()
      .prepare(
        `SELECT
          id,
          sort_order,
          year,
          date_text,
          sort_date,
          title_en,
          title_ja,
          authors_en,
          authors_ja,
          conf_en,
          conf_ja,
          type,
          scope,
          place_en,
          place_ja,
          url,
          slide_url,
          poster_url,
          video_url,
          note_en,
          note_ja,
          created_at,
          updated_at,
          updated_by
        FROM presentations
        ORDER BY sort_order DESC`,
      )
      .bind(),
  );
  return rows.map(mapPresentationRow);
}

export async function getPresentation(id: string) {
  const row = await firstRow<PresentationRow>(
    getDb()
      .prepare(
        `SELECT
          id,
          sort_order,
          year,
          date_text,
          sort_date,
          title_en,
          title_ja,
          authors_en,
          authors_ja,
          conf_en,
          conf_ja,
          type,
          scope,
          place_en,
          place_ja,
          url,
          slide_url,
          poster_url,
          video_url,
          note_en,
          note_ja,
          created_at,
          updated_at,
          updated_by
        FROM presentations
        WHERE id = ?`,
      )
      .bind(id),
  );
  return row ? mapPresentationRow(row) : null;
}

export async function createPresentation(
  input: PresentationInput,
  actor: AdminUser,
) {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const sortOrder = await nextSortOrder("presentations");

  await getDb()
    .prepare(
      `INSERT INTO presentations (
        id,
        sort_order,
        year,
        date_text,
        sort_date,
        title_en,
        title_ja,
        authors_en,
        authors_ja,
        conf_en,
        conf_ja,
        type,
        scope,
        place_en,
        place_ja,
        url,
        slide_url,
        poster_url,
        video_url,
        note_en,
        note_ja,
        created_at,
        updated_at,
        updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      sortOrder,
      input.year,
      input.dateText,
      guessSortDate(input.dateText),
      input.titleEn,
      input.titleJa,
      input.authorsEn,
      input.authorsJa,
      input.confEn,
      input.confJa,
      input.type,
      input.scope,
      input.placeEn,
      input.placeJa,
      input.url,
      input.slideUrl,
      input.posterUrl,
      input.videoUrl,
      input.noteEn,
      input.noteJa,
      timestamp,
      timestamp,
      actor.email,
    )
    .run();

  const created = await getPresentation(id);
  if (!created) {
    throw new Error("Failed to read created presentation.");
  }

  await insertAuditLog("presentation", id, "create", null, created, actor.email);
  return created;
}

export async function updatePresentation(
  id: string,
  input: PresentationInput,
  actor: AdminUser,
) {
  const before = await getPresentation(id);
  if (!before) {
    return null;
  }

  await getDb()
    .prepare(
      `UPDATE presentations
      SET
        year = ?,
        date_text = ?,
        sort_date = ?,
        title_en = ?,
        title_ja = ?,
        authors_en = ?,
        authors_ja = ?,
        conf_en = ?,
        conf_ja = ?,
        type = ?,
        scope = ?,
        place_en = ?,
        place_ja = ?,
        url = ?,
        slide_url = ?,
        poster_url = ?,
        video_url = ?,
        note_en = ?,
        note_ja = ?,
        updated_at = ?,
        updated_by = ?
      WHERE id = ?`,
    )
    .bind(
      input.year,
      input.dateText,
      guessSortDate(input.dateText),
      input.titleEn,
      input.titleJa,
      input.authorsEn,
      input.authorsJa,
      input.confEn,
      input.confJa,
      input.type,
      input.scope,
      input.placeEn,
      input.placeJa,
      input.url,
      input.slideUrl,
      input.posterUrl,
      input.videoUrl,
      input.noteEn,
      input.noteJa,
      nowIso(),
      actor.email,
      id,
    )
    .run();

  const after = await getPresentation(id);
  if (!after) {
    throw new Error("Failed to read updated presentation.");
  }

  await insertAuditLog("presentation", id, "update", before, after, actor.email);
  return after;
}

export async function deletePresentation(id: string, actor: AdminUser) {
  const before = await getPresentation(id);
  if (!before) {
    return false;
  }

  await getDb().prepare("DELETE FROM presentations WHERE id = ?").bind(id).run();
  await insertAuditLog("presentation", id, "delete", before, null, actor.email);
  return true;
}

export async function duplicatePresentation(id: string, actor: AdminUser) {
  const source = await getPresentation(id);
  if (!source) {
    return null;
  }

  const duplicated = await createPresentation(
    {
      year: source.year,
      dateText: source.dateText,
      titleEn: source.titleEn,
      titleJa: source.titleJa,
      authorsEn: source.authorsEn,
      authorsJa: source.authorsJa,
      confEn: source.confEn,
      confJa: source.confJa,
      type: source.type,
      scope: source.scope,
      placeEn: source.placeEn,
      placeJa: source.placeJa,
      url: source.url,
      slideUrl: source.slideUrl,
      posterUrl: source.posterUrl,
      videoUrl: source.videoUrl,
      noteEn: source.noteEn,
      noteJa: source.noteJa,
    },
    actor,
  );

  await insertAuditLog(
    "presentation",
    duplicated.id,
    "duplicate",
    source,
    duplicated,
    actor.email,
  );

  return duplicated;
}

export async function replaceAllPresentations(
  inputs: PresentationInput[],
  actor: AdminUser,
) {
  const db = getDb();
  const timestamp = nowIso();
  const beforeCount = (await getDashboardCounts()).presentations;
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM presentations").bind(),
  ];

  for (const [index, input] of inputs.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO presentations (
            id,
            sort_order,
            year,
            date_text,
            sort_date,
            title_en,
            title_ja,
            authors_en,
            authors_ja,
            conf_en,
            conf_ja,
            type,
            scope,
            place_en,
            place_ja,
            url,
            slide_url,
            poster_url,
            video_url,
            note_en,
            note_ja,
            created_at,
            updated_at,
            updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          inputs.length - index,
          input.year,
          input.dateText,
          guessSortDate(input.dateText),
          input.titleEn,
          input.titleJa,
          input.authorsEn,
          input.authorsJa,
          input.confEn,
          input.confJa,
          input.type,
          input.scope,
          input.placeEn,
          input.placeJa,
          input.url,
          input.slideUrl,
          input.posterUrl,
          input.videoUrl,
          input.noteEn,
          input.noteJa,
          timestamp,
          timestamp,
          actor.email,
        ),
    );
  }

  await db.batch(statements);
  await insertAuditLog(
    "presentation",
    "bulk-import",
    "import",
    { count: beforeCount },
    { count: inputs.length },
    actor.email,
  );
}
