import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionsMenu } from "@/components/actions-menu";
import { ExportLink, downloadErrorMessage, fileNameFromDisposition } from "@/components/export-link";
import { csvDownloadResponse, exportFileName, slugifyFilePart } from "@/modules/reporting/export-response";

describe("exportFileName (#1458)", () => {
  it("is scope, kind and the Central date, slugged to [a-z0-9-]", () => {
    const date = new Date("2026-11-01T18:00:00Z");
    expect(exportFileName({ scope: "evt_WR26", kind: "Attendees", date })).toBe("evt-wr26-attendees-2026-11-01.csv");
    expect(exportFileName({ scope: "  Spring  Camporee!! ", kind: "meal tickets", date, extension: "XLSX" })).toBe("spring-camporee-meal-tickets-2026-11-01.xlsx");
    expect(exportFileName({ scope: "../../etc", kind: "x/y", date })).toBe("etc-x-y-2026-11-01.csv");
    expect(exportFileName({ scope: "2026-27", kind: "honors", date })).toBe("2026-27-honors-2026-11-01.csv");
  });

  it("dates the file in Central time near midnight UTC", () => {
    // 03:30 UTC on Nov 2 is still the evening of Nov 1 in Chicago (CST, UTC-6).
    expect(exportFileName({ scope: "a", kind: "b", date: new Date("2026-11-02T03:30:00Z") })).toBe("a-b-2026-11-01.csv");
    // 06:30 UTC on Nov 2 is after midnight in Chicago.
    expect(exportFileName({ scope: "a", kind: "b", date: new Date("2026-11-02T06:30:00Z") })).toBe("a-b-2026-11-02.csv");
    // In summer (CDT, UTC-5): 04:30 UTC on Jul 2 is Jul 1 at 23:30.
    expect(exportFileName({ scope: "a", kind: "b", date: new Date("2026-07-02T04:30:00Z") })).toBe("a-b-2026-07-01.csv");
  });

  it("collapses repeats, caps the length and never keeps an email", () => {
    expect(slugifyFilePart("a___b---c   d")).toBe("a-b-c-d");
    expect(slugifyFilePart("x".repeat(200))).toHaveLength(60);
    expect(slugifyFilePart("avery.synthetic@example.org")).toBe("");
    expect(exportFileName({ scope: "avery.synthetic@example.org", kind: "forms", date: new Date("2026-11-01T18:00:00Z") })).toBe("export-forms-2026-11-01.csv");
    expect(exportFileName({ scope: "", kind: "", date: new Date("2026-11-01T18:00:00Z") })).toBe("export-file-2026-11-01.csv");
  });
});

describe("csvDownloadResponse (#1458)", () => {
  it("sends text/csv as an attachment, not cached, with one byte-order mark", async () => {
    const response = csvDownloadResponse('"a","b"\r\n', "evt-attendees-2026-11-01.csv");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="evt-attendees-2026-11-01.csv"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('"a","b"\r\n');
  });

  it("can leave the mark off for a file a third-party importer reads", async () => {
    const response = csvDownloadResponse('"a"\r\n', "x.csv", { bom: false });
    expect(new Uint8Array(await response.arrayBuffer())[0]).toBe(0x22);
  });

  it("does not double the mark and keeps the file name safe", async () => {
    const response = csvDownloadResponse("﻿x", 'a"b\r\nc.csv');
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="a-b--c.csv"');
    expect((await response.text()).replace(/^﻿/, "")).toBe("x");
    expect((await csvDownloadResponse("﻿x", "a.csv").text()).startsWith("﻿﻿")).toBe(false);
  });
});

