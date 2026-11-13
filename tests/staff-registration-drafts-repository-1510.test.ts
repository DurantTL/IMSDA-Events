import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftDefinition } from "./support/staff-draft-definition";

const mocks = vi.hoisted(() => ({
  checkPublicRegistration: vi.fn(),
  processAccountEmailQueue: vi.fn(),
  draftCreate: vi.fn(),
  draftUpdate: vi.fn(),
  draftFindFirst: vi.fn(),
  draftFindUnique: vi.fn(),
  draftFindMany: vi.fn(),
  formFindFirst: vi.fn(),
  formFindMany: vi.fn(),
  eventFindUniqueOrThrow: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
  outboxCreate: vi.fn(),
  outboxUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  queryRaw: vi.fn(),
}));

// No payment, attempt or registration model exists on this client: a draft action that reached for one would throw.
const client = {
  staffRegistrationDraft: { create: mocks.draftCreate, update: mocks.draftUpdate, findFirst: mocks.draftFindFirst, findUnique: mocks.draftFindUnique, findMany: mocks.draftFindMany },
  registrationForm: { findFirst: mocks.formFindFirst, findMany: mocks.formFindMany },
  event: { findUniqueOrThrow: mocks.eventFindUniqueOrThrow },
  user: { findUniqueOrThrow: mocks.userFindUniqueOrThrow },
  messageOutbox: { create: mocks.outboxCreate, updateMany: mocks.outboxUpdateMany },
  auditLog: { create: mocks.auditCreate },
  $queryRaw: mocks.queryRaw,
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: mocks.processAccountEmailQueue }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: class extends Error {},
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));
vi.mock("@/modules/forms/public-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/forms/public-repository")>()),
  checkPublicRegistration: mocks.checkPublicRegistration,
}));

import { hashOpaqueToken } from "@/modules/access/tokens";
import { PublicRegistrationError } from "@/modules/forms/public-repository";
import {
  checkStaffDraft,
  createStaffDraft,
  discardStaffDraft,
  handOffStaffDraft,
  resolveStaffDraftLink,
  updateStaffDraft,
} from "@/modules/staff-registration-drafts/repository";
import { STAFF_DRAFT_LINK_SENTINEL, prepareStaffDraftLinkBodyForDelivery, retireStaffDraftLinkForMessage } from "@/modules/staff-registration-drafts/link-email";


const now = new Date("2026-11-13T15:00:00Z");
const definition = draftDefinition;
const event = { id: "event-1", slug: "camp", name: "Synthetic Camp", audience: "GENERAL", isPublished: true, archivedAt: null, attendeeTypes: [] };

function publishedForm(overrides: { audience?: string; versionId?: string | null } = {}) {
  return {
    id: "form-1",
    name: "Camp form",
    slug: "camp-form",
    event: { ...event, audience: overrides.audience ?? "GENERAL" },
    versions: overrides.versionId === null ? [] : [{ id: overrides.versionId ?? "v1", definition }],
  };
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    eventId: "event-1",
    formId: "form-1",
    formVersionId: "v1",
    source: "PHONE",
    status: "OPEN",
    responses: { first_name: "Avery", last_name: "Example", email: "avery@example.test" },
    handOffExpiresAt: null,
    handedOffAt: null,
    handOffMessageId: null,
    registrationId: null,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: { displayName: "Staff One" },
    updatedBy: { displayName: "Staff One" },
    handedOffBy: null,
    form: { name: "Camp form", slug: "camp-form" },
    formVersion: { definition },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.formFindFirst.mockResolvedValue(publishedForm());
  mocks.draftCreate.mockResolvedValue({ id: "draft-1" });
  mocks.draftFindFirst.mockResolvedValue(draftRow());
  mocks.eventFindUniqueOrThrow.mockResolvedValue({ isPublished: true, archivedAt: null, timezone: "America/Chicago", registrationOpensOn: null, registrationClosesOn: null, waitlistEnabled: false, lifecycleState: null, startsAt: new Date("2026-12-01T15:00:00Z"), endsAt: new Date("2026-12-03T15:00:00Z") });
  mocks.userFindUniqueOrThrow.mockResolvedValue({ displayName: "Pat Staffer" });
  mocks.outboxCreate.mockResolvedValue({ id: "message-1" });
  mocks.processAccountEmailQueue.mockResolvedValue({});
});

