import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1686 part 2b: when a TLT Application, TLT Program Recommendation or TLT of the Year is submitted, every TLT director
 * gets one email with an inbox link and no answer and no child's name; another club form never alerts her. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  templateFindUnique: vi.fn(),
  grantFindMany: vi.fn(),
  organizationFindUnique: vi.fn(),
  outboxCreate: vi.fn(),
  outboxFindMany: vi.fn(),
  accountFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}));

const client = {
  clubFormTemplate: { findUnique: mocks.templateFindUnique },
  areaCoordinatorGrant: { findMany: mocks.grantFindMany },
  organization: { findUnique: mocks.organizationFindUnique },
  messageOutbox: { create: mocks.outboxCreate, findMany: mocks.outboxFindMany },
  attendeeAccount: { findUnique: mocks.accountFindUnique },
  user: { findUnique: mocks.userFindUnique },
  adminAlertFeedItem: { createMany: vi.fn(async () => ({ count: 1 })) },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => client }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/modules/communications/account-email", () => ({
  AccountEmailNotConfiguredError: class extends Error {},
  isAccountEmailConfigured: () => true,
  getAccountEmailSender: () => ({ name: "IMAdventist", address: "events@example.test", replyTo: null }),
}));
vi.mock("@/modules/communications/email-delivery", () => ({ processAccountEmailQueue: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));

import { queueClubFormSubmittedEmails, tltFormSubmittedContent } from "@/modules/club-forms/submission-alert";

const NAME = "Riley Sample";
const ANSWER = "Synthetic reference answer";
const now = new Date("2026-11-12T16:00:00Z");
const input = { submissionId: "sub-1", templateId: "template-1", organizationId: "club-a", actor: null, submittedAt: now };

function setup(key: string, notify: string[], directors: string[]) {
  mocks.templateFindUnique.mockResolvedValue({ key, name: key === "club_tlt_application" ? "TLT Application" : "Other form", submissionNotifyEmails: notify });
  mocks.grantFindMany.mockResolvedValue(directors.map((email) => ({ attendeeAccount: { email } })));
  mocks.organizationFindUnique.mockResolvedValue({ name: "Example Pathfinders" });
  mocks.outboxFindMany.mockResolvedValue([]);
  let n = 0;
  mocks.outboxCreate.mockImplementation(async () => ({ id: `msg-${++n}` }));
}

const created = () => mocks.outboxCreate.mock.calls.map(([call]) => call.data);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});

describe("the TLT director's alert", () => {
  it.each(["club_tlt_application", "tlt_program_recommendation", "club_tlt_of_the_year"])("goes to every TLT director for %s, one email each", async (key) => {
    setup(key, [], ["Director.One@example.test", "director.two@example.test", "director.one@example.test"]);
    const ids = await queueClubFormSubmittedEmails(client as never, input, true);
    expect(ids).toHaveLength(2);
    expect(created().map((row) => row.recipientEmail).sort()).toEqual(["director.one@example.test", "director.two@example.test"]);
    expect(created().every((row) => row.recipientKind === "INTERNAL" && row.status === "PENDING" && row.templateKey === "CLUB_FORM_SUBMITTED")).toBe(true);
  });

  it("asks only for active grants with the setting on, on active accounts", async () => {
    setup("club_tlt_application", [], ["director@example.test"]);
    await queueClubFormSubmittedEmails(client as never, input, true);
    expect(mocks.grantFindMany.mock.calls[0]![0].where).toEqual({
      tltDirector: true,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      attendeeAccount: { status: "ACTIVE", disabledAt: null },
    });
  });

  it("is one email when the director's address is also on the form's list, and the list's other addresses still get the staff email", async () => {
    setup("club_tlt_application", ["staff@example.test", "DIRECTOR@example.test"], ["director@example.test"]);
    await queueClubFormSubmittedEmails(client as never, input, true);
    const rows = created();
    expect(rows.map((row) => row.recipientEmail).sort()).toEqual(["director@example.test", "staff@example.test"]);
    expect(rows.find((row) => row.recipientEmail === "director@example.test")!.subjectSnapshot).toMatch(/^TLT form submitted/);
    expect(rows.find((row) => row.recipientEmail === "staff@example.test")!.subjectSnapshot).toMatch(/^Club form submitted/);
  });

  it("makes the staff feed item only when the form's own list got an email, not for the director alone", async () => {
    setup("club_tlt_application", [], ["director@example.test"]);
    await queueClubFormSubmittedEmails(client as never, input, true);
    expect(client.adminAlertFeedItem.createMany).not.toHaveBeenCalled();
    setup("club_tlt_application", ["staff@example.test"], ["director@example.test"]);
    await queueClubFormSubmittedEmails(client as never, input, true);
    expect(client.adminAlertFeedItem.createMany).toHaveBeenCalledTimes(1);
  });

  it("never sends it twice for one submission", async () => {
    setup("club_tlt_application", [], ["director@example.test"]);
    mocks.outboxFindMany.mockResolvedValue([{ idempotencyKey: "club-form-submitted:sub-1:director@example.test" }]);
    await expect(queueClubFormSubmittedEmails(client as never, input, true)).resolves.toEqual([]);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("is not sent for any other club form, and the director list is not even read", async () => {
    setup("pathfinder_membership_application", ["staff@example.test"], ["director@example.test"]);
    await queueClubFormSubmittedEmails(client as never, input, true);
    expect(mocks.grantFindMany).not.toHaveBeenCalled();
    expect(created().map((row) => row.recipientEmail)).toEqual(["staff@example.test"]);
  });

  it("is not sent when the submitted-form alerts are switched off, or when no director exists and no list is set", async () => {
    setup("club_tlt_application", [], ["director@example.test"]);
    await expect(queueClubFormSubmittedEmails(client as never, input, false)).resolves.toEqual([]);
    setup("club_tlt_application", [], []);
    await expect(queueClubFormSubmittedEmails(client as never, input, true)).resolves.toEqual([]);
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });

  it("has no answer and no child's name in the stored message, and links to the inbox", async () => {
    setup("club_tlt_application", [], ["director@example.test"]);
    mocks.accountFindUnique.mockResolvedValue({ displayName: NAME });
    await queueClubFormSubmittedEmails(client as never, { ...input, actor: { kind: "ATTENDEE", accountId: "acct-1" } }, true);
    const row = created()[0]!;
    const text = JSON.stringify(row);
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(ANSWER);
    expect(row.bodyTextSnapshot).toContain("https://events.imsda.test/account/area-clubs/tlt/forms");
    expect(row.bodyTextSnapshot).toContain("The answers are not in this email.");
    expect(row.bodyTextSnapshot).toContain("Club: Example Pathfinders");
    expect(row.bodyTextSnapshot).not.toContain("/more/club-forms/");
    expect(row.metadata).toMatchObject({ submissionId: "sub-1", realDelivery: true });
  });

  it("takes only a form name, a club name and a time, so an answer has nowhere to get in", () => {
    const content = tltFormSubmittedContent({ formName: "TLT {{Application}}", clubName: "Example Pathfinders", submittedAt: now });
    expect(content.subject).toBe("TLT form submitted: TLT { {Application} } (Example Pathfinders)");
    expect(content.bodyText).not.toContain("{{");
  });
});
