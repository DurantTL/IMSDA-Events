import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveEventContext: vi.fn(),
  writeAuditLog: vi.fn(),
  db: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn(async () => ({ user: { id: "user_one" } })) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/events/selection", () => ({ resolveEventContext: mocks.resolveEventContext }));
vi.mock("@/modules/access/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/access/authorization")>();
  return { ...actual, requirePermission: mocks.requirePermission };
});

import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import { AccessDeniedError } from "@/modules/access/authorization";
import ScannerImportPage from "@/app/(workspace)/more/kitchen-report/scanner-import/page";
import { POST } from "@/app/api/events/[eventId]/meals/scanner-import/route";
import { GET as servedCsv } from "@/app/api/events/[eventId]/exports/meals-served/route";
import { confirmScannerImport, loadServedReport, previewScannerImport } from "@/modules/meals/scanner-import-repository";

const fixture = (name: string) => readFileSync(`tests/fixtures/cafe-scanner/${name}`, "utf8");

type Row = Record<string, unknown>;
function ticketRow(id: string, number: number, code: string, name: string, mealType: string, serviceDate: string | null, payer = "ATTENDEE") {
  const [firstName, ...rest] = name.split(" ");
  return {
    id, number,
    selection: {
      mealType, ageGroup: "ADULT", payer, registration: { confirmationCode: code, contactSnapshot: {} },
      attendee: { profileSnapshot: { firstName, lastName: rest.join(" ") }, person: { firstName, lastName: rest.join(" ") } },
      service: serviceDate ? { serviceDate } : null,
    },
  };
}
const ticketRows = [
  ticketRow("t1", 1, "SYN-AAA1", "Alex Example", "LUNCH", null),
  ticketRow("t2", 2, "SYN-AAA1", "Alex Example", "LUNCH", null),
  ticketRow("t3", 3, "SYN-AAA1", "Blake Sample", "SUPPER", "2026-10-15"),
  ticketRow("t4", 4, "SYN-BBB2", "=Casey Formula", "BREAKFAST", "2026-10-15", "CONFERENCE"),
  ticketRow("t5", 5, "SYN-BBB2", "Drew Ambiguous", "LUNCH", null),
  ticketRow("t6", 6, "SYN-BBB2", "Drew Ambiguous", "LUNCH", "2026-10-15", "CONFERENCE"),
  ticketRow("t7", 7, "SYN-CCC3", "Eli Quiet", "SUPPER", null),
];

let cancelledRows: Array<ReturnType<typeof ticketRow>>;
let events: Row[];
let batches: Row[];
let sequence: number;
function fakeDb() {
  const db = {
    event: { findUnique: vi.fn(async () => ({ timezone: "America/Chicago" })) },
    eventMealTicket: {
      findMany: vi.fn(async (args: { where: { number?: { in: number[] }; eventId?: unknown; id?: { in: string[] } } }) => {
        if (args.where.id) return cancelledRows.filter((row) => args.where.id!.in.includes(row.id));
        if (args.where.number) return args.where.eventId && typeof args.where.eventId === "object" ? (args.where.number.in.includes(77777) ? [{ number: 77777 }] : []) : [];
        return ticketRows;
      }),
    },
    eventMealRedemption: {
      findMany: vi.fn(async () => events.map((row) => ({ ...row, batch: { source: "SHEET" } }))),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => { for (const row of data) { sequence += 1; events.push({ ...row, id: `e${sequence}` }); } return { count: data.length }; }),
    },
    eventMealImportBatch: { create: vi.fn(async ({ data }: { data: Row }) => { batches.push(data); return { id: `b${batches.length}` }; }) },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)),
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  events = []; batches = []; sequence = 0; cancelledRows = [];
  mocks.db = fakeDb();
  mocks.requirePermission.mockResolvedValue({ user: { id: "user_one" } });
});

const confirmInput = (digest: string, text: string, extra: Partial<Parameters<typeof confirmScannerImport>[0]> = {}) => ({
  eventId: "evt", userId: "user_one", fileName: "results.csv", text, digest, acceptUnredeem: [], acknowledgeOtherSource: false, canAcceptUnredeem: true, ...extra,
});