describe("starting and saving a staff draft (#1510)", () => {
  it("stores the source, event, form, pinned version and acting staff member", async () => {
    await createStaffDraft("event-1", "staff-1", { formId: "form-1", source: "PAPER", responses: { first_name: "Avery" } });
    expect(mocks.draftCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventId: "event-1", formId: "form-1", formVersionId: "v1", source: "PAPER", createdByUserId: "staff-1", updatedByUserId: "staff-1" }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "STAFF_REGISTRATION_DRAFT_CREATED", actorUserId: "staff-1", metadata: expect.objectContaining({ paymentCollected: false }) }) });
  });

  it("strips sensitive, excluded and unknown answers on create and on every save", async () => {
    const dirty = { first_name: "Avery", allergies: "synthetic", notes: "synthetic", waiver: true, birth_date: "2010-01-01", home: { street: "1 Test Way" }, made_up: "x" };
    await createStaffDraft("event-1", "staff-1", { formId: "form-1", source: "WALK_IN", responses: dirty });
    expect(mocks.draftCreate.mock.calls[0]![0].data.responses).toEqual({ first_name: "Avery" });

    mocks.queryRaw.mockResolvedValue([{ id: "draft-1" }]);
    await updateStaffDraft("event-1", "draft-1", "staff-2", { responses: dirty });
    expect(mocks.draftUpdate.mock.calls[0]![0].data.responses).toEqual({ first_name: "Avery" });
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain("Avery");
  });

  it("refuses a club event and a form with no published version", async () => {
    mocks.formFindFirst.mockResolvedValue(publishedForm({ audience: "CLUB" }));
    await expect(createStaffDraft("event-1", "staff-1", { formId: "form-1", source: "PHONE" })).rejects.toMatchObject({ code: "CLUB_EVENT" });
    mocks.formFindFirst.mockResolvedValue(publishedForm({ versionId: null }));
    await expect(createStaffDraft("event-1", "staff-1", { formId: "form-1", source: "PHONE" })).rejects.toMatchObject({ code: "FORM_NOT_AVAILABLE" });
    expect(mocks.draftCreate).not.toHaveBeenCalled();
  });

  it("editing a draft that was sent withdraws the link and cancels an unsent email", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "HANDED_OFF", handOffMessageId: "message-0" }));
    mocks.queryRaw.mockResolvedValue([{ id: "draft-1" }]);
    const result = await updateStaffDraft("event-1", "draft-1", "staff-2", { responses: { first_name: "Avery" } });
    expect(result.linkRevoked).toBe(true);
    expect(mocks.draftUpdate).toHaveBeenCalledWith({ where: { id: "draft-1" }, data: expect.objectContaining({ status: "OPEN", handOffTokenHash: null, handOffExpiresAt: null, handOffMessageId: null }) });
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith({ where: { id: "message-0", status: "PENDING" }, data: { status: "CANCELLED" } });
  });

  it("a save that changes nothing keeps the registrant's link", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "HANDED_OFF", handOffMessageId: "message-0" }));
    mocks.queryRaw.mockResolvedValue([{ id: "draft-1" }]);
    const result = await updateStaffDraft("event-1", "draft-1", "staff-2", {
      source: "PHONE",
      responses: { email: "avery@example.test", last_name: "Example", first_name: "Avery", allergies: "dropped on save" },
    });
    expect(result).toMatchObject({ linkRevoked: false, changed: false });
    expect(mocks.draftUpdate).not.toHaveBeenCalled();
    expect(mocks.outboxUpdateMany).not.toHaveBeenCalled();
  });

  it("changing the source alone is a change", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "HANDED_OFF", handOffMessageId: "message-0" }));
    mocks.queryRaw.mockResolvedValue([{ id: "draft-1" }]);
    const result = await updateStaffDraft("event-1", "draft-1", "staff-2", { source: "PAPER", responses: { first_name: "Avery", last_name: "Example", email: "avery@example.test" } });
    expect(result.linkRevoked).toBe(true);
  });

  it("a form not on this event is not found", async () => {
    mocks.formFindFirst.mockResolvedValue(null);
    await expect(createStaffDraft("event-1", "staff-1", { formId: "other", source: "PHONE" })).rejects.toMatchObject({ code: "FORM_NOT_FOUND" });
  });

  it("will not edit a submitted draft", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "SUBMITTED" }));
    await expect(updateStaffDraft("event-1", "draft-1", "staff-1", { responses: {} })).rejects.toMatchObject({ code: "DRAFT_NOT_EDITABLE" });
  });

  it("discarding clears the answers and the link", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "HANDED_OFF", handOffMessageId: "message-0" }));
    await discardStaffDraft("event-1", "draft-1", "staff-1");
    expect(mocks.draftUpdate).toHaveBeenCalledWith({ where: { id: "draft-1" }, data: expect.objectContaining({ status: "DISCARDED", responses: {}, handOffTokenHash: null, handOffMessageId: null }) });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "STAFF_REGISTRATION_DRAFT_DISCARDED" }) });
  });
});

