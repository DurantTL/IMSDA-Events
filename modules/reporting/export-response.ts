/**
 * The one way every CSV download is named and sent (rule B11, #1458): `<scope>-<kind>-<YYYY-MM-DD>.csv`, the same headers,
 * and a byte-order mark so Excel reads accents. Pure and free of server-only imports, so the guard and unit tests can
 * load it. Exports carry personal data, so a file name never holds a person's name or email: callers pass an event,
 * club or organization slug or id, a club year, or a fixed name, and nothing here accepts a free-text title.
 */

const MAX_PART_LENGTH = 60;

/** Lowercase `[a-z0-9-]`, repeats collapsed, trimmed, capped. A part that looks like an email is dropped (no personal data in a file name). */
export function slugifyFilePart(value: string | number | null | undefined): string {
  const text = String(value ?? "").trim();
  if (text.includes("@")) return "";
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_PART_LENGTH).replace(/-+$/g, "");
}

/** Today in America/Chicago as YYYY-MM-DD, so a download late on a Central evening is not dated tomorrow (UTC). */
export function exportDateStamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * `<scope>-<kind>-<YYYY-MM-DD>.<extension>`. `scope` is the event slug (else the event id), the club or organization
 * slug or id, the club year, or a fixed name for a template; `kind` says what the file holds. `date` is injectable for tests.
 */
export function exportFileName({ scope, kind, date, extension = "csv" }: {
  scope: string | number | null | undefined;
  kind: string;
  date?: Date;
  extension?: string;
}): string {
  const parts = [slugifyFilePart(scope) || "export", slugifyFilePart(kind) || "file", exportDateStamp(date)];
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "csv";
  return `${parts.join("-")}.${ext}`;
}

export const CSV_BYTE_ORDER_MARK = "\uFEFF";

/**
 * The CSV download response: text/csv, an attachment under `fileName`, private and not cached, and the byte-order mark
 * in front of the body (one only, even when the body already starts with it; `bom: false` sends the body as it is). `init.headers` may add or override headers.
 */
export function csvDownloadResponse(body: string, fileName: string, init: { status?: number; headers?: Record<string, string>; /** False for a file a third-party importer reads and may not accept a byte-order mark (the Sterling Volunteers upload template). */ bom?: boolean } = {}): Response {
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "-");
  return new Response(init.bom === false ? body : CSV_BYTE_ORDER_MARK + body.replace(/^\uFEFF/, ""), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...init.headers,
    },
  });
}
