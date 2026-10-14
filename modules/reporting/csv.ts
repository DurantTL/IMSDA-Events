export type CsvOptions = {
  /** Quote a cell only when it holds a comma, double quote, CR or LF (RFC 4180 minimal quoting). Default: quote every cell. */
  minimalQuoting?: boolean;
};

export function csvCell(value: string | number, options: CsvOptions = {}) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (options.minimalQuoting && !/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Rows joined by CRLF, each ending in CRLF; no byte-order mark. */
export function toCsv(rows: Array<Array<string | number>>, options: CsvOptions = {}) {
  return rows.map((row) => row.map((cell) => csvCell(cell, options)).join(",")).join("\r\n") + "\r\n";
}
