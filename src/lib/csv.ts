import Papa from "papaparse";

/**
 * CSV import/export with CSV-injection protection.
 *
 * Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as formulas. Exported
 * values that begin with one of those characters are prefixed with a single quote so they
 * are displayed as text. Phone numbers in E.164 start with "+", so they are exported with the
 * same protection (Excel still shows them as text).
 */
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  return DANGEROUS_PREFIX.test(str) ? `'${str}` : str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const data = rows.map((row) => row.map(sanitizeCsvCell));
  // BOM so Excel opens UTF-8 (Bangla) correctly.
  return "﻿" + Papa.unparse({ fields: headers, data }, { quotes: true, newline: "\r\n" });
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

export const CSV_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const CSV_MAX_ROWS = 100_000;

/** Parses CSV text with a header row. Header names are trimmed and lower-cased. */
export function parseCsv(text: string, maxRows = CSV_MAX_ROWS): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
    preview: maxRows,
  });
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
    errors: result.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`),
  };
}

/** Removes the protective quote added on export, so round-tripping a file is lossless. */
export function unescapeCsvCell(value: string): string {
  return value.startsWith("'") && DANGEROUS_PREFIX.test(value.slice(1)) ? value.slice(1) : value;
}
