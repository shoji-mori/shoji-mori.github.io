#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const adminRoot = path.resolve(__dirname, "..");
const tmpDir = path.join(adminRoot, "tmp");

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildInsert(table, row, columnMap) {
  const columns = Object.keys(columnMap);
  const values = columns.map((column) => sqlValue(row[columnMap[column]]));
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

async function readJson(filename) {
  const source = await readFile(path.join(tmpDir, filename), "utf8");
  return JSON.parse(source);
}

async function main() {
  const [publications, presentations] = await Promise.all([
    readJson("publications.seed.json"),
    readJson("presentations.seed.json"),
  ]);

  const lines = [
    "DELETE FROM audit_log;",
    "DELETE FROM publications;",
    "DELETE FROM presentations;",
    "",
  ];

  const publicationMap = {
    id: "id",
    sort_order: "sortOrder",
    year: "year",
    selected: "selected",
    title_en: "titleEn",
    title_ja: "titleJa",
    authors_en: "authorsEn",
    authors_ja: "authorsJa",
    journal_en: "journalEn",
    journal_ja: "journalJa",
    publication_url: "publicationUrl",
    arxiv_url: "arxivUrl",
    ads_url: "adsUrl",
    abstract_en: "abstractEn",
    abstract_ja: "abstractJa",
    created_at: "createdAt",
    updated_at: "updatedAt",
    updated_by: "updatedBy",
  };

  const presentationMap = {
    id: "id",
    sort_order: "sortOrder",
    year: "year",
    date_text: "dateText",
    sort_date: "sortDate",
    title_en: "titleEn",
    title_ja: "titleJa",
    authors_en: "authorsEn",
    authors_ja: "authorsJa",
    conf_en: "confEn",
    conf_ja: "confJa",
    type: "type",
    scope: "scope",
    place_en: "placeEn",
    place_ja: "placeJa",
    url: "url",
    slide_url: "slideUrl",
    poster_url: "posterUrl",
    video_url: "videoUrl",
    note_en: "noteEn",
    note_ja: "noteJa",
    created_at: "createdAt",
    updated_at: "updatedAt",
    updated_by: "updatedBy",
  };

  lines.push("-- publications");
  for (const row of publications) {
    lines.push(buildInsert("publications", row, publicationMap));
  }
  lines.push("");
  lines.push("-- presentations");
  for (const row of presentations) {
    lines.push(buildInsert("presentations", row, presentationMap));
  }
  lines.push("");

  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "seed.sql"), `${lines.join("\n")}\n`, "utf8");

  console.log(
    `Wrote ${publications.length + presentations.length} inserts to tmp/seed.sql`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
