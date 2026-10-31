import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mfaFindMany: vi.fn(),
  passkeyFindMany: vi.fn(),
  passkeysConfigured: vi.fn(),
  emailConfigured: vi.fn(),
  outboxCreate: vi.fn(),
  orgFind: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode }) => createElement("a", { href: props.href }, props.children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ APP_BASE_URL: "https://events.imsda.test" }) }));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    attendeeMfaEnrollment: { findMany: mocks.mfaFindMany },
    attendeePasskey: { findMany: mocks.passkeyFindMany },
    organization: { findUnique: mocks.orgFind },
  }),
}));
vi.mock("@/modules/attendee-accounts/passkeys", () => ({ passkeysConfigured: mocks.passkeysConfigured }));
vi.mock("@/modules/communications/account-email", () => ({
  isAccountEmailConfigured: mocks.emailConfigured,
  getAccountEmailSender: () => ({ name: "IMSDA Events", address: "no-reply@imsda.org", replyTo: null }),
}));

import { ClubDirectorsWorkspace } from "@/components/club-directors-workspace";
import { accountIdsWithTwoStepOn } from "@/modules/attendee-accounts/two-step-status";
import { monthlyReportProgress, reportMonthBeforeJoined, reportableMonths } from "@/modules/club-reports/domain";
import { monthlyRecordSteps } from "@/modules/club-rosters/home-view";
import { getClubJoinedOn } from "@/modules/club-reports/repository";
import { reportYearDueBeforeJoined } from "@/modules/club-reports/year-end-domain";
import { clubRoleGivenEmail, queueClubRoleGivenEmail } from "@/modules/organizations/club-role-notice";

describe("two-step status for a screen: ids only, no secrets (#1410)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mfaFindMany.mockResolvedValue([{ accountId: "a1" }]);
    mocks.passkeyFindMany.mockResolvedValue([{ accountId: "a2" }]);
    mocks.passkeysConfigured.mockResolvedValue(true);
  });

  it("counts an active authenticator, or a passkey while passkeys are on", async () => {
    await expect(accountIdsWithTwoStepOn(["a1", "a2", "a3"])).resolves.toEqual(new Set(["a1", "a2"]));
    mocks.passkeysConfigured.mockResolvedValue(false);
    await expect(accountIdsWithTwoStepOn(["a1", "a2", "a3"])).resolves.toEqual(new Set(["a1"]));
  });

  it("reads only account ids and only active enrollments, never a secret", async () => {
    await accountIdsWithTwoStepOn(["a1"]);
    expect(mocks.mfaFindMany).toHaveBeenCalledWith({ where: { accountId: { in: ["a1"] }, status: "ACTIVE" }, select: { accountId: true } });
    expect(mocks.passkeyFindMany).toHaveBeenCalledWith(expect.objectContaining({ select: { accountId: true } }));
  });
});

describe("the role-given email (#1410)", () => {
  const input = {
    role: "DIRECTOR" as const, clubName: "Sample Pathfinders", displayName: "Quinn Rivers",
    startsOn: new Date("2026-11-01T12:00:00Z"), portalUrl: "https://events.imsda.test/account/clubs/club-1", twoStepOn: false,
  };

  it("uses the approved subject and copy, and links to the club portal", () => {
    const { subject, bodyText } = clubRoleGivenEmail(input);
    expect(subject).toBe("You're now Director of Sample Pathfinders");
    expect(bodyText).toContain("Hi Quinn,");
    expect(bodyText).toContain("You've been given the Director role for Sample Pathfinders, starting November 1, 2026.");
    expect(bodyText).toContain("One thing the first time you open club pages");
    expect(bodyText).toContain("Setup takes about two minutes, and the page walks you through it.");
    expect(bodyText).toContain("Open Sample Pathfinders: https://events.imsda.test/account/clubs/club-1");
    expect(bodyText).toContain("Your own event registrations work without it.");
  });

  it("leaves out 'starting' when there is no start date, and never invents a phone number", () => {
    const { bodyText } = clubRoleGivenEmail({ ...input, startsOn: null });
    expect(bodyText).toContain("for Sample Pathfinders.");
    expect(bodyText).not.toContain("starting");
    expect(bodyText).not.toMatch(/call|\(\d{3}\) ?\d{3}-\d{4}|Questions\?/i);
  });

  it("leaves out the two-step box for someone who already has two-step", () => {
    const { bodyText } = clubRoleGivenEmail({ ...input, twoStepOn: true });
    expect(bodyText).not.toContain("two-step");
    expect(bodyText).not.toContain("One thing");
    expect(bodyText).toContain("Open Sample Pathfinders:");
  });

  it("is queued once per grant in the account outbox, inside the grant's transaction", async () => {
    mocks.emailConfigured.mockReturnValue(true);
    mocks.outboxCreate.mockResolvedValue({ id: "message-1" });
    const tx = { messageOutbox: { create: mocks.outboxCreate } };
    const id = await queueClubRoleGivenEmail(tx as never, {
      grantId: "grant-1", accountId: "a1", email: "quinn@example.test", displayName: "Quinn Rivers",
      organizationId: "club-1", clubName: "Sample Pathfinders", role: "DIRECTOR", startsOn: null, twoStepOn: false,
    });
    expect(id).toBe("message-1");
    expect(mocks.outboxCreate.mock.calls[0][0].data).toMatchObject({
      eventId: null, accountAttendeeId: "a1", recipientKind: "ACCOUNT", idempotencyKey: "club-role-notice:grant-1", templateKey: "CLUB_TEAM_ROLE_NOTIFICATION",
    });
  });

  it("queues nothing where account email isn't configured; the grant still stands", async () => {
    vi.clearAllMocks();
    mocks.emailConfigured.mockReturnValue(false);
    const id = await queueClubRoleGivenEmail({ messageOutbox: { create: mocks.outboxCreate } } as never, {
      grantId: "g", accountId: "a", email: "x@example.test", displayName: "X", organizationId: "c", clubName: "C", role: "DIRECTOR", startsOn: null, twoStepOn: false,
    });
    expect(id).toBeNull();
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });
});