describe("ExportLink (#1458)", () => {
  it("is a plain download link without script, labelled Download CSV by default", () => {
    const html = renderToStaticMarkup(createElement(ExportLink, { href: "/api/events/e1/exports/attendees", className: "secondary-button" }));
    expect(html).toContain('<a class="secondary-button" download="" href="/api/events/e1/exports/attendees">Download CSV</a>');
    expect(html).toContain('aria-live="polite"');
    expect(renderToStaticMarkup(createElement(ExportLink, { href: "/x" }, "Download CSV (all columns)"))).toContain(">Download CSV (all columns)</a>");
  });

  it("turns a refused download into plain words, never raw JSON", async () => {
    const refuse = (status: number, body: unknown) => downloadErrorMessage(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    expect(await refuse(409, { error: "NO_PROPERTY", message: "This event has no lodging set up." })).toBe("This event has no lodging set up.");
    expect(await refuse(403, { error: "PERMISSION_DENIED" })).toBe("You don't have access to download this file.");
    expect(await refuse(500, "<html>boom</html>")).toBe("The download didn't work. Try again.");
    expect(await refuse(404, { message: "   " })).toBe("That file isn't available.");
  });

  it("shows a menu item's status outside the closed menu", () => {
    const html = renderToStaticMarkup(createElement(ActionsMenu, null, createElement("li", null, createElement(ExportLink, { href: "/api/x" }))));
    // Inside a menu the link renders no status of its own; the menu has one status element beside its button.
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.indexOf("</details>")).toBeLessThan(html.indexOf('role="status"'));
  });

  it("saves the file under the server's name", () => {
    expect(fileNameFromDisposition('attachment; filename="evt-attendees-2026-11-01.csv"')).toBe("evt-attendees-2026-11-01.csv");
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});

const root = path.resolve(__dirname, "..");
function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full, ext));
    else if (ext.test(full)) out.push(full);
  }
  return out;
}
const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");

/** Server files that send a CSV and are not on the shared helper, with the reason. */
const csvResponseAllowlist: Record<string, string> = {};
/** .tsx files that link to a CSV export endpoint without ExportLink, with the reason. */
const exportLinkAllowlist: Record<string, string> = {};

describe("every CSV download is named and sent the same way, rule B11 (#1458)", () => {
  const server = [...files(path.join(root, "app"), /\.ts$/), ...files(path.join(root, "modules"), /\.ts$/)].filter((file) => !file.endsWith("export-response.ts"));

  it("every CSV response goes through csvDownloadResponse and every route names it with exportFileName", () => {
    const bad: string[] = [];
    for (const file of server) {
      const source = read(file);
      if (!/text\/csv/.test(source) && !/filename="[^"]*\.csv"/.test(source)) continue;
      if (rel(file) in csvResponseAllowlist) continue;
      bad.push(rel(file));
    }
    expect(bad).toEqual([]);
  });

  it("no route builds a Content-Disposition for a CSV by hand", () => {
    const handBuilt = server.filter((file) => /Content-Disposition/.test(read(file)) && !/\.(ics|pdf|png|svg)\b/.test(read(file)) && !(rel(file) in csvResponseAllowlist)).map(rel);
    expect(handBuilt.filter((file) => !/qr|pdf|\.ics|assets|asset-/.test(file))).toEqual([]);
  });

  it("every CSV route file calls exportFileName", () => {
    const routes = files(path.join(root, "app"), /route\.ts$/).filter((file) => /csvDownloadResponse/.test(read(file)));
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((file) => !/exportFileName\(/.test(read(file))).map(rel)).toEqual([]);
  });

  const tsx = [...files(path.join(root, "app"), /\.tsx$/), ...files(path.join(root, "components"), /\.tsx$/)];

  it("no screen says Export CSV", () => {
    expect(tsx.filter((file) => /Export CSV/i.test(read(file))).map(rel)).toEqual([]);
  });

  it("every link to an API endpoint that sends a file goes through ExportLink", () => {
    // Any <a> or <Link> whose href, or the value its href variable or function is built from in the same file, is an /api/ address.
    // PDFs, QR codes, calendars and uploaded files are not CSV downloads.
    const notCsv = /pdf|\/qr\b|\.ics|\/image|\/asset|message-file|\/files?\/|logout|callback|oauth|attachment/i;
    const bad = tsx.filter((file) => !file.endsWith("export-link.tsx") && !(rel(file) in exportLinkAllowlist)).filter((file) => {
      const source = read(file);
      const anchors = source.match(/<(a|Link)\b[^>]*>/g) ?? [];
      return anchors.some((tag) => {
        const href = /href=(\{[^]*\}|"[^"]*")/.exec(tag)?.[1] ?? "";
        if (href.includes("/api/")) return !notCsv.test(href);
        // href={someName} or href={someName(...)}: read how the name is built in this file.
        const name = /^\{\s*`?\$?\{?\s*([A-Za-z_$][\w$]*)/.exec(href)?.[1];
        if (!name) return false;
        const definition = new RegExp(`(?:const|let|function)\\s+${name.replace("$", "\\$")}\\b[^;]*?(?:;|\\n\\}|\\n  \\})`, "s").exec(source)?.[0] ?? "";
        return definition.includes("/api/") && !notCsv.test(definition);
      });
    }).map(rel);
    expect(bad).toEqual([]);
  });
});
