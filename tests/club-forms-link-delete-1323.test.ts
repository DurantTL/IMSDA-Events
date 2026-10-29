import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1323: deleting an unused private link, and starting the new club year. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  writeAuditLog: vi.fn(),
  queryRaw: vi.fn(),
  linkFindFirst: vi.fn(),
  linkFindMany: vi.fn(),
  linkDelete: vi.fn(),
  submissionFindFirst: vi.fn(),
  outboxUpdateMany: vi.fn(),
  yearFindUnique: vi.fn(),
  yearUpsert: vi.fn(),
}));

const calls: string[] = [];
const client = {
  $queryRaw: (...args: unknown[]) => { calls.push("lock"); return mocks.queryRaw(...args); },
  clubFormLink: {
    findFirst: mocks.linkFindFirst,
    findMany: mocks.linkFindMany,
    delete: (...args: unknown[]) => { calls.push("delete"); return mocks.linkDelete(...args); },
  },
  clubFormSubmission: { findFirst: (...args: unknown[]) => { calls.push("check"); return mocks.submissionFindFirst(...args); } },
  messageOutbox: { updateMany: mocks.outboxUpdateMany },
  clubFormYearStart: { findUnique: mocks.yearFindUnique, upsert: mocks.yearUpsert },
  $transaction: (work: (tx: unknown) => unknown) => work(client),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SECRET_ENCRYPTION_KEY: "a-synthetic-encryption-key-for-club-form-tests", APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/communications/account-email", () => ({ isAccountEmailConfigured: () => true, getAccountEmailSender: () => ({ name: "IMSDA Events", address: "events@example.test", replyTo: null }) }));

import type { ClubFormsViewer } from "@/modules/club-forms/domain";
import { prepareClubFormLinkBodyForDelivery, CLUB_FORM_LINK_SENTINEL } from "@/modules/club-forms/link-email";
import { deleteUnusedClubFormLink } from "@/modules/club-forms/links";
import { getClubFormsYearState, startClubFormsYear } from "@/modules/club-forms/year-start";
import { clubFormApiError } from "@/modules/club-forms/api-errors";

const director: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-a", actor: { kind: "ATTENDEE", accountId: "acct-1" } };
const otherDirector: ClubFormsViewer = { kind: "CLUB_LEADER", organizationId: "club-b", actor: { kind: "ATTENDEE", accountId: "acct-9" } };
const staff: ClubFormsViewer = { kind: "STAFF", userId: "staff-1", systemAdmin: true, clubsAdministrator: false, sensitiveAnswers: true };

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  mocks.writeAuditLog.mockResolvedValue({});
  mocks.queryRaw.mockResolvedValue([{ id: "link-1" }]);
  mocks.linkFindFirst.mockResolvedValue({ id: "link-1", messageId: "message-1", template: { key: "off_premises_permission_slip" } });
  mocks.submissionFindFirst.mockResolvedValue(null);
  mocks.linkDelete.mockResolvedValue({});
  mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
  mocks.yearFindUnique.mockResolvedValue(null);
  mocks.yearUpsert.mockResolvedValue({});
});

