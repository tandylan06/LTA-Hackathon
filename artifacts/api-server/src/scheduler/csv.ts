import type { CsvRow, InstanceData } from "./types";

const REQUIRED_TABLES = [
  "01_LINES.csv",
  "02_STATIONS.csv",
  "03_SECTORS.csv",
  "04_LOCATION_SUPPLY.csv",
  "05_BUFFER_LOCATION.csv",
  "06_PARAMETERS.csv",
  "07_PROJECT_DETAILS.csv",
  "08_ACTIVITY_DETAILS.csv",
];

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function splitBundledSnapshot(text: string): Record<string, string> {
  const matches = [...text.matchAll(/(?:^|\n)(\d{2}_[A-Z_]+\.csv)\s*\n/g)];
  if (matches.length < 2) return {};
  return Object.fromEntries(
    matches.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? text.length;
      return [match[1], text.slice(start, end).trim()];
    }),
  );
}

function findFile(files: Record<string, string>, filename: string): string {
  const direct = files[filename];
  if (direct) return direct;
  const key = Object.keys(files).find((name) => name.toLowerCase().endsWith(filename.toLowerCase()));
  return key ? files[key] : "";
}

export function loadInstance(files: Record<string, string>): InstanceData {
  const bundled = Object.values(files).find((content) => /01_LINES\.csv/.test(content) && /08_ACTIVITY_DETAILS\.csv/.test(content));
  const normalized = bundled ? splitBundledSnapshot(bundled) : files;
  const missing = REQUIRED_TABLES.filter((name) => !findFile(normalized, name));
  if (missing.length > 0) throw new Error(`Missing required CSV file(s): ${missing.join(", ")}`);

  const params = parseCsv(findFile(normalized, "06_PARAMETERS.csv"));
  const paramMap = Object.fromEntries(params.map((row) => [row.key, row.value]));
  return {
    source: bundled ? "bundled snapshot" : "uploaded CSV files",
    horizonStart: paramMap.horizon_start || "2027-01-04",
    horizonWeeks: Number(paramMap.horizon_weeks || 30),
    lines: parseCsv(findFile(normalized, "01_LINES.csv")),
    stations: parseCsv(findFile(normalized, "02_STATIONS.csv")),
    sectors: parseCsv(findFile(normalized, "03_SECTORS.csv")),
    locations: parseCsv(findFile(normalized, "04_LOCATION_SUPPLY.csv")),
    buffers: parseCsv(findFile(normalized, "05_BUFFER_LOCATION.csv")),
    projectDetails: parseCsv(findFile(normalized, "07_PROJECT_DETAILS.csv")),
    activities: parseCsv(findFile(normalized, "08_ACTIVITY_DETAILS.csv")),
  };
}

export function numberValue(row: CsvRow, key: string, fallback = 0): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
}