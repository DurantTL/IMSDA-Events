import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formTemplates } from "@/modules/forms/definition";
import { csvDownloadResponse } from "@/modules/reporting/export-response";

const dependencies = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  findActiveMembership: vi.fn(),
  findEventArchiveFacts: vi.fn(),
  listRegistrations: vi.fn(),
  listNotesForRegistration: vi.fn(),
  writeAuditLog: vi.fn(),
  listInformationForms: vi.fn(),
  buildInformationFormResponsesCsv: vi.fn(),
  finance: {
    invoices: vi.fn(), "billing-responsibility": vi.fn(), "church-owed": vi.fn(), "scholarship-fund": vi.fn(), "attendance-reconciliation": vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<Response>>>>,
}));

vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: dependencies.getCurrentSession }));
vi.mock("@/modules/events/repository", () => ({ findActiveMembership: dependencies.findActiveMembership, findEventSlug: vi.fn(async () => "synthetic-camp") }));
vi.mock("@/modules/events/archive-download-facts", () => ({ findEventArchiveFacts: dependencies.findEventArchiveFacts }));
vi.mock("@/modules/event-locations/filter", () => ({ resolveLocationFilter: vi.fn(async () => ({ locations: [], locationId: null, selected: null })), locationParam: () => null }));
vi.mock("@/modules/registrations/repository", () => ({ listRegistrations: dependencies.listRegistrations }));
vi.mock("@/modules/notes/repository", () => ({ listNotesForRegistration: dependencies.listNotesForRegistration }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: dependencies.writeAuditLog }));
vi.mock("@/modules/information-forms/repository", () => ({ listInformationForms: dependencies.listInformationForms }));
vi.mock("@/modules/information-forms/responses", () => ({ buildInformationFormResponsesCsv: dependencies.buildInformationFormResponsesCsv }));
vi.mock("@/app/api/events/[eventId]/exports/invoices/route", () => ({ GET: (...args: unknown[]) => dependencies.finance["invoices"]!(...args) }));
vi.mock("@/app/api/events/[eventId]/exports/billing-responsibility/route", () => ({ GET: (...args: unknown[]) => dependencies.finance["billing-responsibility"]!(...args) }));
vi.mock("@/app/api/events/[eventId]/exports/church-owed/route", () => ({ GET: (...args: unknown[]) => dependencies.finance["church-owed"]!(...args) }));
vi.mock("@/app/api/events/[eventId]/exports/scholarship-fund/route", () => ({ GET: (...args: unknown[]) => dependencies.finance["scholarship-fund"]!(...args) }));
vi.mock("@/app/api/events/[eventId]/exports/attendance-reconciliation/route", () => ({ GET: (...args: unknown[]) => dependencies.finance["attendance-reconciliation"]!(...args) }));

import { GET } from "@/app/api/events/[eventId]/exports/event-archive/route";

const definition = formTemplates.find((template) => template.key === "womens_retreat_export")!.definition;
const registration = {
  id: "r1", confirmationCode: "SC-1", status: "CONFIRMED", submittedAt: "2026-10-01T12:00:00.000Z", attendeeCount: 1,
  totalAmountCents: 5000, paidCents: 5000, balanceCents: 0, location: null, tags: [], notes: [],
  accountHolder: { id: "p1", firstName: "Holder", lastName: "Synthetic", email: "holder@example.test", phone: "(515) 555-0100" },
  attendees: [{ id: "a1", firstName: "Guest", lastName: "Synthetic", email: "", phone: "", attendeeType: "Adult", responses: { meal_preference: "Vegan", dietary_needs: "peanut allergy synthetic" } }],
  publicSubmission: { definition, responses: {}, attendeeResponses: [] },
};

function sign(permissions: string[], extra: Record<string, unknown> = {}) {
  dependencies.getCurrentSession.mockResolvedValue({ user: { id: "user_one", email: "staff@example.test", displayName: "Pat Staff", globalRole: null } });
  dependencies.findActiveMembership.mockResolvedValue({ eventId: "evt", userId: "user_one", role: "READ_ONLY_STAFF", status: "ACTIVE", permissions, ...extra });
}

function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < zip.readUInt16LE(end + 10); i += 1) {
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const body = zip.subarray(start, start + compressed);
    out.set(name, (method === 8 ? inflateRawSync(body) : body).toString("utf8"));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return out;
}

