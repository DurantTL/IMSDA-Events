import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClubRosterWorkspace, type RosterComplianceInfo } from "@/components/club-roster-workspace";
import {
  duplicateRosterNameKeys,
  ROSTER_DETAILS_NEEDED_FILTER,
  matchesRosterSearch,
  normalizeRosterSearch,
  rosterColumns,
  rosterDetailsNeededItems,
  rosterDetailsSummary,
  rosterDetailsNeeded,
  rosterPersonLabel,
  rosterRowTools,
} from "@/modules/club-rosters/roster-view";
import { rosterRowMissingFields } from "@/modules/club-rosters/domain";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

/**
 * Director portal slice 3 (#1167): roster search, the Details needed filter, labelled Edit and Actions, and the
 * per-role columns. This environment renders React without a DOM, so the rules live in pure functions that are
 * tested directly, and the initial-render markup is asserted for what each role sees. Synthetic data only.
 */

function member(id: string, overrides: Partial<RosterMemberRecord> = {}): RosterMemberRecord {
  return {
    id,
    firstName: "Sam",
    lastName: `Fixture-${id}`,
    attendeeType: "YOUTH",
    role: "Pathfinder",
    classLevel: "FRIEND",
    gender: "FEMALE",
    status: "ACTIVE",
    source: "DIRECTOR",
    age: 12,
    reportedAge: null,
    birthDateNeeded: false,
    updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
    ...overrides,
  } as RosterMemberRecord;
}

function html(props: Partial<Parameters<typeof ClubRosterWorkspace>[0]> = {}) {
  return renderToStaticMarkup(createElement(ClubRosterWorkspace, {
    canSeeBirthDates: false,
    clubYear: "2026-27",
    initialMembers: [member("a"), member("b", { gender: null, classLevel: null })],
    organizationId: "org-1",
    ...props,
  }));
}

describe("name search (#1167)", () => {
  const sam = { firstName: "Sam", lastName: "Rivers" };

  it("matches first or last name, either order, with any case, spacing, comma or accent", () => {
    for (const query of ["sam", "RIVERS", "rivers sam", "Rivers, Sam", "  sam   rivers ", "riv", "Sá"]) {
      expect(matchesRosterSearch(sam, query)).toBe(true);
    }
  });

  it("needs every typed word to match, and a blank search matches everyone", () => {
    expect(matchesRosterSearch(sam, "sam taylor")).toBe(false);
    expect(matchesRosterSearch(sam, "zzz")).toBe(false);
    expect(matchesRosterSearch(sam, "   ")).toBe(true);
    expect(matchesRosterSearch(sam, "")).toBe(true);
  });

  it("handles accents, apostrophes and hyphens in long names", () => {
    const long = { firstName: "Zoë-Marie", lastName: "O'Neil-Smythe de la Fuente-Montgomery" };
    expect(normalizeRosterSearch("Zoë  O'Neil,")).toBe("zoe oneil");
    expect(matchesRosterSearch(long, "zoe marie")).toBe(true);
    expect(matchesRosterSearch(long, "oneil montgomery")).toBe(true);
    expect(matchesRosterSearch(long, "smith")).toBe(false);
  });

  it("finds both people who share a name", () => {
    const twins = [{ firstName: "Sam", lastName: "Rivers" }, { firstName: "Sam", lastName: "Rivers" }, { firstName: "Alex", lastName: "Rivers" }];
    expect(twins.filter((person) => matchesRosterSearch(person, "sam rivers"))).toHaveLength(2);
  });
});

describe("Details needed (#1167)", () => {
  it("lists what is missing and names it on the row, leaving an active person's birth date to the banner", () => {
    const needy = member("n", { gender: null, classLevel: null, birthDateNeeded: true });
    expect(rosterDetailsNeededItems(needy)).toEqual(["Gender", "Current class"]);
    expect(rosterDetailsSummary(["Gender", "Current class"])).toBe("Needs gender, current class");
    expect(rosterDetailsSummary([])).toBe("");
  });

  it("is the roster's own missing-detail rule, so a Home count and the filtered roster agree", () => {
    const cases = [
      member("ok"),
      member("birth", { birthDateNeeded: true }),
      member("inactive-birth", { birthDateNeeded: true, status: "INACTIVE" }),
      member("gender", { gender: null }),
      member("adult", { attendeeType: "ADULT", role: "", classLevel: null }),
    ];
    for (const person of cases) expect(rosterDetailsNeeded(person)).toBe(rosterRowMissingFields(person).length > 0);
    expect(cases.filter(rosterDetailsNeeded).map((person) => person.id)).toEqual(["inactive-birth", "gender"]);
  });

  it("applies the same rules to the count and to the rows (one population)", () => {
    const people = [member("1"), member("2", { gender: null }), member("3", { classLevel: null }), member("4", { attendeeType: "ADULT", role: "", classLevel: null })];
    const count = people.filter((person) => rosterDetailsNeeded(person)).length;
    const rows = people.filter((person) => matchesRosterSearch(person, "") && rosterDetailsNeeded(person));
    expect(rows).toHaveLength(count);
    expect(count).toBe(2);
  });
});

