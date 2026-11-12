import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  grantFindUnique: vi.fn(),
  getCurrentAttendee: vi.fn(),
  accountNeedsSecondStep: vi.fn(),
  readTltDirectory: vi.fn(),
  listTltLists: vi.fn(),
  recordTltDirectoryView: vi.fn(),
  recordTltMoveUpView: vi.fn(),
  readTltMoveUp: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ areaCoordinatorGrant: { findUnique: mocks.grantFindUnique } }) }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({ getCurrentAttendee: mocks.getCurrentAttendee, findSwitchableAttendeeAccountForStaff: vi.fn() }));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: mocks.accountNeedsSecondStep }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/tlt-directory", () => ({ TltDirectory: () => null }));
vi.mock("@/components/tlt-move-up", () => ({ TltMoveUp: () => null }));
vi.mock("@/components/tlt-lists-editor", () => ({ TltListsEditor: () => null }));
vi.mock("@/components/coordinator-section-heading", () => ({ CoordinatorSectionHeading: () => null }));
vi.mock("@/components/navigation-link", () => ({ NavigationLink: () => null }));
vi.mock("@/modules/tlt-directory/forms", () => ({ countTltFormsByPerson: vi.fn(async () => new Map()) }));
vi.mock("@/modules/tlt-directory/repository", () => ({ readTltDirectory: mocks.readTltDirectory, listTltLists: mocks.listTltLists, recordTltDirectoryView: mocks.recordTltDirectoryView, readTltMoveUp: mocks.readTltMoveUp, recordTltMoveUpView: mocks.recordTltMoveUpView }));

import ListsPage from "@/app/(public)/account/(portal)/area-clubs/tlt/lists/page";
import MoveUpPage from "@/app/(public)/account/(portal)/area-clubs/tlt/move-up/page";
import DirectoryPage from "@/app/(public)/account/(portal)/area-clubs/tlt/page";

const attendee = { account: { id: "account-1" }, via: "attendee", sessionId: "s1" };
const grant = { revokedAt: null, expiresAt: null, tltDirector: true };

const roles: Record<string, () => void> = {
  "an ordinary Area Coordinator": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grant, tltDirector: false }); },
  "a club director": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(null); },
  "staff acting as an Area Coordinator": () => { mocks.getCurrentAttendee.mockResolvedValue({ account: null, via: null, sessionId: null }); },
  "a TLT director without the second step": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue(grant); mocks.accountNeedsSecondStep.mockResolvedValue("VERIFY"); },
  "an Area Coordinator whose role was removed": () => { mocks.getCurrentAttendee.mockResolvedValue(attendee); mocks.grantFindUnique.mockResolvedValue({ ...grant, revokedAt: new Date("2026-11-01T00:00:00Z") }); },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountNeedsSecondStep.mockResolvedValue("OK");
  mocks.readTltDirectory.mockResolvedValue({ total: 0, clubs: [], rows: [] });
  mocks.listTltLists.mockResolvedValue({ positions: [], tags: [] });
  mocks.readTltMoveUp.mockResolvedValue({ clubYear: "2026-27", proposed: [], lastLevel: [], notSet: [], alreadyThisYear: 0 });
});

