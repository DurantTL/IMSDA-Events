import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1686 part 2b: a TLT's row links to that TLT's submitted forms only where a form is tied to the person by an id (the
 * roster member it was filled in for, or added to), never by a typed name. Synthetic people only.
 */

const mocks = vi.hoisted(() => ({ submissionFindMany: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ clubFormSubmission: { findMany: mocks.submissionFindMany } }) }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/tlt-row-editor", () => ({ TltRowEditor: () => null }));
vi.mock("@/components/tlt-tag-suggestions", () => ({ TltTagSuggestions: () => null }));
vi.mock("@/components/tlt-export-button", () => ({ TltExportButton: () => null }));
vi.mock("@/components/tlt-print-button", () => ({ TltPrintButton: () => null }));
vi.mock("@/components/search-as-you-type", () => ({ SearchAsYouTypeForm: ({ children }: { children: unknown }) => createElement("form", null, children as never), SearchResultStatus: () => null }));
vi.mock("@/components/navigation-link", () => ({ NavigationLink: ({ href, className, children }: { href: string; className?: string; children: unknown }) => createElement("a", { className, href }, children as never) }));

import { TltDirectory } from "@/components/tlt-directory";
import type { ClubFormsViewer } from "@/modules/club-forms/domain";
import { countTltFormsByPerson } from "@/modules/tlt-directory/forms";

const director: ClubFormsViewer = { kind: "TLT_DIRECTOR", accountId: "acct-tlt" };
const row = (key: string, own: string | null, added: string | null = null, id = `s-${key}-${own}-${added}`) => ({
  id, template: { key }, rosterMember: own ? { personId: own } : null, rosterActionMember: added ? { personId: added } : null,
});

beforeEach(() => vi.resetAllMocks());

describe("which forms are tied to which TLT", () => {
  it("counts by id through the roster member, for each of the three forms", async () => {
    mocks.submissionFindMany.mockResolvedValue([
      row("club_tlt_application", "p1"),
      row("tlt_program_recommendation", "p1"),
      row("tlt_program_recommendation", "p1", null, "s-second-recommendation"),
      row("club_tlt_of_the_year", "p2"),
      row("club_tlt_application", null, "p3"),
    ]);
    const counts = await countTltFormsByPerson(director, ["p1", "p2", "p3", "p4"]);
    expect(counts.get("p1")).toEqual({ application: 1, recommendation: 2, ofTheYear: 0 });
    expect(counts.get("p2")).toEqual({ application: 0, recommendation: 0, ofTheYear: 1 });
    expect(counts.get("p3")).toEqual({ application: 1, recommendation: 0, ofTheYear: 0 });
    expect(counts.has("p4")).toBe(false);
  });

  it("asks only for submitted TLT forms tied by a roster member's person id, never by a name, and reads no answer", async () => {
    mocks.submissionFindMany.mockResolvedValue([]);
    await countTltFormsByPerson(director, ["p1"]);
    const call = mocks.submissionFindMany.mock.calls[0]![0];
    expect(call.where).toEqual({
      status: "SUBMITTED",
      template: { key: { in: ["club_tlt_application", "tlt_program_recommendation", "club_tlt_of_the_year"] } },
      OR: [{ rosterMember: { personId: { in: ["p1"] } } }, { rosterActionMember: { personId: { in: ["p1"] } } }],
    });
    expect(JSON.stringify(call)).not.toMatch(/subjectName|answers|contains/);
  });

  it("counts a form once for a person even when both ids point at them, and ignores people not on the page", async () => {
    mocks.submissionFindMany.mockResolvedValue([row("club_tlt_application", "p1", "p1"), row("club_tlt_application", "stranger")]);
    const counts = await countTltFormsByPerson(director, ["p1"]);
    expect(counts.get("p1")).toEqual({ application: 1, recommendation: 0, ofTheYear: 0 });
    expect(counts.size).toBe(1);
  });

  it("reads nothing for an empty page and refuses any viewer but the TLT director", async () => {
    await expect(countTltFormsByPerson(director, [])).resolves.toEqual(new Map());
    await expect(countTltFormsByPerson({ kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "a" } }, ["p1"])).rejects.toThrow("TLT director");
    expect(mocks.submissionFindMany).not.toHaveBeenCalled();
  });
});

describe("the directory row", () => {
  const person = (personId: string) => ({
    personId, rosterMemberId: `m-${personId}`, name: `Sample ${personId}`, clubId: "club-a", clubName: "Example Pathfinders", church: "", age: 15, reportedAge: null, grade: null,
    tltYear: null, positionTypeId: null, positionName: null, status: null, tags: [], suggestedTags: [], shirt: null,
  });
  const render = (links: Map<string, { application: number; recommendation: number; ofTheYear: number }>) => renderToStaticMarkup(createElement(TltDirectory, {
    slice: { items: [person("p1"), person("p2")], page: 1, pageCount: 1, total: 2, from: 1, to: 2 },
    total: 2, clubs: [], positions: [], tags: [],
    filters: { q: "", clubId: "", year: "", position: "", status: "", tag: "", sort: "name" },
    formLinks: links,
  } as never));

  it("links to that TLT's forms by person id, with counts, and only for a TLT that has one", () => {
    const html = render(new Map([["p1", { application: 1, recommendation: 2, ofTheYear: 0 }]]));
    expect(html).toContain('href="/account/area-clubs/tlt/forms?person=p1"');
    expect(html).toContain("1 application, 2 recommendations");
    expect(html).not.toContain("person=p2");
    // A full-size tap target, not a small inline link.
    expect(html).toMatch(/<a class="secondary-button" href="\/account\/area-clubs\/tlt\/forms\?person=p1"/);
    expect(html).toContain('href="/account/area-clubs/tlt/forms"');
    expect(html).not.toContain("Sample p1</a>");
  });

  it("draws no form link for a TLT with no tied form", () => {
    expect(render(new Map())).not.toContain("?person=");
  });
});