describe("periods before the club joined (#1410, C3)", () => {
  it("a club made on October 31 owes nothing for September or earlier, but the month it joined counts", () => {
    expect(reportMonthBeforeJoined("2026-09", "2026-10-31")).toBe(true);
    expect(reportMonthBeforeJoined("2026-10", "2026-10-31")).toBe(false);
    expect(reportMonthBeforeJoined("2026-11", "2026-10-31")).toBe(false);
  });

  it("a Pathfinder year whose Year-End due date (April 1) had passed when the club joined is skipped, even if it joined before the year's end", () => {
    expect(reportYearDueBeforeJoined("2025-26", "2026-10-31")).toBe(true);
    // Created between April 2 and April 30, 2026: the 2025-26 report was already past due.
    expect(reportYearDueBeforeJoined("2025-26", "2026-04-02")).toBe(true);
    expect(reportYearDueBeforeJoined("2025-26", "2026-04-30")).toBe(true);
    expect(reportYearDueBeforeJoined("2025-26", "2026-04-01")).toBe(false);
    expect(reportYearDueBeforeJoined("2026-27", "2026-10-31")).toBe(false);
  });
});

describe("the Role given notice and leader chips", () => {
  const grant = (twoStepOn: boolean) => ({
    id: "g1", organizationId: "club-1", role: "DIRECTOR" as const, status: "ACTIVE" as const, effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveTo: null,
    reason: "Board vote", revokedAt: null, revokeReason: null, createdAt: "2026-10-01T00:00:00.000Z",
    account: { id: "a1", displayName: "Quinn Rivers", email: "quinn@example.test" }, twoStepOn, grantedBy: null, revokedBy: null,
  });
  const html = (twoStepOn: boolean) => renderToStaticMarkup(createElement(ClubDirectorsWorkspace, {
    club: { id: "club-1", name: "Sample Pathfinders", isActive: true }, initialGrants: [grant(twoStepOn)] as never,
  }));

  it("shows the two-step chip on each current leader row", () => {
    expect(html(false)).toContain("Two-step not set up");
    expect(html(true)).toContain("Two-step on");
    expect(html(true)).not.toContain("Two-step not set up");
  });
});

describe("every view agrees on which months are due (#1410)", () => {
  const NOW = new Date("2026-10-31T18:00:00Z");
  const JOINED = "2026-10-31";

  it("reportableMonths skips months before the join month, keeps ones filed anyway, and filters nothing without a join date", () => {
    expect(reportableMonths("2026-27", NOW)).toEqual(["2026-09", "2026-10"]);
    expect(reportableMonths("2026-27", NOW, { joinedOn: JOINED })).toEqual(["2026-10"]);
    expect(reportableMonths("2026-27", NOW, { joinedOn: JOINED, keep: new Set(["2026-09"]) })).toEqual(["2026-09", "2026-10"]);
    expect(reportableMonths("2026-27", NOW, { joinedOn: null })).toEqual(["2026-09", "2026-10"]);
  });

  it("the staff overview counts: a club made today is not missing September", () => {
    expect(monthlyReportProgress("2026-27", NOW, new Set())).toMatchObject({ filed: 0, missing: 1 });
    expect(monthlyReportProgress("2026-27", NOW, new Set(), JOINED)).toMatchObject({ filed: 0, missing: 0 });
    expect(monthlyReportProgress("2026-27", NOW, new Set(["2026-09"]), JOINED)).toMatchObject({ filed: 1 });
  });

  it("the club home 'What's next' list is built from the same months", () => {
    const early = new Date("2026-10-10T12:00:00Z");
    const without = monthlyRecordSteps([], "2026-27", "/account/clubs/c1", early);
    const withJoin = monthlyRecordSteps([], "2026-27", "/account/clubs/c1", early, "2026-10-09");
    expect(without.steps.map((step) => step.key)).toContain("report-2026-09");
    expect(withJoin.steps.map((step) => step.key)).not.toContain("report-2026-09");
  });
});

describe("only a club made through a new-club application has a join date", () => {
  it("returns the creation day for an application club, and null for an imported or other club", async () => {
    mocks.orgFind.mockResolvedValue({ createdAt: new Date("2026-10-31T18:00:00Z"), newClubApplicationCreated: { id: "app-1" } });
    await expect(getClubJoinedOn("club-1")).resolves.toBe("2026-10-31");
    mocks.orgFind.mockResolvedValue({ createdAt: new Date("2026-10-31T18:00:00Z"), newClubApplicationCreated: null });
    await expect(getClubJoinedOn("club-2")).resolves.toBeNull();
    mocks.orgFind.mockResolvedValue(null);
    await expect(getClubJoinedOn("missing")).resolves.toBeNull();
  });
});