async function download() {
  const response = await GET(new Request("http://localhost/api/events/evt/exports/event-archive"), { params: Promise.resolve({ eventId: "evt" }) });
  return { response, files: response.status === 200 ? readZip(Buffer.from(await response.arrayBuffer())) : null };
}

const closed = { id: "evt", name: "Synthetic Camp", lifecycleState: "CLOSED", isPublished: true, archivedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.findEventArchiveFacts.mockResolvedValue(closed);
  dependencies.listRegistrations.mockResolvedValue([registration]);
  dependencies.listNotesForRegistration.mockResolvedValue([{ body: "synthetic health note" }]);
  dependencies.listInformationForms.mockResolvedValue([{ id: "f1", purpose: null }, { id: "f2", purpose: "DEBRIEF" }]);
  dependencies.buildInformationFormResponsesCsv.mockResolvedValue({ csv: '"Submitted at"\r\n"2026-10-02"\r\n', filename: "survey-responses.csv", rowCount: 1 });
  dependencies.writeAuditLog.mockResolvedValue({});
  for (const [segment, handler] of Object.entries(dependencies.finance)) {
    handler.mockImplementation(async () => csvDownloadResponse(`"${segment}"\r\n"x"\r\n`, `${segment}.csv`));
  }
  sign(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA", "MANAGE_FINANCE", "MANAGE_FORMS"]);
});

