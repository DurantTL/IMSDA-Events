import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  ensure: vi.fn(),
  processQueued: vi.fn(),
  staffCopySwitch: vi.fn(),
  enqueueRegistrantUpdated: vi.fn(),
  enqueueStaffUpdated: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logWarn: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/modules/registration-pdf/repository", () => ({ ensureRegistrationPdfOutsideTransaction: mocks.ensure }));
// The form's own notifications (#1081) have their own tests; here a change only has to hand over to them.
vi.mock("@/modules/registration-form-notifications/after-commit", () => ({ notifyFormNotificationsAfterChange: vi.fn() }));
vi.mock("@/modules/communications/messaging-repository", () => ({ processQueuedMessageIdsAfterCommit: mocks.processQueued }));
vi.mock("@/modules/notifications/settings", () => ({ isNotificationEnabled: mocks.staffCopySwitch }));
vi.mock("@/modules/communications/effective-delivery", () => ({
  loadEventEmailSettings: vi.fn().mockResolvedValue({ internalNotificationEmails: ["team@example.test", "second@example.test"] }),
}));
vi.mock("@/modules/communications/transactional-messages", () => ({
  enqueueRegistrationUpdatedMessage: mocks.enqueueRegistrantUpdated,
  enqueueStaffRegistrationUpdatedMessage: mocks.enqueueStaffUpdated,
}));

import { attachRegistrationPdfAfterCommit, finishRegistrationChange } from "@/modules/registration-pdf/after-commit";
import { withPlainLeadNote } from "@/modules/communications/email-html";
import { REGISTRANT_UPDATED_PDF_NOTE, STAFF_UPDATED_PDF_NOTE } from "@/modules/registration-pdf/notices";

/**
 * The PDF is made after the commit, attached to held messages and sent; a failure never fails the registration (#1082).
 * Synthetic ids only.
 */

const document = { id: "doc-2", version: 2, attachmentId: "attachment-2", sha256: "abc", filename: "Registration-Synthetic.pdf", sizeBytes: 100, updated: true, createdAt: "2027-03-02T00:00:00.000Z" };

function database(rows: Array<{ id: string; recipientKind: string; bodyTextSnapshot: string; bodyHtmlSnapshot: string | null }> = []) {
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const findMany = vi.fn().mockResolvedValue(rows);
  const tx = { adminAlertFeedItem: { createMany: vi.fn(async () => ({ count: 1 })) } };
  const db = { messageOutbox: { findMany, update, updateMany }, $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)) };
  mocks.getPrisma.mockReturnValue(db);
  return { db, tx, update, updateMany, findMany };
}

const change = { eventId: "event-1", registrationId: "registration-1", changeKey: "amendment:op-1", correlationId: "correlation-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staffCopySwitch.mockResolvedValue(true);
  mocks.processQueued.mockResolvedValue({});
  mocks.enqueueRegistrantUpdated.mockResolvedValue({ messageIds: ["registrant-new"], pendingMessageIds: ["registrant-new"] });
  mocks.enqueueStaffUpdated.mockImplementation(async (_tx: unknown, input: { recipientEmail: string }) => ({ messageIds: [`staff-${input.recipientEmail}`], pendingMessageIds: [`staff-${input.recipientEmail}`] }));
});

