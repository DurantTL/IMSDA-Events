import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const hoisted = vi.hoisted(() => ({ getPrisma: vi.fn(), render: vi.fn(), audit: vi.fn() }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: hoisted.audit }));
vi.mock("@/lib/prisma", () => ({ getPrisma: hoisted.getPrisma }));
vi.mock("@/modules/registration-pdf/render", async () => {
  const actual = await vi.importActual<typeof import("@/modules/registration-pdf/render")>("@/modules/registration-pdf/render");
  hoisted.render.mockImplementation(actual.renderRegistrationPdf);
  return { renderRegistrationPdf: hoisted.render };
});

import {
  RegistrationPdfError,
  ensureRegistrationPdf,
  loadRegistrationPdfSource,
  readClubRegistrationPdfForDownload,
  readRegistrationPdfForDownload,
} from "@/modules/registration-pdf/repository";
import { selfPayDefinition } from "./support/registration-pdf-fixture";

/** Making, versioning, storing and reading back the registration PDF (#1082). Synthetic data only. */

const staff = { userId: "staff-1" };

type Stored = { id: string; version: number; attachmentId: string; sha256: string; contentHash: string; updated: boolean; createdAt: Date; filename: string; sizeBytes: number; content: Buffer; eventId: string; registrationId: string };