describe("the TLT directory pages (#1686)", () => {
  it.each(Object.entries(roles))("answer not found for %s, without reading any TLT", async (_who, setup) => {
    setup();
    await expect(DirectoryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ListsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(MoveUpPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.readTltMoveUp).not.toHaveBeenCalled();
    expect(mocks.recordTltMoveUpView).not.toHaveBeenCalled();
    expect(mocks.readTltDirectory).not.toHaveBeenCalled();
    expect(mocks.recordTltDirectoryView).not.toHaveBeenCalled();
    expect(mocks.listTltLists).not.toHaveBeenCalled();
  });

  it("show the directory and the lists to the TLT director", async () => {
    mocks.getCurrentAttendee.mockResolvedValue(attendee);
    mocks.grantFindUnique.mockResolvedValue(grant);
    await expect(DirectoryPage({ searchParams: Promise.resolve({ q: "casey", page: "2" }) })).resolves.toBeTruthy();
    await expect(ListsPage()).resolves.toBeTruthy();
    await expect(MoveUpPage()).resolves.toBeTruthy();
    expect(mocks.readTltMoveUp).toHaveBeenCalledTimes(1);
    expect(mocks.recordTltMoveUpView).toHaveBeenCalledTimes(1);
    expect(mocks.readTltDirectory).toHaveBeenCalledTimes(1);
    // One audit row per view, with the search text only as a filter key.
    expect(mocks.recordTltDirectoryView).toHaveBeenCalledTimes(1);
    expect(mocks.recordTltDirectoryView.mock.calls[0]![1]).toEqual({ accountId: "account-1" });
  });
});

describe("retiring on the lists page (#1686, site rule B9)", () => {
  const source = readFileSync("components/tlt-lists-editor.tsx", "utf8");

  it("asks in the shared confirm dialog first, and only Confirm sends the retire", () => {
    expect(source).toContain('import { ConfirmDialog } from "@/components/confirm-dialog"');
    expect(source).not.toMatch(/window\.(confirm|prompt)/);
    // The Retire button only opens the dialog; "retire" is sent from the dialog's onConfirm.
    expect(source).toMatch(/onConfirm=\{\(\) => void run\("retire", \{ action: "retire"/);
    expect(source.match(/action: "retire"/g)).toHaveLength(1);
    expect(source).toMatch(/setConfirming\(true\)/);
    // Restoring is not a loss, so it needs no confirmation.
    expect(source).toMatch(/action: "restore"/);
  });
});

describe("suggested tags keep focus and the saved message (#1686, B10)", () => {
  it("keeps a polite live region on the row when no suggestion is left, so 'Saved.' is not lost with the last button", async () => {
    const { TltTagSuggestions } = await import("@/components/tlt-tag-suggestions");
    const none = renderToStaticMarkup(createElement(TltTagSuggestions, { personId: "p1", suggestions: [] }));
    expect(none).toContain('aria-live="polite"');
    expect(none).toContain('role="status"');
    expect(none).not.toContain("<button");
    const some = renderToStaticMarkup(createElement(TltTagSuggestions, { personId: "p1", suggestions: [{ id: "t1", name: "Games" }] }));
    expect(some).toContain("Add Games");
    expect(some).toContain('aria-live="polite"');
  });

  it("is drawn for every row, and focus goes to the next button or the row's tags", () => {
    const directory = readFileSync("components/tlt-directory.tsx", "utf8");
    expect(directory).toMatch(/<TltTagSuggestions personId=\{row\.personId\} suggestions=\{row\.suggestedTags\} \/>/);
    expect(directory).toContain("id={`tlt-tags-${row.personId}`} tabIndex={-1}");
    const component = readFileSync("components/tlt-tag-suggestions.tsx", "utf8");
    expect(component).toContain("document.getElementById(`tlt-tags-${personId}`)");
    expect(component).toContain("moveFocus.current = true");
  });
});

describe("the move-up page (#1686, site rules B9 and B10)", () => {
  const source = readFileSync("components/tlt-move-up.tsx", "utf8");

  it("asks in the shared confirm dialog with the count, and only Confirm sends the move", () => {
    expect(source).toContain('import { ConfirmDialog } from "@/components/confirm-dialog"');
    expect(source).not.toMatch(/window\.(confirm|prompt)/);
    expect(source.match(/fetch\(/g)).toHaveLength(1);
    expect(source).toMatch(/onConfirm=\{\(\) => void confirm\(\)\}/);
    expect(source).toContain("and keep ${kept.length} at their current year");
    expect(source).toContain("yearLabel(plan.clubYear)");
    expect(source).toContain("keepIds: kept.map");
  });

  it("announces the result in a polite live region and moves focus to it", () => {
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain("resultRef.current?.focus()");
  });

  it("starts with every proposed TLT ticked and sends the club year the page showed", () => {
    expect(source).toContain("checked={!unchecked.has(row.personId)}");
    expect(source).toContain("clubYear: plan.clubYear");
  });
});
