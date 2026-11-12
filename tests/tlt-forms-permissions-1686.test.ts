import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1686 part 2b: who reaches the TLT forms inbox, one TLT form and the TLT forms CSV. Only the TLT director does (an
 * active Area Coordinator grant with the setting on, an active account, the second sign-in step). Every other person
 * gets "not found" before a single form is read. Synthetic data only.
 */

const mocks = vi.hoisted(() => ({
  grantFindUnique: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  getCurrentSession: vi.fn(),
  readTltFormsInbox: vi.fn(),
  recordTltFormsInboxView: vi.fn(),
  countTltFormsByPerson: vi.fn(),
  getSubmissionForViewer: vi.fn(),
  buildClubFormsCsv: vi.fn(),
  readTltDirectory: vi.fn(),
  listTltLists: vi.fn(),
  recordTltDirectoryView: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.grantFindUnique } }) }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee, findSwitchableAttendeeAccountForStaff: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/tlt-forms-inbox", () => ({ TltFormsInbox: () => null }));
vi.mock("@/components/tlt-directory", () => ({ TltDirectory: () => null }));
vi.mock("@/components/club-form-submission-view", () => ({ ClubFormSubmissionView: () => null }));
vi.mock("@/components/club-forms-actions", () => ({ PrintFormButton: () => null }));
vi.mock("@/components/coordinator-section-heading", () => ({ CoordinatorSectionHeading: () => null }));
vi.mock("@/components/navigation-link", () => ({ NavigationLink: () => null }));
vi.mock("@/modules/tlt-directory/forms", () => ({ readTltFormsInbox: mocks.readTltFormsInbox, recordTltFormsInboxView: mocks.recordTltFormsInboxView, countTltFormsByPerson: mocks.countTltFormsByPerson }));
vi.mock("@/modules/tlt-directory/repository", () => ({ readTltDirectory: mocks.readTltDirectory, listTltLists: mocks.listTltLists, recordTltDirectoryView: mocks.recordTltDirectoryView }));
vi.mock("@/modules/club-forms/submissions", () => ({ getSubmissionForViewer: mocks.getSubmissionForViewer }));
vi.mock("@/modules/club-forms/csv", () => ({ buildClubFormsCsv: mocks.buildClubFormsCsv }));

import FormPage from "@/app/(public)/account/(portal)/area-clubs/tlt/forms/[submissionId]/page";
import InboxPage from "@/app/(public)/account/(portal)/area-clubs/tlt/forms/page";
import DirectoryPage from "@/app/(public)/account/(portal)/area-clubs/tlt/page";
import { GET as EXPORT } from "@/app/api/attendee/area-clubs/tlt-directory/forms/export/route";
import { currentTltFormsViewer } from "@/modules/tlt-directory/access";

const attendee = { account: { id: "account-1" }, via: "attendee", sessionId: "s1" };
const none = { account: null, via: null, sessionId: null };
const grantOn = { revokedAt: null, expiresAt: null, tltDirector: true };

const roles: Record<string, () => void> = {
  "an Area Coordinator with the setting on but no second step": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(grantOn); mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY"); },
  // A disabled or unverified account never comes back from the sign-in lookup, whatever grant it holds.
  "an Area Coordinator with the setting on but an inactive account": () => { mocks.getCurrentAttendee.mockResolvedValue(none); mocks.grantFindUnique.mockResolvedValue(grantOn); },
  "an Area Coordinator whose role was removed": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grantOn, revokedAt: new Date("2026-11-01T00:00:00Z") }); },
  "an ordinary Area Coordinator": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grantOn, tltDirector: false }); },
  "staff acting as an Area Coordinator": () => { mocks.getCurrentAttendee.mockResolvedValue(none); mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" }); },
  "the club's director": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(null); },
  "another club's director": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(null); },
  "a Clubs Administrator": () => { mocks.getCurrentAttendee.mockResolvedValue(none); mocks.getCurrentSession.mockResolvedValue({ user: { id: "ca-1", globalRole: null }, sessionId: "s" }); },
  "a system administrator": () => { mocks.getCurrentAttendee.mockResolvedValue(none); mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" }, sessionId: "s" }); },
  "a signed-out visitor": () => { mocks.getCurrentAttendee.mockResolvedValue(none); },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T16:00:00Z"));
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.getCurrentSession.mockResolvedValue({ user: null, sessionId: null });
  mocks.grantFindUnique.mockResolvedValue(null);
  mocks.readTltFormsInbox.mockResolvedValue({ rows: [], total: 0, page: 1, pageCount: 1, pageSize: 25, forms: [], clubs: [] });
  mocks.getSubmissionForViewer.mockResolvedValue({ id: "sub-1" });
  mocks.buildClubFormsCsv.mockResolvedValue({ csv: "Form\r\n", filename: "club_tlt_application.csv" });
  mocks.readTltDirectory.mockResolvedValue({ total: 0, clubs: [], rows: [{ personId: "p1" }] });
  mocks.listTltLists.mockResolvedValue({ positions: [], tags: [] });
  mocks.countTltFormsByPerson.mockResolvedValue(new Map());
});