describe("event archive download route (#175)", () => {
  it("refuses a signed-out request and a role without reports or finance before reading anything", async () => {
    dependencies.getCurrentSession.mockResolvedValue({ user: null });
    expect((await download()).response.status).toBe(401);
    sign(["VIEW_EVENT"]);
    expect((await download()).response.status).toBe(403);
    expect(dependencies.findEventArchiveFacts).not.toHaveBeenCalled();
    expect(dependencies.listRegistrations).not.toHaveBeenCalled();
    expect(dependencies.writeAuditLog).not.toHaveBeenCalled();
  });

  it("answers 409 for an event that is still open, reading no export", async () => {
    dependencies.findEventArchiveFacts.mockResolvedValue({ ...closed, lifecycleState: "PUBLISHED" });
    const { response } = await download();
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/closed or archived/);
    expect(dependencies.listRegistrations).not.toHaveBeenCalled();
    expect(dependencies.writeAuditLog).not.toHaveBeenCalled();
  });

  it("serves a zip with a contents page, the allowed files, and the right headers", async () => {
    const { response, files } = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="synthetic-camp-event-archive-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect([...files!.keys()].sort()).toEqual(["CONTENTS.txt", "attendance-reconciliation.csv", "attendees.csv", "billing-responsibility.csv", "church-owed.csv", "finalized-invoices.csv", "forms/survey-responses.csv", "registrations.csv", "scholarship-fund.csv"]);
    const contents = files!.get("CONTENTS.txt")!;
    expect(contents).toContain("Event: Synthetic Camp");
    expect(contents).toContain("Generated by: Pat Staff");
    expect(contents).not.toContain("staff@example.test");
    expect(contents).toContain("Nothing was left out.");
  });

  it("leaves staff notes, dietary detail and health columns out even for a person who holds the health permission", async () => {
    sign(["VIEW_REPORTS", "VIEW_SENSITIVE_DATA", "VIEW_HEALTH_INFORMATION", "VIEW_NOTES"]);
    const { files } = await download();
    const registrations = files!.get("registrations.csv")!;
    expect(registrations).not.toContain("Visible staff notes");
    expect(registrations).not.toContain("synthetic health note");
    expect(dependencies.listNotesForRegistration).not.toHaveBeenCalled();
    const attendees = files!.get("attendees.csv")!;
    expect(attendees).not.toContain("peanut allergy synthetic");
    expect(attendees).not.toContain("Dietary needs");
    expect(attendees).not.toContain("Meal preference");
    expect(attendees).not.toContain("Vegan");
  });

  it("gives a reports-only role the registrations and lists the finance and forms files as not included", async () => {
    sign(["VIEW_REPORTS"]);
    for (const handler of Object.values(dependencies.finance)) handler.mockResolvedValue(Response.json({ error: "PERMISSION_DENIED" }, { status: 403 }));
    const { files } = await download();
    expect([...files!.keys()].sort()).toEqual(["CONTENTS.txt", "registrations.csv"]);
    const contents = files!.get("CONTENTS.txt")!;
    for (const name of ["attendees.csv", "finalized-invoices.csv", "church-owed.csv", "scholarship-fund.csv", "forms/ (form responses)"]) {
      expect(contents).toContain(`${name}: Not included: your role can't download this export`);
    }
    expect(dependencies.buildInformationFormResponsesCsv).not.toHaveBeenCalled();
  });

  it("gives a finance-only role the finance files only", async () => {
    sign(["MANAGE_FINANCE"]);
    const { files } = await download();
    expect([...files!.keys()].sort()).toEqual(["CONTENTS.txt", "attendance-reconciliation.csv", "billing-responsibility.csv", "church-owed.csv", "finalized-invoices.csv", "scholarship-fund.csv"]);
    expect(dependencies.listRegistrations).not.toHaveBeenCalled();
    expect(files!.get("CONTENTS.txt")).toContain("registrations.csv: Not included: your role can't download this export");
  });

  it("lists an export with nothing to give as not included, and fails the whole download on any other error", async () => {
    dependencies.finance["church-owed"]!.mockResolvedValue(Response.json({}, { status: 404 }));
    const { files } = await download();
    expect(files!.get("CONTENTS.txt")).toContain("church-owed.csv: Not included: nothing to export");
    dependencies.finance["church-owed"]!.mockResolvedValue(Response.json({}, { status: 500 }));
    const failed = await download();
    expect(failed.response.status).toBe(500);
    expect(dependencies.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("tells an export that does not apply from one with nothing in it, and passes the correlation id to inner requests", async () => {
    dependencies.finance["billing-responsibility"]!.mockResolvedValue(Response.json({ error: "NOT_DEFERRED_EVENT" }, { status: 404 }));
    const { files } = await download();
    expect(files!.get("CONTENTS.txt")).toContain("billing-responsibility.csv: Not included: not used for this event");
    const inner = dependencies.finance.invoices!.mock.calls[0]![0] as Request;
    expect(inner.headers.get("x-correlation-id")).toBeTruthy();
  });

  it("answers 409 with the form's own message when a form is over the export cap", async () => {
    const { InformationFormError } = await import("@/modules/information-forms/errors");
    dependencies.buildInformationFormResponsesCsv.mockRejectedValue(new InformationFormError("EXPORT_TOO_LARGE", "This form has 99,999 responses, more than one export can hold."));
    const { response } = await download();
    expect(response.status).toBe(409);
    expect((await response.json()).message).toMatch(/99,999 responses/);
    expect(dependencies.writeAuditLog).not.toHaveBeenCalled();
  });

  it("writes one audit row with file names and a checksum and no personal data", async () => {
    await download();
    expect(dependencies.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = dependencies.writeAuditLog.mock.calls[0]![0];
    expect(entry).toMatchObject({ eventId: "evt", actorUserId: "user_one", action: "EVENT_ARCHIVE_DOWNLOADED", entityType: "Event" });
    expect(entry.metadata.files).toContain("registrations.csv");
    expect(entry.metadata.packageSha256).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(entry);
    for (const personal of ["Pat Staff", "staff@example.test", "holder@example.test", "Synthetic", "peanut"]) expect(serialized).not.toContain(personal);
  });
});

describe("registrations export rows (#175 refactor)", () => {
  it("keeps the registrations export's columns and the viewer's notes, and drops only the notes column for the archive", async () => {
    const { registrationsExportRows } = await import("@/modules/registrations/registrations-export-rows");
    const withNotes = await registrationsExportRows("evt", [registration] as never, { showLocation: false, staffNotes: new Set(["VIEW_NOTES"]) });
    expect(withNotes[0]).toEqual(["Confirmation code", "Account holder", "Email", "Status", "Submitted at (ISO 8601)", "Attendees", "Total", "Net received", "Balance", "Flags", "Visible staff notes"]);
    expect(withNotes[1]!.slice(0, 10)).toEqual(["SC-1", "Holder Synthetic", "holder@example.test", "CONFIRMED", "2026-10-01T12:00:00.000Z", 1, "50.00", "50.00", "0.00", expect.any(String)]);
    expect(withNotes[1]![10]).toBe("synthetic health note");
    expect(dependencies.listNotesForRegistration).toHaveBeenCalledWith("evt", "r1", new Set(["VIEW_NOTES"]));
    const without = await registrationsExportRows("evt", [registration] as never, { showLocation: true, staffNotes: null });
    expect(without[0]).toContain("Location");
    expect(without[0]).not.toContain("Visible staff notes");
  });
});