describe("an amendment announced after its commit (#1082)", () => {
  it("attaches the new PDF to the held update notice and re-sends the staff copy with it", async () => {
    const { update, updateMany } = database([{ id: "held-1", recipientKind: "REGISTRANT", bodyTextSnapshot: "Registration updated.", bodyHtmlSnapshot: "<p>Registration updated.</p>" }]);
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: 1, document });

    await finishRegistrationChange({ ...change, meaningful: true, heldMessageIds: ["held-1"] });

    expect(mocks.ensure).toHaveBeenCalledWith({ eventId: "event-1", registrationId: "registration-1", notifiedChange: { meaningful: true } });
    // The held registrant notice gets the file and the line saying so; no second registrant notice is queued.
    expect(update).toHaveBeenCalledWith({ where: { id: "held-1" }, data: expect.objectContaining({ attachmentId: "attachment-2" }) });
    expect(String(update.mock.calls[0]![0].data.bodyTextSnapshot).startsWith(REGISTRANT_UPDATED_PDF_NOTE)).toBe(true);
    expect(mocks.enqueueRegistrantUpdated).not.toHaveBeenCalled();
    // Both staff addresses get the Updated copy with the same attachment.
    expect(mocks.enqueueStaffUpdated).toHaveBeenCalledTimes(2);
    for (const [, input] of mocks.enqueueStaffUpdated.mock.calls) {
      expect(input).toMatchObject({ attachmentId: "attachment-2", leadNote: STAFF_UPDATED_PDF_NOTE, transitionKey: "registration-change:amendment:op-1:staff-copy" });
    }
    // The hold is released, then everything is processed.
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["held-1"] }, status: "PENDING", availableAt: { gt: expect.any(Date) } }, data: { availableAt: expect.any(Date) } });
    expect(mocks.processQueued).toHaveBeenCalledWith(["held-1", "staff-team@example.test", "staff-second@example.test"]);
  });

  it("queues the registrant's Updated notice itself when the change was not otherwise announced but the PDF changed", async () => {
    database();
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: 1, document });
    await finishRegistrationChange({ ...change, meaningful: false, heldMessageIds: [] });
    expect(mocks.enqueueRegistrantUpdated).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attachmentId: "attachment-2", leadNote: REGISTRANT_UPDATED_PDF_NOTE, changeCategory: "REGISTRATION_DETAILS" }));
    expect(mocks.processQueued).toHaveBeenCalledWith(["registrant-new", "staff-team@example.test", "staff-second@example.test"]);
  });

  it("queues nothing when the PDF did not change", async () => {
    database();
    mocks.ensure.mockResolvedValue({ created: false, previousVersion: 1, document });
    await finishRegistrationChange({ ...change, meaningful: false, heldMessageIds: [] });
    expect(mocks.enqueueRegistrantUpdated).not.toHaveBeenCalled();
    expect(mocks.enqueueStaffUpdated).not.toHaveBeenCalled();
    expect(mocks.processQueued).toHaveBeenCalledWith([]);
  });

  it("sends no Updated copy for a registration made before PDFs when the save changed nothing visible", async () => {
    database();
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: null, document: { ...document, version: 1, updated: false } });
    await finishRegistrationChange({ ...change, meaningful: false, heldMessageIds: [] });
    expect(mocks.enqueueRegistrantUpdated).not.toHaveBeenCalled();
    expect(mocks.enqueueStaffUpdated).not.toHaveBeenCalled();
  });

  it("sends the staff copy for a first-ever PDF when the change was meaningful", async () => {
    database();
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: null, document });
    await finishRegistrationChange({ ...change, meaningful: true, heldMessageIds: [] });
    expect(mocks.enqueueStaffUpdated).toHaveBeenCalledTimes(2);
  });

  it("re-sends no staff copy when the staff-copy switch is off, but still sends the registrant's", async () => {
    database();
    mocks.staffCopySwitch.mockResolvedValue(false);
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: 1, document });
    await finishRegistrationChange({ ...change, meaningful: false, heldMessageIds: [] });
    expect(mocks.enqueueStaffUpdated).not.toHaveBeenCalled();
    expect(mocks.enqueueRegistrantUpdated).toHaveBeenCalledOnce();
  });

  it("never throws: a PDF failure releases the held notice, sends it without the PDF, and logs ids only", async () => {
    const { updateMany } = database();
    mocks.ensure.mockRejectedValue(new Error("render failed"));
    await expect(finishRegistrationChange({ ...change, meaningful: true, heldMessageIds: ["held-1"] })).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalled();
    expect(mocks.processQueued).toHaveBeenCalledWith(["held-1"]);
    expect(mocks.enqueueStaffUpdated).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { registrationId: "registration-1" });
  });
});

