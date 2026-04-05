#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const adminRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(adminRoot, "..");
const outputDir = path.join(adminRoot, "tmp");

function parseWindowArray(source, variableName) {
  const matcher = new RegExp(
    `window\\.${variableName}\\s*=\\s*(\\[[\\s\\S]*\\])\\s*;?\\s*$`,
    "m",
  );
  const match = source.match(matcher);
  if (!match) {
    throw new Error(`Could not parse window.${variableName} assignment.`);
  }
  return JSON.parse(match[1]);
}

function nowIso() {
  return new Date().toISOString();
}

function guessSortDate(dateText) {
  const match = String(dateText).match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?/);
  if (!match) {
    return null;
  }

  const month = match[2].padStart(2, "0");
  const day = (match[3] ?? "1").padStart(2, "0");
  return `${match[1]}-${month}-${day}`;
}

function inferPresentationScope(item) {
  if (item.scope === "international" || item.scope === "domestic") {
    return item.scope;
  }

  const knownInternational = new Set([
    "Magnetohydrodynamical Flows in Young Circumstellar Disks",
    "SPIDI: The Inner Disk of Young Stars: Accretion, Ejection, and Planet Formation",
    "Protostars and Planets VII",
  ]);

  if (knownInternational.has(item.confEn)) {
    return "international";
  }

  const placeEn = String(item.placeEn ?? "");
  if (placeEn && !placeEn.includes("Japan") && !placeEn.includes("Online")) {
    return "international";
  }

  return "domestic";
}

function normalizePublications(items) {
  return items.map((item, index) => ({
    id: crypto.randomUUID(),
    sortOrder: items.length - index,
    year: Number.parseInt(item.year, 10),
    selected: Boolean(item.selected),
    titleEn: item.titleEn ?? "",
    titleJa: item.titleJa ?? null,
    authorsEn: item.authorsEn ?? "",
    authorsJa: item.authorsJa ?? "",
    journalEn: item.journalEn ?? item.journal ?? "",
    journalJa: item.journalJa ?? item.journal ?? null,
    publicationUrl: item.publicationUrl ?? item.url ?? null,
    arxivUrl: item.arxivUrl ?? null,
    adsUrl: item.adsUrl ?? null,
    abstractEn: item.abstractEn ?? null,
    abstractJa: item.abstractJa ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    updatedBy: "import-script",
  }));
}

function normalizePresentations(items) {
  return items.map((item, index) => ({
    id: crypto.randomUUID(),
    sortOrder: items.length - index,
    year: Number.parseInt(item.year, 10),
    dateText: item.date ?? "",
    sortDate: guessSortDate(item.date ?? ""),
    titleEn: item.titleEn ?? "",
    titleJa: item.titleJa ?? null,
    authorsEn: item.authorsEn ?? "",
    authorsJa: item.authorsJa ?? "",
    confEn: item.confEn ?? "",
    confJa: item.confJa ?? "",
    type: item.type ?? "oral",
    scope: inferPresentationScope(item),
    placeEn: item.placeEn ?? null,
    placeJa: item.placeJa ?? null,
    url: item.url ?? null,
    slideUrl: item.slideUrl ?? null,
    posterUrl: item.posterUrl ?? null,
    videoUrl: item.videoUrl ?? null,
    noteEn: item.noteEn ?? null,
    noteJa: item.noteJa ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    updatedBy: "import-script",
  }));
}

async function main() {
  const publicationsSource = await readFile(
    path.join(projectRoot, "publications_data.js"),
    "utf8",
  );
  const presentationsSource = await readFile(
    path.join(projectRoot, "presentations_data.js"),
    "utf8",
  );

  const publications = normalizePublications(
    parseWindowArray(publicationsSource, "publicationsData"),
  );
  const presentations = normalizePresentations(
    parseWindowArray(presentationsSource, "presentationsData"),
  );

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputDir, "publications.seed.json"),
      JSON.stringify(publications, null, 2) + "\n",
      "utf8",
    ),
    writeFile(
      path.join(outputDir, "presentations.seed.json"),
      JSON.stringify(presentations, null, 2) + "\n",
      "utf8",
    ),
  ]);

  console.log(`Wrote ${publications.length} publications to tmp/publications.seed.json`);
  console.log(`Wrote ${presentations.length} presentations to tmp/presentations.seed.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