describe("the TLT forms pages and CSV (#1686)", () => {
  it.each(Object.entries(roles))("answer not found for %s, reading and recording nothing", async (_who, setup) => {
    setup();
    await expect(InboxPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(FormPage({ params: Promise.resolve({ submissionId: "sub-1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    const response = await EXPORT(new Request("https://events.imsda.test/api/attendee/area-clubs/tlt-directory/forms/export?form=club_tlt_application"));
    expect(response.status).toBe(404);
    expect(mocks.readTltFormsInbox).not.toHaveBeenCalled();
    expect(mocks.recordTltFormsInboxView).not.toHaveBeenCalled();
    expect(mocks.getSubmissionForViewer).not.toHaveBeenCalled();
    expect(mocks.buildClubFormsCsv).not.toHaveBeenCalled();
  });

  it.each(Object.entries(roles))("give %s no form links on the directory", async (_who, setup) => {
    setup();
    await expect(DirectoryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.countTltFormsByPerson).not.toHaveBeenCalled();
  });

  it("builds the viewer for the TLT director and for nobody else", async () => {
    roles["an ordinary Area Coordinator"]!();
    await expect(currentTltFormsViewer()).resolves.toBeNull();
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.grantFindUnique.mockResolvedValue(grantOn);
    await expect(currentTltFormsViewer()).resolves.toEqual({ kind: "TLT_DIRECTOR", accountId: "account-1" });
  });

  it("opens the inbox, a form, the CSV and the directory links for the TLT director, each as that viewer", async () => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.grantFindUnique.mockResolvedValue(grantOn);
    const viewer = { kind: "TLT_DIRECTOR", accountId: "account-1" };
    await expect(InboxPage({ searchParams: Promise.resolve({ q: "riley", page: "2", form: "club_tlt_application" }) })).resolves.toBeTruthy();
    expect(mocks.readTltFormsInbox).toHaveBeenCalledWith(viewer, expect.objectContaining({ q: "riley", form: "club_tlt_application" }), 2);
    expect(mocks.recordTltFormsInboxView).toHaveBeenCalledTimes(1);
    await expect(FormPage({ params: Promise.resolve({ submissionId: "sub-1" }) })).resolves.toBeTruthy();
    expect(mocks.getSubmissionForViewer).toHaveBeenCalledWith(viewer, "sub-1", "VIEW");
    const response = await EXPORT(new Request("https://events.imsda.test/api/attendee/area-clubs/tlt-directory/forms/export?form=club_tlt_application&club=club-a"));
    expect(response.status).toBe(200);
    expect(mocks.buildClubFormsCsv).toHaveBeenCalledWith(viewer, { templateKey: "club_tlt_application", organizationId: "club-a" });
    await expect(DirectoryPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    expect(mocks.countTltFormsByPerson).toHaveBeenCalledWith(viewer, ["p1"]);
  });

  it("shows a missing or other form as not found, not as an error", async () => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.grantFindUnique.mockResolvedValue(grantOn);
    const { ClubFormError } = await import("@/modules/club-forms/errors");
    mocks.getSubmissionForViewer.mockRejectedValue(new ClubFormError("SUBMISSION_NOT_FOUND", "That form could not be found."));
    await expect(FormPage({ params: Promise.resolve({ submissionId: "sub-of-another-form" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