describe("preview, then confirm", () => {
  it("saves nothing at preview and records what the preview showed at confirm", async () => {
    const text = fixture("sheet-with-redemptions.csv");
    const preview = await previewScannerImport("evt", "C:\\Users\\x\\results.csv", text);
    expect(preview).toMatchObject({ source: "SHEET", fileName: "results.csv", counts: { newRedemptions: 4, review: 2 } });
    expect(events).toHaveLength(0);
    expect(batches).toHaveLength(0);

    const result = await confirmScannerImport(confirmInput(preview.digest, text));
    expect(result).toMatchObject({ redeemed: 4, unredeemed: 0, review: 2 });
    expect(events.map((row) => row.kind)).toEqual(["REDEEMED", "REDEEMED", "REDEEMED", "REDEEMED"]);
    expect(batches[0]).toMatchObject({ eventId: "evt", uploadedByUserId: "user_one", source: "SHEET", redeemedCount: 4, reviewCount: 2 });
    expect(events[0]).toMatchObject({ batchId: "b1", eventId: "evt" });
  });

  it("audits ids and counts only, never names or codes", async () => {
    const text = fixture("sheet-with-redemptions.csv");
    const preview = await previewScannerImport("evt", "results.csv", text);
    await confirmScannerImport(confirmInput(preview.digest, text));
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "meals.scanner_import", entityId: "b1", metadata: { source: "SHEET", rows: 9, redeemed: 4, unredeemed: 0, reredeemed: 0 } });
    expect(JSON.stringify(entry)).not.toMatch(/Alex|Casey|Blake|Eli|SYN-|results\.csv/);
  });

  it("re-uploading the same file adds nothing and writes no batch", async () => {
    const text = fixture("sheet-with-redemptions.csv");
    const first = await previewScannerImport("evt", "results.csv", text);
    await confirmScannerImport(confirmInput(first.digest, text));
    const before = events.length;
    const again = await previewScannerImport("evt", "results.csv", text);
    expect(again.counts.newRedemptions).toBe(0);
    const result = await confirmScannerImport(confirmInput(again.digest, text));
    expect(result).toMatchObject({ batchId: null, redeemed: 0 });
    expect(events).toHaveLength(before);
    expect(batches).toHaveLength(1);
  });

  it("refuses a confirm whose file no longer plans what the preview showed", async () => {
    const text = fixture("sheet-with-redemptions.csv");
    const preview = await previewScannerImport("evt", "results.csv", text);
    await expect(confirmScannerImport(confirmInput(preview.digest, fixture("sheet-later-unredeem.csv")))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(confirmScannerImport(confirmInput("0".repeat(64), text))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(events).toHaveLength(0);
  });

  it("applies an un-redeem only when staff accepted that conflict", async () => {
    const first = fixture("sheet-with-redemptions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "a.csv", first)).digest, first));
    const later = fixture("sheet-later-unredeem.csv");
    const preview = await previewScannerImport("evt", "b.csv", later);
    expect(preview.conflicts).toEqual([expect.objectContaining({ ticketNumber: 1, ticketId: "MT-00001" })]);

    const ignored = await confirmScannerImport(confirmInput(preview.digest, later));
    expect(ignored).toMatchObject({ batchId: null, unredeemed: 0, conflictsIgnored: 1 });
    expect(events.filter((row) => row.kind === "UNREDEEMED")).toHaveLength(0);

    await expect(confirmScannerImport(confirmInput(preview.digest, later, { acceptUnredeem: [3] }))).rejects.toMatchObject({ code: "INVALID" });
    const accepted = await confirmScannerImport(confirmInput(preview.digest, later, { acceptUnredeem: [1] }));
    expect(accepted).toMatchObject({ unredeemed: 1 });
    expect(events.filter((row) => row.kind === "UNREDEEMED")).toHaveLength(1);
  });

  it("needs finance access to accept an un-redeem, but not to record new redemptions", async () => {
    const first = fixture("sheet-with-redemptions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "a.csv", first)).digest, first, { canAcceptUnredeem: false }));
    expect(events).toHaveLength(4);
    const later = fixture("sheet-later-unredeem.csv");
    const preview = await previewScannerImport("evt", "b.csv", later, false);
    expect(preview.canAcceptUnredeem).toBe(false);
    await expect(confirmScannerImport(confirmInput(preview.digest, later, { acceptUnredeem: [1], canAcceptUnredeem: false }))).rejects.toBeInstanceOf(AccessDeniedError);
    expect(events.filter((row) => row.kind === "UNREDEEMED")).toHaveLength(0);
    // Ignoring the conflict is allowed without finance access.
    await expect(confirmScannerImport(confirmInput(preview.digest, later, { canAcceptUnredeem: false }))).resolves.toMatchObject({ conflictsIgnored: 1 });
  });

  it("puts a ticket back as served when staff accept the later sheet, and the correction can be undone", async () => {
    const first = fixture("sheet-with-redemptions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "a.csv", first)).digest, first));
    const later = fixture("sheet-later-unredeem.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "b.csv", later)).digest, later, { acceptUnredeem: [1] }));
    expect(events.at(-1)).toMatchObject({ kind: "UNREDEEMED" });

    const preview = await previewScannerImport("evt", "c.csv", first, true);
    expect(preview.conflicts).toEqual([expect.objectContaining({ kind: "REREDEEM", ticketId: "MT-00001", servedAtLabel: "Oct 15, 2026, 12:05 PM CDT" })]);
    const result = await confirmScannerImport(confirmInput(preview.digest, first, { acceptUnredeem: [1] }));
    expect(result).toMatchObject({ redeemed: 1, reredeemed: 1, unredeemed: 0 });
    expect(events.at(-1)).toMatchObject({ kind: "REDEEMED", ticketId: "t1", redeemedByText: "Alex Example" });
    expect(String(events.at(-1)!.sourceKey)).toMatch(/^reredeem:unredeem:/);
    // The same file again: nothing left to put back.
    expect((await previewScannerImport("evt", "d.csv", first)).counts).toMatchObject({ newRedemptions: 0, conflicts: 0 });
  });

  it("stores the station, never the guest, for a transactions file", async () => {
    const text = fixture("transactions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "t.csv", text)).digest, text));
    expect(events.map((row) => row.redeemedByText)).toEqual(["Station 1", "Station 1", "Station 1", "Station 1"]);
    expect(JSON.stringify(events.map((row) => row.sourceKey))).not.toMatch(/SYN-|alex|blake|casey/i);
  });

  it("turns a unique violation into a plain conflict, without the database's message", async () => {
    const text = fixture("sheet-with-redemptions.csv");
    const preview = await previewScannerImport("evt", "a.csv", text);
    (mocks.db.eventMealRedemption as { createMany: ReturnType<typeof vi.fn> }).createMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`eventId`,`sourceKey`) DETAIL: Key (sourceKey)=(sheet:MT-00001:x) already exists.', { code: "P2002", clientVersion: "test" }),
    );
    const failure = await confirmScannerImport(confirmInput(preview.digest, text)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "CONFLICT" });
    expect(String((failure as Error).message)).not.toMatch(/sourceKey|MT-00001|DETAIL/);
  });

  it("counts a meal served on a ticket that was cancelled afterwards", async () => {
    const text = fixture("sheet-with-redemptions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "a.csv", text)).digest, text));
    // Ticket 3 (Blake, supper, pinned to the 15th) is cancelled after being served: it leaves the active list.
    const gone = ticketRows.find((row) => row.id === "t3")!;
    cancelledRows = [gone];
    const original = [...ticketRows];
    ticketRows.splice(ticketRows.indexOf(gone), 1);
    try {
      const report = await loadServedReport("evt");
      const supper = report.rows.find((row) => row.key === "2026-10-15:SUPPER")!;
      expect(supper).toMatchObject({ sold: { total: 0 }, served: { paying: 1, total: 1 }, servedOnCancelled: { total: 1 } });
      expect(report.totals.served.total).toBe(4);
    } finally {
      ticketRows.splice(0, ticketRows.length, ...original);
    }
  });

  it("makes staff acknowledge a second kind of file for the same event", async () => {
    const sheet = fixture("sheet-with-redemptions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "a.csv", sheet)).digest, sheet));
    const transactions = fixture("transactions.csv");
    const preview = await previewScannerImport("evt", "t.csv", transactions);
    expect(preview.otherSourceHasRedemptions).toBe(true);
    await expect(confirmScannerImport(confirmInput(preview.digest, transactions))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(confirmScannerImport(confirmInput(preview.digest, transactions, { acknowledgeOtherSource: true }))).resolves.toBeDefined();
  });

  it("refuses a file over the size cap", async () => {
    await expect(previewScannerImport("evt", "big.csv", "ticket_id,reg_id\r\n" + "x".repeat(2 * 1024 * 1024))).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("the pages and exports", () => {
  it("restricts the scanner import page, and the served CSV, without VIEW_REPORTS, reading nothing", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camp" }, permissions: ["VIEW_EVENT", "MANAGE_FINANCE"] });
    const html = renderToStaticMarkup(await ScannerImportPage({ searchParams: Promise.resolve({ event: "evt" }) }));
    expect(html).toContain("restricted");
    expect(html).not.toContain("Import café scanner results");
    expect((mocks.db.event as { findUnique: ReturnType<typeof vi.fn> }).findUnique).not.toHaveBeenCalled();
  });

  it("shows the page to VIEW_REPORTS", async () => {
    mocks.resolveEventContext.mockResolvedValue({ event: { id: "evt", name: "Synthetic Camp" }, permissions: ["VIEW_REPORTS"] });
    const html = renderToStaticMarkup(await ScannerImportPage({ searchParams: Promise.resolve({ event: "evt" }) }));
    expect(html).toContain("Import café scanner results");
    expect(html).toContain("Meals served against tickets sold");
  });
});

describe("the routes", () => {
  const params = { params: Promise.resolve({ eventId: "evt" }) };
  const upload = (fields: Record<string, string | Blob>, name = "results.csv") => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value instanceof Blob ? new File([value], name) : value);
    return new Request("http://localhost/api/events/evt/meals/scanner-import", { method: "POST", body, headers: { origin: "http://localhost" } });
  };

  it("asks for VIEW_REPORTS and is refused before reading the file", async () => {
    mocks.requirePermission.mockRejectedValue(new AccessDeniedError("No.", 403, "PERMISSION_DENIED"));
    const response = await POST(upload({ step: "preview", file: new Blob([fixture("sheet-with-redemptions.csv")]) }), params);
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "evt", "VIEW_REPORTS", expect.anything());
    expect((mocks.db.event as { findUnique: ReturnType<typeof vi.fn> }).findUnique).not.toHaveBeenCalled();
    expect((await servedCsv(new Request("http://localhost/x"), params)).status).toBe(403);
  });

  it("previews over HTTP, refuses a non-CSV name and an oversized file", async () => {
    const ok = await POST(upload({ step: "preview", file: new Blob([fixture("transactions.csv")]) }), params);
    expect(ok.status).toBe(200);
    expect((await ok.json()).preview).toMatchObject({ source: "TRANSACTIONS" });
    expect((await POST(upload({ step: "preview", file: new Blob(["x"]) }, "results.xlsx"), params)).status).toBe(400);
    expect((await POST(upload({ step: "preview", file: new Blob(["x".repeat(2 * 1024 * 1024 + 1)]) }), params)).status).toBe(413);
    expect((await POST(upload({ step: "confirm", file: new Blob([fixture("transactions.csv")]), digest: "nope" }), params)).status).toBe(400);
  });

  it("refuses to accept an un-redeem without MANAGE_FINANCE, before anything is saved", async () => {
    const first = fixture("sheet-with-redemptions.csv");
    await confirmScannerImport(confirmInput((await previewScannerImport("evt", "a.csv", first)).digest, first));
    const later = fixture("sheet-later-unredeem.csv");
    const digest = (await previewScannerImport("evt", "b.csv", later)).digest;
    mocks.requirePermission.mockImplementation(async (_session: unknown, _event: string, permission: string) => {
      if (permission === "MANAGE_FINANCE") throw new AccessDeniedError("No.", 403, "PERMISSION_DENIED");
      return { user: { id: "user_one" } };
    });
    const preview = await POST(upload({ step: "preview", file: new Blob([later]) }), params);
    expect((await preview.json()).preview.canAcceptUnredeem).toBe(false);
    const response = await POST(upload({ step: "confirm", file: new Blob([later]), digest, accept: "1" }), params);
    expect(response.status).toBe(403);
    expect(events.filter((row) => row.kind === "UNREDEEMED")).toHaveLength(0);
  });

  it("rejects a cross-origin upload", async () => {
    const body = new FormData();
    body.set("step", "preview");
    const response = await POST(new Request("http://localhost/x", { method: "POST", body, headers: { origin: "https://evil.example" } }), params);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });
});
