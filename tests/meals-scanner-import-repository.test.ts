import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  writeAuditLog: vi.fn(),
  db: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: vi.fn(async () => ({ user: { id: "user_one" } })) }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/modules/access/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/access/authorization")>();
  return { ...actual, requirePermission: mocks.requirePermission };
});

import { AccessDeniedError } from "@/modules/access/authorization";
import { POST } from "@/app/api/events/[eventId]/meals/scanner-import/route";
import { GET as servedCsv } from "@/app/api/events/[eventId]/exports/meals-served/route";
import { confirmScannerImport, previewScannerImport } from "@/modules/meals/scanner-import-repository";

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

let events: Row[];
let batches: Row[];
let sequence: number;
function fakeDb() {
  const db = {
    event: { findUnique: vi.fn(async () => ({ timezone: "America/Chicago" })) },
    eventMealTicket: {
      findMany: vi.fn(async (args: { where: { number?: { in: number[] }; eventId?: unknown } }) => {
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
  events = []; batches = []; sequence = 0;
  mocks.db = fakeDb();
  mocks.requirePermission.mockResolvedValue({ user: { id: "user_one" } });
});

const confirmInput = (digest: string, text: string, extra: Partial<Parameters<typeof confirmScannerImport>[0]> = {}) => ({
  eventId: "evt", userId: "user_one", fileName: "results.csv", text, digest, acceptUnredeem: [], acknowledgeOtherSource: false, ...extra,
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
    expect(entry).toMatchObject({ action: "meals.scanner_import", entityId: "b1", metadata: { source: "SHEET", rows: 9, redeemed: 4 } });
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

  it("rejects a cross-origin upload", async () => {
    const body = new FormData();
    body.set("step", "preview");
    const response = await POST(new Request("http://localhost/x", { method: "POST", body, headers: { origin: "https://evil.example" } }), params);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });
});