describe("columns per role (#1167)", () => {
  const base = { birthDatesShown: false, moreColumns: false, hasScreening: false, hasRowActions: true };

  it("leads with Name, Age, Type, Current class and Details", () => {
    expect(rosterColumns({ ...base, hasRowActions: false })).toEqual(["name", "age", "type", "class", "details"]);
  });

  it("adds Gender only on request, the birth date only after its reveal, screening only where the role has it", () => {
    expect(rosterColumns({ ...base, moreColumns: true })).toEqual(["name", "age", "type", "class", "details", "gender", "actions"]);
    expect(rosterColumns({ ...base, birthDatesShown: true, hasScreening: true })).toEqual(["name", "age", "birthDate", "type", "class", "details", "screening", "actions"]);
    expect(rosterColumns(base)).not.toContain("birthDate");
    expect(rosterColumns(base)).not.toContain("screening");
  });

  it("renders no birth date column and no screening column for a registrar-like viewer", () => {
    const out = html();
    expect(out).not.toContain(">Birth date<");
    expect(out).not.toContain("Sterling Volunteers");
    expect(out).not.toContain("<th>Gender</th>");
    expect(out).toContain("<th>Details</th>");
    expect(out).toContain("<th>Actions</th>");
  });

  it("shows screening for a role that is given it, and still no birth date until revealed", () => {
    const complianceStatuses: Record<string, RosterComplianceInfo> = { a: { state: "CLEAR", note: null }, b: { state: "NO_RECORD", note: null } };
    const out = html({ complianceStatuses });
    expect(out).toContain("<th>Sterling Volunteers</th>");
    expect(out).not.toContain(">Birth date<");
  });
});

describe("row tools per role (#1167)", () => {
  const none = { hasHonors: false, hasHealthLink: false, hasHealthOnFileNote: false, canEditContacts: false };

  it("gives an editable row a visible Edit and an Actions menu with Remove last", () => {
    expect(rosterRowTools({ ...none, readOnly: false, hasHonors: true, hasHealthLink: true })).toEqual({
      primary: "edit", honorsButton: false, menu: ["honors", "health", "remove"],
    });
    expect(rosterRowTools({ ...none, readOnly: false, hasHealthOnFileNote: true }).menu).toEqual(["healthOnFile", "remove"]);
  });

  it("gives a read-only row no Edit, no Remove and no menu", () => {
    expect(rosterRowTools({ ...none, readOnly: true })).toEqual({ primary: null, honorsButton: false, menu: [] });
    expect(rosterRowTools({ ...none, readOnly: true, hasHonors: true, hasHealthLink: true })).toEqual({ primary: null, honorsButton: true, menu: [] });
  });

  it("keeps next year's emergency contacts as the one labelled task", () => {
    expect(rosterRowTools({ ...none, readOnly: true, canEditContacts: true })).toEqual({ primary: "contacts", honorsButton: false, menu: [] });
  });

  it("renders Edit and Actions for the editable page, with a person-specific name on each", () => {
    const out = html({ honorsPopup: { canRecord: true } });
    expect(out).toContain('aria-label="Edit Sam Fixture-a"');
    expect(out).toMatch(/<svg[^>]*>.*?<\/svg> Edit<\/button>/);
    expect(out).toContain('aria-label="Actions for Sam Fixture-a"');
    expect(out).toContain('aria-label="Honors for Sam Fixture-a"');
    expect(out).toContain('aria-label="Remove Sam Fixture-a"');
    expect(out).toContain("actions-menu-danger");
  });

  it("renders nothing editable for a read-only roster", () => {
    const out = html({ readOnly: true });
    expect(out).not.toContain("Edit Sam");
    expect(out).not.toContain("Remove Sam");
    expect(out).not.toContain("Actions for");
    expect(out).not.toContain("actions-menu");
    expect(out).not.toContain("Add to roster");
    expect(out).not.toContain("<th>Actions</th>");
  });

  it("offers the read-only staff view Honors as a plain button, not an Actions menu", () => {
    const out = html({ readOnly: true, honorsHref: "/admin/organizations/org-1/club/honors" });
    expect(out).toContain('href="/admin/organizations/org-1/club/honors"');
    expect(out).toContain('aria-label="Honors for Sam Fixture-a"');
    expect(out).not.toContain("actions-menu");
    expect(out).not.toContain("Edit Sam");
  });

  it("offers next year's director only Emergency contacts", () => {
    const out = html({ readOnly: true, guardiansOnly: true, guardians: {} });
    expect(out).toContain('aria-label="Emergency contacts for Sam Fixture-a"');
    expect(out).not.toContain("Remove Sam");
    expect(out).not.toContain("Actions for");
  });

  it("puts Health in the Actions menu with its status, and the registrar's on-file note there as text", () => {
    const out = html({ healthTab: { a: { status: "NONE", hasHealthNote: false }, b: { status: "CURRENT", hasHealthNote: false } }, healthEntryOnly: true });
    expect(out).toContain("Enter health record: none yet");
    expect(out).toContain("/account/clubs/org-1/roster/a/health");
    expect(out).not.toContain("/account/clubs/org-1/roster/b/health");
    expect(out.match(/A health record is on file; the director or a deputy can update it\./g)).toHaveLength(1);
  });
});