describe("the confirmation's PDF made after the submit commits (#1082)", () => {
  it("attaches version 1 to the held confirmation and staff copy, adds the line to the registrant's only, and releases them", async () => {
    const { update, updateMany } = database([
      { id: "m-registrant", recipientKind: "REGISTRANT", bodyTextSnapshot: "Thanks.", bodyHtmlSnapshot: "<p>Thanks.</p>" },
      { id: "m-staff", recipientKind: "INTERNAL", bodyTextSnapshot: "New registration.", bodyHtmlSnapshot: null },
    ]);
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: null, document: { ...document, version: 1, updated: false } });
    await attachRegistrationPdfAfterCommit({ eventId: "event-1", registrationId: "registration-1", messageIds: ["m-registrant", "m-staff"] });
    expect(mocks.ensure).toHaveBeenCalledWith({ eventId: "event-1", registrationId: "registration-1" });
    const registrant = update.mock.calls.find(([call]) => call.where.id === "m-registrant")![0];
    const staff = update.mock.calls.find(([call]) => call.where.id === "m-staff")![0];
    expect(registrant.data.attachmentId).toBe("attachment-2");
    expect(registrant.data.bodyTextSnapshot).toBe("A PDF copy of your registration is attached.\n\nThanks.");
    expect(staff.data).toEqual({ attachmentId: "attachment-2", bodyTextSnapshot: "New registration.", bodyHtmlSnapshot: null });
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("puts the attached line after the club confirmation note, which stays first", async () => {
    const rendered = withPlainLeadNote({ body: "# Registration received\n\nThanks.", bodyHtml: "<h1>Registration received</h1>" }, "Registered for Maple Grove Pathfinders.");
    const { update } = database([{ id: "m-registrant", recipientKind: "REGISTRANT", bodyTextSnapshot: rendered.body, bodyHtmlSnapshot: rendered.bodyHtml }]);
    mocks.ensure.mockResolvedValue({ created: true, previousVersion: null, document: { ...document, version: 1, updated: false } });
    await attachRegistrationPdfAfterCommit({ eventId: "event-1", registrationId: "registration-1", messageIds: ["m-registrant"] });
    const data = update.mock.calls[0]![0].data;
    expect(data.bodyTextSnapshot).toBe("Registered for Maple Grove Pathfinders. A PDF copy of your registration is attached.\n\n# Registration received\n\nThanks.");
    expect(data.bodyHtmlSnapshot).toContain("Registered for Maple Grove Pathfinders. A PDF copy of your registration is attached.</p>");
    expect(data.bodyHtmlSnapshot.indexOf("Maple Grove")).toBeLessThan(data.bodyHtmlSnapshot.indexOf("<h1>"));
  });

  it("never throws: when the PDF cannot be made the messages are released without it, and the body does not claim one", async () => {
    const { update, updateMany } = database();
    mocks.ensure.mockRejectedValue(new Error("render failed"));
    await expect(attachRegistrationPdfAfterCommit({ eventId: "event-1", registrationId: "registration-1", messageIds: ["m-registrant"] })).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledOnce();
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), expect.any(Error), { registrationId: "registration-1" });
  });

  it("releases the messages unchanged when there is no PDF to make (no form, or over the size limit)", async () => {
    const { update, updateMany } = database();
    mocks.ensure.mockResolvedValue(null);
    await attachRegistrationPdfAfterCommit({ eventId: "event-1", registrationId: "registration-1", messageIds: ["m-registrant"] });
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("does nothing at all when no message is waiting (a waitlist notice or a replay)", async () => {
    database();
    await attachRegistrationPdfAfterCommit({ eventId: "event-1", registrationId: "registration-1", messageIds: [] });
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