describe("handing a draft to the registrant (#1510)", () => {
  it("needs the registrant's name and email", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ responses: { first_name: "Avery", last_name: "Example" } }));
    await expect(handOffStaffDraft("event-1", "draft-1", "staff-1", now)).rejects.toMatchObject({ code: "EMAIL_REQUIRED" });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("queues exactly one email with a sentinel, never a token or an answer, and stores no token hash yet", async () => {
    const result = await handOffStaffDraft("event-1", "draft-1", "staff-1", now);
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(1);
    const message = mocks.outboxCreate.mock.calls[0]![0].data;
    expect(message).toMatchObject({ templateKey: "STAFF_REGISTRATION_DRAFT_LINK", recipientEmail: "avery@example.test", eventId: null, status: "PENDING" });
    expect(message.bodyTextSnapshot).toContain(STAFF_DRAFT_LINK_SENTINEL);
    expect(message.bodyTextSnapshot).toContain("Pat Staffer at the Iowa-Missouri Conference started your registration for Synthetic Camp. Open this private link to check your answers, add the rest and submit.");
    expect(message.bodyTextSnapshot).not.toContain("Avery");
    expect(message.bodyTextSnapshot).not.toContain("avery@example.test");
    expect(mocks.draftUpdate).toHaveBeenCalledWith({ where: { id: "draft-1" }, data: expect.objectContaining({ status: "HANDED_OFF", handOffTokenHash: null, handedOffByUserId: "staff-1", handOffMessageId: "message-1", handOffExpiresAt: new Date("2026-11-27T15:00:00Z") }) });
    expect(mocks.processAccountEmailQueue).toHaveBeenCalledWith({ messageIds: ["message-1"], limit: 1 });
    expect(result.expiresAt).toBe("2026-11-27T15:00:00.000Z");
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain("avery@example.test");
  });

  it("send again replaces the link: the earlier message is cancelled and the hash cleared", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "HANDED_OFF", handOffMessageId: "message-0" }));
    await handOffStaffDraft("event-1", "draft-1", "staff-1", now);
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith({ where: { id: "message-0", status: "PENDING" }, data: { status: "CANCELLED" } });
    expect(mocks.draftUpdate.mock.calls[0]![0].data).toMatchObject({ handOffTokenHash: null, handOffMessageId: "message-1" });
    expect(mocks.outboxCreate).toHaveBeenCalledTimes(1);
  });

  it("will not send for a draft already submitted or for a closed event", async () => {
    mocks.draftFindFirst.mockResolvedValue(draftRow({ status: "SUBMITTED" }));
    await expect(handOffStaffDraft("event-1", "draft-1", "staff-1", now)).rejects.toMatchObject({ code: "DRAFT_NOT_EDITABLE" });
    mocks.draftFindFirst.mockResolvedValue(draftRow());
    mocks.eventFindUniqueOrThrow.mockResolvedValue({ isPublished: true, archivedAt: null, timezone: "America/Chicago", registrationOpensOn: null, registrationClosesOn: "2026-11-01", waitlistEnabled: false, lifecycleState: null, startsAt: new Date("2026-12-01T15:00:00Z"), endsAt: new Date("2026-12-03T15:00:00Z") });
    await expect(handOffStaffDraft("event-1", "draft-1", "staff-1", now)).rejects.toMatchObject({ code: "REGISTRATION_NOT_OPEN" });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("mints the token at delivery and stores only its hash; a withdrawn draft gets none", async () => {
    mocks.draftFindUnique.mockResolvedValue({ id: "draft-1", status: "HANDED_OFF", handOffExpiresAt: new Date("2026-11-27T15:00:00Z") });
    (client.staffRegistrationDraft as unknown as { updateMany: unknown }).updateMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.stubEnv("APP_BASE_URL", "https://events.imsda.test");
    const prepared = await prepareStaffDraftLinkBodyForDelivery({ messageId: "message-1", bodyText: `Open ${STAFF_DRAFT_LINK_SENTINEL}`, now });
    const stored = (client.staffRegistrationDraft as unknown as { updateMany: ReturnType<typeof vi.fn> }).updateMany.mock.calls[0]![0];
    const url = prepared.bodyText.replace("Open ", "");
    const token = decodeURIComponent(url.split("/register/finish/")[1]!);
    expect(url.startsWith("https://events.imsda.test/register/finish/")).toBe(true);
    expect(stored.data).toEqual({ handOffTokenHash: hashOpaqueToken(token) });
    expect(JSON.stringify(stored)).not.toContain(token);

    mocks.draftFindUnique.mockResolvedValue({ id: "draft-1", status: "OPEN", handOffExpiresAt: null });
    await expect(prepareStaffDraftLinkBodyForDelivery({ messageId: "message-1", bodyText: STAFF_DRAFT_LINK_SENTINEL, now })).rejects.toThrow(/withdrawn|expired/);
  });

  it("a definitive delivery failure puts the draft back to being entered", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await retireStaffDraftLinkForMessage({ staffRegistrationDraft: { updateMany } } as never, "message-1", now);
    expect(updateMany).toHaveBeenCalledWith({ where: { handOffMessageId: "message-1", status: "HANDED_OFF" }, data: expect.objectContaining({ status: "OPEN", handOffTokenHash: null }) });
  });
});