describe("what a row says (#1167)", () => {
  it("names the missing details in a Details cell instead of a Missing info pill wall", () => {
    const out = html();
    expect(out).toContain('data-label="Details"');
    expect(out).toContain("Needs gender, current class");
    expect(out).not.toContain("Missing info");
  });

  it("keeps a person's role under their name, so a phone card shows name, role, age and Edit", () => {
    const out = html();
    expect(out).toContain('<span class="roster-member-role" translate="no">Pathfinder</span>');
    expect(out).toContain('data-label="Age"');
    expect(out).toContain('aria-label="Edit Sam Fixture-a"');
  });

  it("says nothing is needed in text, not only with a dash", () => {
    expect(html({ initialMembers: [member("a")] })).toContain('<span class="sr-only">Nothing needed</span>');
  });

  it("does not bring back birthday pills for a person missing a birth date", () => {
    const out = html({ initialMembers: [member("a", { birthDateNeeded: true })] });
    expect(out).toContain("1 person needs a birth date");
    expect(out).not.toContain("Needs birth date");
    expect(out).not.toContain("birthday");
  });

  it("shows many Honors as one button, never a wall of pills", () => {
    const out = html({ honorsPopup: { canRecord: true }, initialMembers: [member("a")] });
    expect(out.match(/Honors for/g)).toHaveLength(1);
    expect(out).not.toContain("honor-pill");
  });
});

describe("search panel (#1167)", () => {
  it("labels the search, describes Details needed and reports the count in a polite status", () => {
    const out = html();
    expect(out).toMatch(/<label class="roster-search-field" for="roster-search">Search roster/);
    expect(out).toContain('id="roster-search"');
    expect(out).toContain('type="search"');
    expect(out).toMatch(/autocomplete="off"/i);
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-describedby="roster-details-help"');
    expect(out).toContain("<strong>2 of 2</strong> people shown");
    expect(out).toContain('aria-live="polite"');
    // Nothing is filtered yet, so there is nothing to reset.
    expect(out).not.toContain("Clear filters");
  });

  it("shows an empty filter result with a reset, not the Add to roster prompt", () => {
    const statuses: Record<string, RosterComplianceInfo> = { a: { state: "CLEAR", note: null }, b: { state: "CLEAR", note: null } };
    const out = html({ complianceStatuses: statuses, complianceFilter: "missing" });
    expect(out).toContain("No one matches this filter");
    expect(out).toContain("Clear filters");
    expect(out).not.toContain("No one is on the roster yet");
    expect(out).toContain("<strong>0 of 2</strong>");
  });

  it("keeps the real empty roster message when nobody is on it", () => {
    const out = html({ initialMembers: [] });
    expect(out).toContain("No one is on the roster yet");
    expect(out).toContain("<strong>0 of 0</strong>");
  });

  it("has one filled primary button on the page: Add to roster", () => {
    const out = html({ honorsPopup: { canRecord: true } });
    expect(out.match(/class="primary-button"/g)).toHaveLength(1);
  });
});

