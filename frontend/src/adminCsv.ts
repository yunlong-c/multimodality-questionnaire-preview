const DANGEROUS_SPREADSHEET_PREFIX =
  /^[=+\-@\u0000-\u001F\u007F-\u009F]/;

const SAFE_NEGATIVE_NUMBER_TEXT =
  /^-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Spreadsheet programs may execute strings beginning with formula prefixes
 * when a CSV is opened. A leading apostrophe keeps such values as text.
 *
 * Strict negative numeric literals are safe and remain unchanged so valid
 * negative measurements are not turned into text labels unnecessarily.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  if (
    SAFE_NEGATIVE_NUMBER_TEXT.test(value)
    || !DANGEROUS_SPREADSHEET_PREFIX.test(value)
  ) {
    return value;
  }
  return `'${value}`;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  const safeText =
    typeof value === "string"
      ? neutralizeSpreadsheetFormula(text)
      : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function csvDocument(
  headers: string[],
  rows: Record<string, unknown>[],
): string {
  const resolvedHeaders =
    headers.length > 0
      ? headers
      : Array.from(
          new Set(rows.flatMap((row) => Object.keys(row))),
        );
  const lines = [
    resolvedHeaders.map(csvCell).join(","),
    ...rows.map((row) =>
      resolvedHeaders
        .map((header) => csvCell(row[header]))
        .join(","),
    ),
  ];
  return lines.join("\r\n");
}