function fixture(options: { billingMode?: "ATTENDEE_PAY" | "DEFERRED_ORGANIZATION_INVOICE"; withSubmission?: boolean; badDefinition?: boolean } = {}) {
  const documents: Stored[] = [];
  const state = {
    responses: { email: "pat@example.test", payment_method: "Card", promo_code: "SYNTHETIC10" } as Record<string, unknown>,
    attendees: [
      { profileSnapshot: { firstName: "Avery", lastName: "Example", ageOnEventDate: 12, birthDate: "2015-04-01" }, formResponses: { first_name: "Avery", last_name: "Example", attendee_age: 12, birth_date: "2015-04-01", allergies: "Synthetic peanut", class_choice: "Knots" }, person: { firstName: "Avery", lastName: "Example" } },
    ],
    payments: [] as Array<{ amount: string; refunds: Array<{ amount: string }> }>,
  };
  const registrationFindFirst = vi.fn(async () => (options.withSubmission === false
    ? { id: "registration-1", publicFormSubmission: null }
    : {
      id: "registration-1",
      eventId: "event-1",
      totalAmount: "40.00",
      submittedAt: new Date("2027-09-01T15:00:00.000Z"),
      contactSnapshot: { firstName: "Pat", lastName: "Example" },
      accountHolderPerson: { firstName: "Pat", lastName: "Example" },
      event: { name: "Synthetic Honors Weekend", startsAt: new Date("2027-10-08T21:00:00.000Z"), endsAt: new Date("2027-10-10T17:00:00.000Z"), timezone: "America/Chicago", location: "Example Academy", billingMode: options.billingMode ?? "ATTENDEE_PAY" },
      location: null,
      publicFormSubmission: {
        formVersionId: "form-version-1",
        responses: state.responses,
        pricingSnapshot: { lineItems: [{ key: "fee.0", label: "Honors Weekend fee", amountCents: 4000, attendeeIndex: 0, attendeeLabel: "Avery Example" }], totalCents: 4000, rosterEnabled: true },
        formVersion: { definition: options.badDefinition ? { title: 1 } : selfPayDefinition() },
      },
      operations: [],
      attendees: state.attendees,
      payments: state.payments,
      clubRegistration: null,
      groupRegistration: null,
    }));
  const client = {
    registration: { findFirst: registrationFindFirst },
    registrationPdfDocument: {
      findFirst: vi.fn(async () => {
        const latest = [...documents].sort((a, b) => b.version - a.version)[0];
        return latest ? { ...latest, attachment: { filename: latest.filename, sizeBytes: latest.sizeBytes } } : null;
      }),
      create: vi.fn(async ({ data }: { data: { version: number; sha256: string; contentHash: string; updated: boolean; attachment: { create: { filename: string; sizeBytes: number; content: Buffer } }; event: unknown; registration: unknown } }) => {
        const row: Stored = {
          id: `doc-${data.version}`, version: data.version, attachmentId: `attachment-${data.version}`, sha256: data.sha256, contentHash: data.contentHash, updated: data.updated,
          createdAt: new Date("2027-09-01T15:00:00.000Z"), filename: data.attachment.create.filename, sizeBytes: data.attachment.create.sizeBytes, content: data.attachment.create.content, eventId: "event-1", registrationId: "registration-1",
        };
        documents.push(row);
        return { ...row, attachment: { filename: row.filename, sizeBytes: row.sizeBytes } };
      }),
    },
    messageAttachment: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = documents.find((document) => document.attachmentId === where.id)!;
        return { content: row.content, sha256: row.sha256, filename: row.filename, contentType: "application/pdf" };
      }),
    },
    clubEventRegistration: { findUnique: vi.fn() },
  };
  return { client, state, documents, registrationFindFirst };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registration PDF storage and versions (#1082)", () => {
  it("makes version 1 once, stores it as a hashed attachment, and reuses it while nothing visible changes", async () => {
    const { client, documents } = fixture();
    const first = await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1", now: new Date("2027-09-01T15:00:00.000Z") });
    expect(first).toMatchObject({ created: true, document: { version: 1, updated: false, filename: "Registration-Synthetic-Honors-Weekend-Pat-Example.pdf" } });
    expect(Buffer.from(documents[0]!.content).subarray(0, 5).toString()).toBe("%PDF-");
    expect(documents[0]!.sha256).toBe(createHash("sha256").update(documents[0]!.content).digest("hex"));
    expect(documents[0]!.sizeBytes).toBe(documents[0]!.content.byteLength);

    const again = await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" });
    expect(again).toMatchObject({ created: false, document: { version: 1 } });
    expect(documents).toHaveLength(1);
    expect(client.registrationPdfDocument.create).toHaveBeenCalledTimes(1);
  });

  it("adds an Updated version when an answer or the roster changes, and none when only a payment posts", async () => {
    const { client, state, documents } = fixture();
    await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" });

    state.payments.push({ amount: "40.00", refunds: [] });
    expect((await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" }))?.created).toBe(false);

    state.attendees.push({ profileSnapshot: { firstName: "Blake", lastName: "Sample", ageOnEventDate: 15 }, formResponses: { first_name: "Blake", last_name: "Sample", attendee_age: 15, class_choice: "Birds" }, person: { firstName: "Blake", lastName: "Sample" } } as never);
    const second = await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1", now: new Date("2027-09-05T15:00:00.000Z"), notifiedChange: { meaningful: true } });
    expect(second).toMatchObject({ created: true, document: { version: 2, updated: true, filename: "Registration-Synthetic-Honors-Weekend-Pat-Example-UPDATED.pdf" } });
    expect(documents.map((document) => document.version)).toEqual([1, 2]);
    // Version 1 is untouched: its bytes are what was sent.
    expect(documents[0]!.updated).toBe(false);
    expect(documents[0]!.sha256).not.toBe(documents[1]!.sha256);
  });

  it("an amendment's new answers win over the stored ones, and the first copy of an older registration is marked Updated", async () => {
    const { client, documents } = fixture();
    const result = await ensureRegistrationPdf(client as never, {
      eventId: "event-1",
      registrationId: "registration-1",
      notifiedChange: { meaningful: true },
      overrides: { registrationResponses: { email: "new-contact@example.test" } },
    });
    expect(result).toMatchObject({ created: true, document: { version: 1, updated: true } });
    expect(documents[0]!.filename).toContain("-UPDATED");
    const loaded = await loadRegistrationPdfSource(client as never, "event-1", "registration-1", { registrationResponses: { email: "new-contact@example.test" } });
    expect(loaded?.source.registrationResponses).toEqual({ email: "new-contact@example.test" });
  });

  it("a version made at download time (no announced change) is never marked Updated, and a card fee alone adds no version", async () => {
    const { client, state, documents } = fixture();
    await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" });
    state.responses.email = "changed@example.test";
    const second = await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" });
    expect(second).toMatchObject({ created: true, previousVersion: 1, document: { version: 2, updated: false } });
    expect(documents[1]!.filename).not.toContain("UPDATED");
  });

  it("a first copy of an older registration is marked Updated only when the change was meaningful", async () => {
    const quiet = fixture();
    expect(await ensureRegistrationPdf(quiet.client as never, { eventId: "event-1", registrationId: "registration-1", notifiedChange: { meaningful: false } })).toMatchObject({ previousVersion: null, document: { updated: false } });
    const loud = fixture();
    expect(await ensureRegistrationPdf(loud.client as never, { eventId: "event-1", registrationId: "registration-1", notifiedChange: { meaningful: true } })).toMatchObject({ previousVersion: null, document: { updated: true } });
  });

  it("makes no PDF, and does not throw, when the stored form definition no longer parses", async () => {
    const { client, documents } = fixture({ badDefinition: true });
    expect(await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" })).toBeNull();
    expect(documents).toHaveLength(0);
  });

  it("makes no PDF for a registration with no form to lay out", async () => {
    const { client, documents } = fixture({ withSubmission: false });
    expect(await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" })).toBeNull();
    expect(documents).toHaveLength(0);
  });

  it("does not store a PDF over the email size cap", async () => {
    const { client, documents } = fixture();
    hoisted.render.mockResolvedValueOnce(new Uint8Array(10 * 1024 * 1024 + 1));
    expect(await ensureRegistrationPdf(client as never, { eventId: "event-1", registrationId: "registration-1" })).toBeNull();
    expect(documents).toHaveLength(0);
  });

  it("reads nothing that could hold a birth date, and shows a church-billed registration the per-person price only", async () => {
    const { client, registrationFindFirst } = fixture({ billingMode: "DEFERRED_ORGANIZATION_INVOICE" });
    const loaded = await loadRegistrationPdfSource(client as never, "event-1", "registration-1");
    const select = JSON.stringify((registrationFindFirst.mock.calls[0] as unknown as [{ select: unknown }])[0].select);
    expect(select).not.toMatch(/birth/i);
    expect(select).not.toContain("confirmationCode");
    expect(loaded?.source.attendees[0]).toMatchObject({ name: "Avery Example", ageOnEventDate: 12 });
    expect(loaded?.source.fees).toEqual({ kind: "CHURCH_BILLED", lines: ["$40 per person. Your church is billed after the event."] });
  });

  it("lists the fees so they add up to the total, with what was paid when the copy was made", async () => {
    const { client, state } = fixture();
    state.payments.push({ amount: "15.00", refunds: [{ amount: "5.00" }] });
    const loaded = await loadRegistrationPdfSource(client as never, "event-1", "registration-1");
    expect(loaded?.source.fees).toEqual({ kind: "AMOUNTS", lines: [{ label: "Honors Weekend fee (Avery Example)", amountCents: 4000 }], totalCents: 4000, paidCents: 1000, owedCents: 3000, processingFeeCents: 0 });
  });
});

describe("registration PDF download (#1082)", () => {
  it("serves the stored bytes after checking the recorded hash", async () => {
    const { client, documents } = fixture();
    hoisted.getPrisma.mockReturnValue(client);
    const pdf = await readRegistrationPdfForDownload("event-1", "registration-1", staff);
    expect(pdf.version).toBe(1);
    expect(Buffer.from(pdf.bytes).equals(documents[0]!.content)).toBe(true);
    expect(pdf.contentType).toBe("application/pdf");
  });

  it("audits each download with ids only: who, which registration, which version", async () => {
    const { client } = fixture();
    hoisted.getPrisma.mockReturnValue(client);
    await readRegistrationPdfForDownload("event-1", "registration-1", staff);
    expect(hoisted.audit).toHaveBeenCalledWith({
      eventId: "event-1",
      actorUserId: "staff-1",
      action: "REGISTRATION_PDF_DOWNLOADED",
      entityType: "Registration",
      entityId: "registration-1",
      summary: "Downloaded version 1 of a registration PDF.",
      metadata: { registrationId: "registration-1", version: 1 },
    });
  });

  it("refuses a stored file whose hash no longer matches", async () => {
    const { client, documents } = fixture();
    hoisted.getPrisma.mockReturnValue(client);
    await readRegistrationPdfForDownload("event-1", "registration-1", staff);
    documents[0]!.content = Buffer.from("not the file that was recorded");
    await expect(readRegistrationPdfForDownload("event-1", "registration-1", staff)).rejects.toMatchObject({ code: "DOCUMENT_CORRUPT" });
  });

  it("says plainly when a registration has no PDF", async () => {
    const { client } = fixture({ withSubmission: false });
    hoisted.getPrisma.mockReturnValue(client);
    await expect(readRegistrationPdfForDownload("event-1", "registration-1", staff)).rejects.toBeInstanceOf(RegistrationPdfError);
  });

  it("gives a director only the club's own registration for the event", async () => {
    const { client } = fixture();
    hoisted.getPrisma.mockReturnValue(client);
    client.clubEventRegistration.findUnique.mockResolvedValueOnce(null);
    await expect(readClubRegistrationPdfForDownload({ organizationId: "club-2", eventId: "event-1", actor: { accountId: "account-1" } })).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(client.clubEventRegistration.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId_organizationId_teamKey: { eventId: "event-1", organizationId: "club-2", teamKey: "" } } }));

    // A cancelled registration has no director download, matching the page that offers it.
    client.clubEventRegistration.findUnique.mockResolvedValueOnce({ registrationId: "registration-1", registration: { status: "CANCELLED" } });
    await expect(readClubRegistrationPdfForDownload({ organizationId: "club-1", eventId: "event-1", actor: { accountId: "account-1" } })).rejects.toMatchObject({ code: "NOT_AVAILABLE" });

    client.clubEventRegistration.findUnique.mockResolvedValueOnce({ registrationId: "registration-1", registration: { status: "CONFIRMED" } });
    const pdf = await readClubRegistrationPdfForDownload({ organizationId: "club-1", eventId: "event-1", teamKey: null, actor: { accountId: "account-1" } });
    expect(pdf.filename).toMatch(/\.pdf$/);
    expect(hoisted.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "REGISTRATION_PDF_DOWNLOADED", entityId: "registration-1", metadata: { registrationId: "registration-1", version: 1, actorAttendeeAccountId: "account-1" } }));
  });
});