describe("long and duplicate names (#1167)", () => {
  const people = [member("a", { firstName: "Sam", lastName: "Rivers", age: 12 }), member("b", { firstName: "Sam", lastName: "Rivers", age: 13 }), member("c", { firstName: "Alex", lastName: "Rivers" })];

  it("tells two people with one name apart in every control's accessible name", () => {
    const duplicates = duplicateRosterNameKeys(people);
    expect(duplicates.size).toBe(1);
    const labels = people.map((person) => rosterPersonLabel({ ...person, typeLabel: "Pathfinder" }, duplicates));
    expect(labels).toEqual(["Sam Rivers, age 12", "Sam Rivers, age 13", "Alex Rivers"]);
    const out = html({ initialMembers: people });
    expect(out).toContain('aria-label="Edit Sam Rivers, age 12"');
    expect(out).toContain('aria-label="Edit Sam Rivers, age 13"');
    expect(out).toContain('aria-label="Edit Alex Rivers"');
  });

  it("falls back to the type when a duplicate has no age", () => {
    const duplicates = duplicateRosterNameKeys([{ firstName: "A", lastName: "B" }, { firstName: "a", lastName: "b" }]);
    expect(rosterPersonLabel({ firstName: "A", lastName: "B", age: null, reportedAge: null, typeLabel: "Adult" }, duplicates)).toBe("A B, Adult");
  });

  it("lets a very long name wrap inside its card instead of widening the page", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/\.roster-member-name \{ overflow-wrap: anywhere; \}/);
    // The Details column keeps room for a whole word, so the summary wraps between words, never inside one.
    expect(css).toMatch(/\.roster-card-table td\.roster-card-flags \{ min-width: 10rem; \}/);
    const long = "Maximilian-Alexander-Bartholomew-Fitzgerald-Montgomery-Wellington";
    expect(html({ initialMembers: [member("a", { lastName: long })] })).toContain(long);
  });
});

describe("Remove, the editor and the shared menu are reused, not rebuilt (#1167)", () => {
  const source = readFileSync(path.join(process.cwd(), "components/club-roster-workspace.tsx"), "utf8");

  it("keeps the exact erase confirmation, including the mark-inactive option", () => {
    expect(source).toContain("Remove ${member.firstName} ${member.lastName} from the roster");
    expect(source).toContain("Their birth date and details are erased. This can&apos;t be undone. To keep them on file, mark them inactive instead.");
    expect(source).toContain('"DELETE", { confirm: true }, "Removed and erased."');
    // Inactive stays a separate, confirmed action inside the editor.
    expect(source).toContain("confirmSetStatus(editing)");
  });

  it("uses the shared ActionsMenu and the existing editor dialog", () => {
    expect(source).toContain('import { ActionsMenu } from "@/components/actions-menu";');
    expect(source).toMatch(/useAccessibleDialog<HTMLElement>\(dialogOpen,\s*requestClose\)/);
    expect(source.match(/onClick=\{\(\) => void requestClose\(\)\}/g)).toHaveLength(2);
  });

  it("does not add a birth date column to the default table or restore birthday pills", () => {
    expect(source).not.toMatch(/birthday/i);
  });
});

describe("?filter=details-needed opens the filtered roster (#1167)", () => {
  it("renders only the people who need details, with the filter on and a reset offered", () => {
    const out = html({
      detailsNeededFirst: true,
      initialMembers: [member("done"), member("needy", { gender: null })],
    });
    expect(out).toContain("Fixture-needy");
    expect(out).not.toContain("Fixture-done");
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain("<strong>1 of 2</strong>");
    expect(out).toContain("Clear filters");
  });

  it("is wired from the page's single filter value and nothing else", () => {
    const page = readFileSync(path.join(process.cwd(), "app/(public)/account/(portal)/clubs/[organizationId]/roster/page.tsx"), "utf8");
    expect(page).toContain("detailsNeededFirst={filterParam === ROSTER_DETAILS_NEEDED_FILTER}");
    expect(ROSTER_DETAILS_NEEDED_FILTER).toBe("details-needed");
  });
});