describe("the registrant's link (#1510)", () => {
  it("finds a handed-off, unexpired draft by the hash of the token only", async () => {
    mocks.draftFindUnique.mockResolvedValue({ id: "draft-1", eventId: "event-1", status: "HANDED_OFF", handOffExpiresAt: new Date("2026-11-20T00:00:00Z"), responses: { first_name: "Avery" }, form: { slug: "camp-form" }, event: { slug: "camp" } });
    const link = await resolveStaffDraftLink("a-token", now);
    expect(mocks.draftFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { handOffTokenHash: hashOpaqueToken("a-token") } }));
    expect(link).toMatchObject({ draftId: "draft-1", eventSlug: "camp", formSlug: "camp-form", responses: { first_name: "Avery" } });
  });

  it.each([
    ["used", { status: "SUBMITTED" }],
    ["expired", { handOffExpiresAt: new Date("2026-11-12T00:00:00Z") }],
    ["withdrawn", { status: "OPEN" }],
  ])("gives nothing for a %s link", async (_name, change) => {
    mocks.draftFindUnique.mockResolvedValue({ id: "draft-1", eventId: "event-1", status: "HANDED_OFF", handOffExpiresAt: new Date("2026-11-20T00:00:00Z"), responses: {}, form: { slug: "f" }, event: { slug: "e" }, ...change });
    expect(await resolveStaffDraftLink("a-token", now)).toBeNull();
  });

  it("gives nothing for an unknown token", async () => {
    mocks.draftFindUnique.mockResolvedValue(null);
    expect(await resolveStaffDraftLink("nope", now)).toBeNull();
  });
});

describe("checking a staff draft (#1510)", () => {
  it("runs the shared public path on the pinned version with a fresh key and returns the total", async () => {
    mocks.checkPublicRegistration.mockResolvedValue({ registrationStatus: "SUBMITTED", waitlistPosition: null, attendeeCount: 1, totalCents: 12_500, promoCode: null, lineItems: [], pricingDate: "2026-11-13" });
    const first = await checkStaffDraft("event-1", "draft-1", "staff-1");
    const second = await checkStaffDraft("event-1", "draft-1", "staff-1");
    expect(first).toMatchObject({ ok: true, check: { totalCents: 12_500 }, registrantFills: expect.arrayContaining(["Birth date", "I agree to the waiver"]) });
    const [slug, formSlug, input] = mocks.checkPublicRegistration.mock.calls[0]!;
    expect([slug, formSlug]).toEqual(["camp", "camp-form"]);
    expect(input).toMatchObject({ versionId: "v1", responses: { first_name: "Avery", last_name: "Example", email: "avery@example.test" } });
    expect(input.idempotencyKey).not.toBe(mocks.checkPublicRegistration.mock.calls[1]![2].idempotencyKey);
    expect(second.ok).toBe(true);
    // Nothing was written but the audit line, and it holds no answer.
    expect(mocks.draftUpdate).not.toHaveBeenCalled();
    expect(mocks.draftCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain("avery");
  });

  it("turns the form's problems into a readable list", async () => {
    mocks.checkPublicRegistration.mockRejectedValue(new PublicRegistrationError("INVALID_SUBMISSION", "Review the highlighted fields and submit again.", [
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "fld3", key: "email", path: "responses.email", attendeeIndex: null, message: "Enter a valid email." },
      { kind: "validation", code: "INVALID_RESPONSE", fieldId: "fld9", key: "waiver", path: "responses.waiver", attendeeIndex: null, message: "Required." },
    ]));
    expect(await checkStaffDraft("event-1", "draft-1", "staff-1")).toEqual({
      ok: false,
      kind: "NEEDS_ANSWERS",
      message: "Review the highlighted fields and submit again.",
      lines: { staffNeeds: ["Email: Enter a valid email."], registrantFills: ["I agree to the waiver: Required."] },
      rosterPending: false,
    });
  });

  it("reports a full event as unavailable, and refuses when the form was published again", async () => {
    mocks.checkPublicRegistration.mockRejectedValue(new PublicRegistrationError("EVENT_FULL", "Only 0 attendee spots remain for this event, and its waitlist is not enabled."));
    expect(await checkStaffDraft("event-1", "draft-1", "staff-1")).toMatchObject({ ok: false, kind: "UNAVAILABLE" });
    mocks.formFindFirst.mockResolvedValue(publishedForm({ versionId: "v2" }));
    await expect(checkStaffDraft("event-1", "draft-1", "staff-1")).rejects.toMatchObject({ code: "FORM_CHANGED", message: "The form changed; reopen the draft." });
  });
});
