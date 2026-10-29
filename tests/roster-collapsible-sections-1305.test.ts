import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { rosterRowTools, rosterSectionsStartClosed, rosterSectionStorageKey } from "@/modules/club-rosters/roster-view";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";

/** Roster row actions and collapsible Staff and Members sections (#1305). Synthetic data only. */

const member = (overrides: Partial<RosterMemberRecord>): RosterMemberRecord => ({
  id: "m1", firstName: "Pat", lastName: "Pathfinder", attendeeType: "YOUTH", role: "Member", classLevel: "FRIEND",
  gender: "FEMALE", status: "ACTIVE", source: "DIRECTOR", age: 12, reportedAge: null, birthDateNeeded: false,
  updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(), ...overrides,
} as RosterMemberRecord);
const people = [
  member({}),
  member({ id: "s1", firstName: "Sam", lastName: "Sample", attendeeType: "STAFF", role: "Counselor" } as Partial<RosterMemberRecord>),
];
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ClubRosterWorkspace, {
  canSeeBirthDates: false, clubYear: "2026", initialMembers: people, organizationId: "org-1", ...props,
} as never));

describe("which roles start with the sections closed", () => {
  it("closes them for the director and registrar only", () => {
    expect(rosterSectionsStartClosed("DIRECTOR")).toBe(true);
    expect(rosterSectionsStartClosed("REGISTRAR")).toBe(true);
    expect(rosterSectionsStartClosed("DEPUTY")).toBe(false);
    expect(rosterSectionsStartClosed("REPORTER")).toBe(false);
    expect(rosterSectionsStartClosed(null)).toBe(false);
    expect(rosterSectionsStartClosed(undefined)).toBe(false);
  });

  it("scopes the remembered choice to the club and the section", () => {
    expect(rosterSectionStorageKey("org-1", "STAFF")).not.toBe(rosterSectionStorageKey("org-1", "MEMBERS"));
    expect(rosterSectionStorageKey("org-1", "STAFF")).not.toBe(rosterSectionStorageKey("org-2", "STAFF"));
  });
});

describe("collapsible sections markup", () => {
  it("renders Staff and Members as their own details with the name and count in the summary", () => {
    const html = render();
    const sections = html.match(/<details[^>]*data-roster-section="[A-Z]+"/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(html).toMatch(/<summary[^>]*>[\s\S]*?Staff<\/span> <span class="count-badge">1<\/span><\/summary>/);
    expect(html).toMatch(/<summary[^>]*>[\s\S]*?Members<\/span> <span class="count-badge">1<\/span><\/summary>/);
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain('aria-labelledby="roster-section-staff-title"');
    expect(html).toContain('id="roster-section-staff-title"');
    // A table cannot hold a details element, and the old shared row-group headings are gone.
    expect(html).not.toContain('scope="rowgroup"');
  });

  it("opens both sections by default and closes them when told to; rows are still rendered", () => {
    const open = render();
    expect(open.match(/<details[^>]* open=""/g)).toHaveLength(2);
    const closed = render({ sectionsStartClosed: true });
    expect(closed).not.toMatch(/<details[^>]* open=""/);
    expect(closed).toContain("Pathfinder, Pat");
  });

  it("keeps the empty-section message", () => {
    const html = render({ initialMembers: [people[0]] });
    expect(html).toContain("No staff on the roster yet.");
  });
});

describe("row actions (#1305)", () => {
  it("shows a visible Edit word with a person-specific name, and Remove only inside the Actions menu", () => {
    const html = render();
    expect(html).toContain('aria-label="Edit Pat Pathfinder"');
    expect(html).toMatch(/aria-label="Edit Pat Pathfinder"[^>]*>[\s\S]*?<\/svg> Edit<\/button>/);
    expect(html).toContain("Actions for Pat Pathfinder");
    const menuStart = html.indexOf("Actions for Pat Pathfinder");
    const remove = html.indexOf('aria-label="Remove Pat Pathfinder"');
    expect(remove).toBeGreaterThan(menuStart);
    // The only Remove button sits behind the menu's divider, never beside Edit.
    expect(html.slice(html.lastIndexOf("<li", remove), remove)).toContain("actions-menu-divider");
  });

  it("gives a read-only view no Edit or Remove", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("Edit Pat Pathfinder");
    expect(html).not.toContain("Remove Pat Pathfinder");
    expect(html).not.toContain("Actions for");
  });

  it("offers Remove only in the menu of an editable row", () => {
    const none = { canEditContacts: false, hasHonors: false, hasHealthLink: false, hasHealthOnFileNote: false };
    const editable = rosterRowTools({ ...none, readOnly: false });
    expect(editable.primary).toBe("edit");
    expect(editable.menu).toContain("remove");
    const view = rosterRowTools({ ...none, readOnly: true });
    expect(view.primary).toBeNull();
    expect(view.menu).toEqual([]);
  });
});

describe("section styles", () => {
  const css = readFileSync(path.join(process.cwd(), "components/club-roster-sections.module.css"), "utf8");
  it("makes the summary a 44px target at the staff text floor with a focus ring", () => {
    expect(css).toMatch(/\.summary \{[^}]*min-height: 44px/);
    expect(css).toContain("max(var(--type-staff-floor, 0px), 0.875rem)");
    expect(css).toContain(".summary:focus-visible");
  });
});