describe("deleting an unused link", () => {
  it("deletes a link with no filled form, locking the row before it checks, and audits without the address", async () => {
    await deleteUnusedClubFormLink(director, "club-a", "link-1");
    expect(mocks.linkFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "link-1", organizationId: "club-a" } }));
    expect(calls).toEqual(["lock", "check", "delete"]);
    expect(mocks.submissionFindFirst).toHaveBeenCalledWith({ where: { linkId: "link-1" }, select: { id: true } });
    expect(mocks.linkDelete).toHaveBeenCalledWith({ where: { id: "link-1" } });
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "CLUB_FORM_LINK_DELETED", entityType: "ClubFormLink", entityId: "link-1" });
    expect(audit.metadata).toMatchObject({ organizationId: "club-a", templateKey: "off_premises_permission_slip" });
    expect(JSON.stringify(audit)).not.toMatch(/@|recipientEmail/);
    expect(mocks.writeAuditLog.mock.calls[0]![1]).toBe(client);
  });

  it("cancels the email that was still waiting to go out", async () => {
    await deleteUnusedClubFormLink(director, "club-a", "link-1");
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith({ where: { id: "message-1", status: "PENDING" }, data: expect.objectContaining({ status: "CANCELLED" }) });
  });

  it("deletes an open, a withdrawn and an expired link alike (the link's state is not checked)", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(deleteUnusedClubFormLink(director, "club-a", "link-1")).resolves.toBeUndefined();
    }
    expect(mocks.linkDelete).toHaveBeenCalledTimes(3);
  });

  it("refuses a link that has a filled form, and deletes nothing", async () => {
    mocks.submissionFindFirst.mockResolvedValue({ id: "sub-1" });
    await expect(deleteUnusedClubFormLink(director, "club-a", "link-1")).rejects.toMatchObject({ code: "LINK_HAS_ANSWERS" });
    expect(mocks.linkDelete).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.outboxUpdateMany).not.toHaveBeenCalled();
  });

  it("treats another club's link as not found", async () => {
    mocks.linkFindFirst.mockResolvedValue(null);
    await expect(deleteUnusedClubFormLink(director, "club-a", "link-of-club-b")).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
    expect(mocks.linkDelete).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not a leader of this club", async () => {
    await expect(deleteUnusedClubFormLink(otherDirector, "club-a", "link-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteUnusedClubFormLink(staff, "club-a", "link-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.linkFindFirst).not.toHaveBeenCalled();
  });

  it("answers 409 for a link with answers", async () => {
    mocks.submissionFindFirst.mockResolvedValue({ id: "sub-1" });
    const error = await deleteUnusedClubFormLink(director, "club-a", "link-1").catch((caught) => caught);
    expect(clubFormApiError(error, "Deleting a club form link").status).toBe(409);
  });
});

describe("the email of a deleted link", () => {
  it("fails with a plain error at delivery time, never minting a token", async () => {
    // The outbox worker finds no link for the message once it is deleted.
    const findUnique = vi.fn().mockResolvedValue(null);
    Object.assign(client.clubFormLink, { findUnique, updateMany: vi.fn() });
    await expect(prepareClubFormLinkBodyForDelivery({ messageId: "message-1", bodyText: `Open ${CLUB_FORM_LINK_SENTINEL}`, now: new Date() }))
      .rejects.toThrow(/withdrawn, used or has expired/);
    expect((client.clubFormLink as unknown as { updateMany: ReturnType<typeof vi.fn> }).updateMany).not.toHaveBeenCalled();
  });
});

describe("starting the new year", () => {
  it("records the current club year for the club and audits it without personal details", async () => {
    const result = await startClubFormsYear(director, "club-a", new Date("2026-10-29T15:00:00Z"));
    expect(result).toEqual({ clubYear: "2026-27", alreadyStarted: false });
    expect(mocks.yearUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_clubYear: { organizationId: "club-a", clubYear: "2026-27" } },
      create: expect.objectContaining({ organizationId: "club-a", clubYear: "2026-27", startedByAccountId: "acct-1" }),
    }));
    const audit = mocks.writeAuditLog.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "CLUB_FORMS_YEAR_STARTED", entityId: "club-a" });
    expect(audit.metadata).toMatchObject({ organizationId: "club-a", clubYear: "2026-27" });
    expect(mocks.writeAuditLog.mock.calls[0]![1]).toBe(client);
  });

  it("is idempotent: a second start changes nothing and writes no second audit row", async () => {
    mocks.yearFindUnique.mockResolvedValue({ organizationId: "club-a" });
    const result = await startClubFormsYear(director, "club-a", new Date("2026-10-29T15:00:00Z"));
    expect(result).toEqual({ clubYear: "2026-27", alreadyStarted: true });
    expect(mocks.yearUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not a leader of this club", async () => {
    await expect(startClubFormsYear(otherDirector, "club-a")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startClubFormsYear(staff, "club-a")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.yearUpsert).not.toHaveBeenCalled();
  });

  it("reports the state the page needs, for leaders only", async () => {
    Object.assign(client, {});
    (client.clubFormLink as unknown as Record<string, unknown>).findFirst = vi.fn().mockResolvedValue({ id: "old-link" });
    (client.clubFormSubmission as unknown as Record<string, unknown>).findFirst = vi.fn().mockResolvedValue(null);
    await expect(getClubFormsYearState(director, "club-a", "2026-27")).resolves.toEqual({ yearStarted: false, hasEarlierYears: true });
    await expect(getClubFormsYearState(otherDirector, "club-a", "2026-27")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
