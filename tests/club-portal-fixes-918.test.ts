import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Club portal fixes from the owner's iPad review (#918). Items: roster name prominence, Emergency contact
 * wording for every member (#510), the date field layout rules, the two item searches that must visibly filter, Orders
 * hidden from Area Coordinators (the server half is in the route tests), and the Team permissions intro.
 * Synthetic data only. The two search tests run the real components on a tiny hook runtime (no DOM here).
 */
const runtime = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const i = runtime.index++;
      if (!(i in runtime.slots)) runtime.slots[i] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        runtime.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(runtime.slots[i]) : next;
      };
      return [runtime.slots[i], set];
    },
    useMemo: (factory: () => unknown) => factory(),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: vi.fn(), redirect: vi.fn() }));

import { ClubEarnedAwardsWorkspace, emptyEarnedAwardsData } from "@/components/club-earned-awards-workspace";
import { ClubOrderWorkspace, type ClubOrderWorkspaceData } from "@/components/club-order-workspace";
import { ClubFormRosterAdd } from "@/components/club-form-roster-add";
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { RosterGuardianFields } from "@/components/roster-guardian-fields";
import { searchResultSummary } from "@/lib/search-match";
import { isAdultRosterPerson } from "@/modules/club-rosters/domain";
import { EMERGENCY_CONTACT_TERM } from "@/modules/club-rosters/guardians-domain";
import { areaClubPortalNavItems } from "@/modules/club-rosters/portal-nav";
import { ageLimitText, teamPermissionsIntro } from "@/modules/club-teams/permission-domain";
import type { RosterMemberRecord } from "@/modules/club-rosters/repository";
import type { ClubStockRow } from "@/modules/club-supplies/repository";

const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

type Props = Record<string, unknown> & { children?: ReactNode };
function walk(node: ReactNode, out: ReactElement<Props>[] = []) {
  if (Array.isArray(node)) { node.forEach((child) => walk(child, out)); return out; }
  if (!isValidElement<Props>(node)) return out;
  out.push(node);
  walk(node.props.children, out);
  return out;
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("") : isValidElement<Props>(node) ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
const byId = (tree: ReactNode, id: string) => walk(tree).find((el) => el.props.id === id)!;
const optionLabels = (select: ReactElement<Props>) => walk(select).filter((el) => el.type === "option").map((el) => text(el.props.children));
const type = (input: ReactElement<Props>, value: string) => (input.props.onChange as (event: unknown) => void)({ target: { value } });

beforeEach(() => { runtime.slots = []; runtime.index = 0; });

describe("1. roster: the name is the most prominent thing in the row", () => {
  const member: RosterMemberRecord = {
    id: "m1", personId: "person-1", firstName: "Pat", lastName: "Sample", attendeeType: "YOUTH", role: "", classLevel: "FRIEND", gender: null,
    status: "ACTIVE", source: "DIRECTOR", age: 11, reportedAge: null, birthDateNeeded: false, updatedAt: "2026-09-01T00:00:00.000Z",
  };
  it("renders the name first, in its own prominent element, with Class history after it as a link", () => {
    const html = renderToStaticMarkup(createElement(ClubRosterWorkspace, {
      clubYear: "2026-27", initialMembers: [member], organizationId: "club-1", canSeeBirthDates: false, classHistoryBase: "/account/clubs/club-1/class-tracking",
    } as never));
    const name = html.indexOf('class="roster-member-name"');
    const link = html.indexOf("roster-class-history-link");
    expect(name).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(name);
    expect(html).toContain("Sample, Pat</strong>");
  });
  it("styles the name larger and heavier than the link, on tablets and phones too", () => {
    const rule = (selector: string) => {
      const match = css.match(new RegExp(`${selector.replace(/[.\\[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
      expect(match, selector).not.toBeNull();
      return match![1]!;
    };
    const size = (body: string) => Number(/font-size:\s*max\(var\([^)]*\),\s*([\d.]+)rem\)/.exec(body)![1]);
    const weight = (body: string) => Number(/font-weight:\s*(\d+)/.exec(body)![1]);
    const name = rule(".roster-card-name .roster-member-name");
    const link = rule(".roster-card-name .roster-class-history-link");
    expect(size(name)).toBeGreaterThan(size(link) + 0.15);
    expect(weight(name)).toBeGreaterThan(weight(link));
    expect(link).toContain("underline");
    // The phone card keeps the same size (its old 0.9rem cell size must not shrink the name).
    expect(css).toMatch(/\.roster-card-table td\.roster-card-name\[data-label\] \{ font-size: max\(var\(--type-body-floor, 0px\), 1\.0625rem\); \}/);
  });
});

describe("2. the contact section reads Emergency contact for everyone (#510)", () => {
  it("still treats staff, adults, and anyone 18 or over as an adult", () => {
    expect(isAdultRosterPerson("STAFF")).toBe(true);
    expect(isAdultRosterPerson("ADULT")).toBe(true);
    expect(isAdultRosterPerson("YOUTH")).toBe(false);
    expect(isAdultRosterPerson("UNDERAGE", "2024-01-01", "2026-10-14")).toBe(false);
    expect(isAdultRosterPerson("YOUTH", "2008-10-14", "2026-10-14")).toBe(true);
    expect(isAdultRosterPerson("YOUTH", "2008-10-15", "2026-10-14")).toBe(false);
    expect(isAdultRosterPerson("YOUTH", "not a date", "2026-10-14")).toBe(false);
  });
  it("calls the contact an Emergency contact for everyone, never a Guardian", () => {
    expect(EMERGENCY_CONTACT_TERM).toEqual({ singular: "Emergency contact", plural: "Emergency contacts" });
  });

  const fields = () => renderToStaticMarkup(createElement(RosterGuardianFields, { errors: {}, guardianState: "ready", records: undefined }));
  it("words the roster dialog's contact section as Emergency contact, with no Guardian", () => {
    const html = fields();
    expect(html).toContain("<legend>Emergency contacts (optional)</legend>");
    expect(html).toContain("<h3>Emergency contact 1</h3>");
    expect(html).toContain('aria-label="Emergency contact 2"');
    expect(html).not.toMatch(/Guardian/);
  });
  it("shows the form's Add to roster contact section as Emergency contact for every member", () => {
    const blank = { name: "", relationship: "", email: "", phone: "" };
    const review = (attendeeType: string, birthDate: string) => ({
      submissionId: "sub-1", organizationId: "club-1", formName: "Synthetic form", clubYear: "2026-27", duplicates: [], canAdd: true,
      prefill: { firstName: "Sam", lastName: "Sample", birthDate, attendeeType, classLevel: "", role: "", gender: "", guardians: [blank, blank] },
    }) as never;
    const render = (attendeeType: string, birthDate: string) => renderToStaticMarkup(createElement(ClubFormRosterAdd, { review: review(attendeeType, birthDate), formHref: "/forms/1" }));
    for (const html of [render("STAFF", ""), render("ADULT", ""), render("YOUTH", "1980-01-01"), render("YOUTH", "2013-04-09"), render("UNDERAGE", "")]) {
      expect(html).toContain("<legend>Emergency contacts (optional)</legend>");
      expect(html).toContain('aria-label="Emergency contact 2"');
      expect(html).not.toContain("Guardian");
    }
  });
  it("labels each row of the read-only contacts panel Emergency contact", async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/modules/club-rosters/guardians-repository", async () => {
      const actual = await vi.importActual<typeof import("@/modules/club-rosters/guardians-repository")>("@/modules/club-rosters/guardians-repository");
      const entry = { name: "Synthetic Contact", relationship: "Mother", email: "", phone: "" };
      return {
        ...actual,
        listGuardianContactsForClub: async () => [
          { memberId: "m2", firstName: "Youth", lastName: "Person", attendeeType: "YOUTH", status: "ACTIVE", guardians: [{ position: 1, ...entry }] },
        ],
      };
    });
    const { ClubGuardiansPanel: Panel } = await import("@/components/club-guardians-panel");
    const element = await Panel({ organizationId: "club-1", viewer: { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "a1" } } as never });
    const html = renderToStaticMarkup(element!);
    expect(html).toContain(">Emergency contact<");
    expect(html).not.toContain(">Guardian<");
  });
});

describe("3. date, time and datetime-local fields are sized like every other field", () => {
  const dateRule = /^:where\(input:is\(\[type="date"\], \[type="time"\], \[type="datetime-local"\][^)]*\)\) \{([^}]*)\}/m.exec(css)?.[1] ?? "";
  const blockRule = /^:where\(:is\(\.form-stack, \.form-grid\) input:is\(\[type="date"\][^)]*\)\) \{([^}]*)\}/m.exec(css)?.[1] ?? "";
  it("has one zero-specificity rule for date, time and datetime-local inputs, at a 44px target", () => {
    expect(dateRule).not.toBe("");
    for (const declaration of ["box-sizing: border-box", "min-width: 0", "max-width: 100%", "min-height: 2.75rem", "line-height: 1.4", "-webkit-appearance: none", "appearance: none"]) {
      expect(dateRule).toContain(declaration);
    }
    // 2.75rem is 44px at the 16px root; it must not be smaller than a module's own 44px minimum.
    expect(Number(/min-height:\s*([\d.]+)rem/.exec(dateRule)![1]) * 16).toBeGreaterThanOrEqual(44);
    // No global display, margin or alignment: inline-label staff forms keep their own flow.
    expect(dateRule).not.toMatch(/display:|margin:|text-align:/);
  });
  it("keeps every top-level date rule at zero specificity so a single-class rule wins", () => {
    const topLevel = css.split("\n").filter((line) => /^(?!\s)[^/@].*input:is\(\[type="date"\]/.test(line) && !line.includes("::"));
    expect(topLevel.length).toBeGreaterThan(0);
    for (const line of topLevel) expect(line.startsWith(":where(")).toBe(true);
    const ordersCss = readFileSync(path.join(process.cwd(), "components/club-orders.module.css"), "utf8");
    expect(/\.date \{ min-height: 44px;/.test(ordersCss)).toBe(true);
  });
  it("lays out as a block only inside block-label forms", () => {
    expect(blockRule).toContain("display: block");
    expect(blockRule).toContain("margin: 0");
    expect(blockRule).toContain("text-align: left");
  });
  it("resets WebKit's inner value row so an empty field is as tall as a filled one", () => {
    expect(css).toMatch(/::-webkit-date-and-time-value \{ min-width: 0; min-height: 1\.4em;/);
    expect(css).toMatch(/::-webkit-datetime-edit \{ padding: 0; line-height: inherit; \}/);
    expect(css).toMatch(/::-webkit-datetime-edit-fields-wrapper \{ padding: 0; \}/);
  });
  it("keeps a label's rows at natural height and its helper text clear of the control", () => {
    expect(css).toContain(".form-stack label, .form-grid > label { align-content: start; }");
    expect(css).toContain(".form-stack label > .field-help, .form-grid > label > .field-help { margin: 0; }");
  });
  it("leaves the touch-target block alone (#738) and the field base rule at zero specificity", () => {
    expect(css).toContain("Touch and click targets (#738). Screen only");
    expect(css).toMatch(/:where\(\.app-shell, \.account-portal, \.auth-form, \[role="dialog"\]\)\n  :where\(input:not/);
  });
  it("is checked by the mobile layout audit at 360 and 1024", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts/verify-mobile-layout.ts"), "utf8");
    expect(script).toContain("function dateFieldsInDialogInPage");
    expect(script).toContain('record("date-field-layout"');
    expect(script).toMatch(/\[360, 1024\]\.filter/);
    expect(script).toContain("overlaps");
  });
});

describe("4 and 5. the item searches visibly narrow what they search", () => {
  it("describes what a search found, and is silent when nothing is typed", () => {
    expect(searchResultSummary(3, "", "item")).toBe("");
    expect(searchResultSummary(3, " , ", "item")).toBe("");
    expect(searchResultSummary(3, "shirt", "item")).toBe("3 items match “shirt”.");
    expect(searchResultSummary(1, "shirt", "item")).toBe("1 item matches “shirt”.");
    expect(searchResultSummary(0, "zzz", "item")).toContain("No items match “zzz”.");
  });
  const names = ["Good Conduct Bar", "Good Conduct Star", "TLT Pin", "TLT Ribbon", "Master Guide Bar", "Camp Patch", "Fall Patch", "Spring Patch", "Winter Patch", "Summer Patch"];
  const catalog = names.map((name, index) => ({ itemId: `item-${index}`, section: "MISC", sectionLabel: "Miscellaneous", name, catalogNumber: `00${index}` }));
  const earned = () => {
    runtime.index = 0;
    return ClubEarnedAwardsWorkspace({ organizationId: "club-1", initial: { ...emptyEarnedAwardsData, catalog } }) as ReactElement<Props>;
  };

  it("Class tracking, Find an item: typing narrows the list, says how many match, and shows no match", () => {
    let tree = earned();
    expect(optionLabels(byId(tree, "earned-item"))).toHaveLength(names.length + 1);
    expect(text(byId(tree, "earned-item-results"))).toBe("");
    type(byId(tree, "earned-item-search"), "patch");
    tree = earned();
    expect(optionLabels(byId(tree, "earned-item"))).toEqual(["Choose an item", "Camp Patch", "Fall Patch", "Spring Patch", "Winter Patch", "Summer Patch"]);
    expect(text(byId(tree, "earned-item-results"))).toBe("5 items match “patch”.");
    expect(byId(tree, "earned-item").props.size).toBeUndefined();
    expect(byId(tree, "earned-item-search").props["aria-describedby"]).toBe("earned-item-results");
    type(byId(tree, "earned-item-search"), "tlt rib");
    tree = earned();
    expect(optionLabels(byId(tree, "earned-item"))).toEqual(["Choose an item", "TLT Ribbon"]);
    expect(byId(tree, "earned-item").props.value).toBe("item-3");
    expect(byId(tree, "earned-item").props.size).toBeUndefined();
    type(byId(tree, "earned-item-search"), "zzz");
    tree = earned();
    expect(optionLabels(byId(tree, "earned-item"))).toEqual(["Choose an item"]);
    expect(text(byId(tree, "earned-item-results"))).toContain("No items match");
  });

  const stock: ClubStockRow[] = [
    { itemId: "a", section: "MISCELLANEOUS", name: "Polo Shirt", catalogNumber: "UN-204", sizeLabel: "M", isActive: true, quantityOnHand: 0 },
    { itemId: "b", section: "MISCELLANEOUS", name: "Polo Shirt", catalogNumber: "UN-205", sizeLabel: "L", isActive: true, quantityOnHand: 0 },
    { itemId: "c", section: "MISCELLANEOUS", name: "Neckerchief", catalogNumber: "NK-1", sizeLabel: null, isActive: true, quantityOnHand: 0 },
  ];
  const initial: ClubOrderWorkspaceData = { helper: [], batches: [], unmatched: [], awardable: [], waiting: [], firstOrderAt: null };
  const orders = () => {
    runtime.index = 0;
    return ClubOrderWorkspace({ organizationId: "club-1", initial, stock }) as ReactElement<Props>;
  };

  it("Orders, Search the catalog: typing narrows the list by name or item number, and says so", () => {
    let tree = orders();
    expect(optionLabels(byId(tree, "club-order-picker-item"))).toHaveLength(4);
    type(byId(tree, "club-order-picker-search"), "polo");
    tree = orders();
    expect(optionLabels(byId(tree, "club-order-picker-item"))).toHaveLength(3);
    expect(text(byId(tree, "club-order-picker-results"))).toBe("2 items match “polo”.");
    expect(byId(tree, "club-order-picker-item").props.size).toBeUndefined();
    expect(byId(tree, "club-order-picker-search").props["aria-describedby"]).toBe("club-order-picker-results");
    type(byId(tree, "club-order-picker-search"), "nk 1");
    tree = orders();
    expect(optionLabels(byId(tree, "club-order-picker-item"))).toEqual(["Choose an item", "Neckerchief · NK-1"]);
    expect(byId(tree, "club-order-picker-item").props.value).toBe("c");
    type(byId(tree, "club-order-picker-search"), "zzz");
    tree = orders();
    expect(text(byId(tree, "club-order-picker-results"))).toContain("No items match");
  });
  it("Orders: when the match list is capped, says how many are shown of how many match", () => {
    const many: ClubStockRow[] = Array.from({ length: 250 }, (_, index) => ({ itemId: `i${index}`, section: "MISCELLANEOUS", name: `Patch ${index}`, catalogNumber: `P-${index}`, sizeLabel: null, isActive: true, quantityOnHand: 0 }));
    const capped = () => { runtime.index = 0; return ClubOrderWorkspace({ organizationId: "club-1", initial, stock: many }) as ReactElement<Props>; };
    type(byId(capped(), "club-order-picker-search"), "patch");
    const tree = capped();
    expect(optionLabels(byId(tree, "club-order-picker-item"))).toHaveLength(101);
    expect(text(byId(tree, "club-order-picker-results"))).toContain("Showing the first 100 of 250 matches");
  });
});

describe("6. Area Coordinators do not see club Orders", () => {
  it("has no Orders entry in the coordinator's club menu, and still has Earned awards", () => {
    const items = areaClubPortalNavItems({ organizationId: "club-1" });
    expect(items.map((item) => item.label)).not.toContain("Orders");
    expect(items.some((item) => /\/(orders|supplies)/.test(item.href))).toBe(false);
    expect(items.map((item) => item.label)).toContain("Earned awards");
  });
  it("shows the earned awards page without an Orders link when none is given", () => {
    const html = renderToStaticMarkup(createElement(ClubEarnedAwardsWorkspace, { organizationId: "club-1", initial: emptyEarnedAwardsData }));
    expect(html).toContain("with honors and uniforms.");
    expect(html).not.toContain("/orders");
    const withLink = renderToStaticMarkup(createElement(ClubEarnedAwardsWorkspace, { organizationId: "club-1", initial: emptyEarnedAwardsData, ordersHref: "/account/clubs/club-1/orders" }));
    expect(withLink).toContain('href="/account/clubs/club-1/orders"');
  });
  it("answers 404 on the coordinator's Orders and Supplies pages", async () => {
    const navigation = await import("next/navigation");
    (navigation.notFound as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
    const orders = (await import("@/app/(public)/account/(portal)/area/[organizationId]/orders/page")).default;
    const supplies = (await import("@/app/(public)/account/(portal)/area/[organizationId]/supplies/page")).default;
    expect(() => orders()).toThrow("NEXT_NOT_FOUND");
    expect(() => supplies()).toThrow("NEXT_NOT_FOUND");
  });
});

describe("7. the Team approvals tab explains itself (#918, #1015)", () => {
  it("says what the tab is for, names PBE, lists the rules and what each level allows", () => {
    expect(teamPermissionsIntro.summary).toContain("Pathfinder Bible Experience (PBE)");
    expect(teamPermissionsIntro.summary).toContain("18 or older");
    expect(teamPermissionsIntro.summary).toContain("confirm they still qualify");
    expect(teamPermissionsIntro.rules).toEqual(["An inducted Pathfinder or TLT, active and in good standing.", "Not graduated from high school."]);
    expect(teamPermissionsIntro.ageRuleLead).toContain("maximum age");
    expect(teamPermissionsIntro.coaches).toContain("registered as coaches");
    expect(teamPermissionsIntro.coaches).toContain("don't need approval");
    expect(teamPermissionsIntro.levels.map((level) => level.label)).toEqual(["Waiting for a decision", "Permission granted", "Declined"]);
    for (const level of teamPermissionsIntro.levels) expect(level.detail.length).toBeGreaterThan(30);
    expect(teamPermissionsIntro.levels[0]!.detail).toContain("The team is registered while you decide");
    expect(teamPermissionsIntro.levels[2]!.detail).toContain("coach");
    expect(teamPermissionsIntro.footer).toContain("Grant or Decline");
  });
  it("words an event's age limit from its settings", () => {
    expect(ageLimitText({ maxMemberAge: 19, ageAsOf: "2026-01-01" })).toBe("19 or younger on January 1, 2026");
    expect(ageLimitText({ maxMemberAge: 21, ageAsOf: "2027-03-15" })).toBe("21 or younger on March 15, 2027");
    expect(ageLimitText({ maxMemberAge: null, ageAsOf: "2026-01-01" })).toContain("No maximum age is set");
    expect(ageLimitText({ maxMemberAge: null, ageAsOf: null })).toBe("No maximum age is set for this event");
  });
  async function renderPage(rows: Array<{ eventId: string; eventName: string }>, settings: Record<string, { maxMemberAge: number | null; ageAsOf: string | null } | null>) {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/modules/organizations/area-coordinators", () => ({
      currentAreaCoordinatorViewerActive: async () => true,
      currentAreaCoordinator: async () => ({ id: "ac-1" }),
    }));
    vi.doMock("@/modules/club-teams/permission-repository", () => ({
      listCoordinatorTeamPermissions: async () => rows.map((row, index) => ({
        id: `p-${index}`, ...row, registrationId: "r", clubEventRegistrationId: "c", teamLabel: "Synthetic Club", locationName: null, name: `Sample Person ${index}`, age: 18, status: "PENDING", decidedAt: null, decidedBy: null,
      })),
    }));
    vi.doMock("@/modules/club-teams/settings-repository", () => ({ getTeamSettings: async (eventId: string) => settings[eventId] ?? null }));
    const page = (await import("@/app/(public)/account/(portal)/area-clubs/team-permissions/page")).default;
    return renderToStaticMarkup(await page());
  }
  it("renders on the page above the list, with the rules", async () => {
    const html = await renderPage([], {});
    expect(html).toContain("<h2>Team approvals</h2>");
    expect(html).not.toContain("Team permissions");
    expect(html).toContain(teamPermissionsIntro.summary);
    for (const rule of teamPermissionsIntro.rules) expect(html).toContain(rule);
    expect(html).toContain(teamPermissionsIntro.coaches.replace(/'/g, "&#x27;"));
    for (const level of teamPermissionsIntro.levels) {
      expect(html).toContain(level.label);
      expect(html).toContain(level.detail.replace(/'/g, "&#x27;"));
    }
    expect(html.indexOf("Waiting for a decision")).toBeLessThan(html.indexOf("Team members 18 and over"));
  });
  it("shows the max age and as-of date from the event's settings once when every row shares an event", async () => {
    const html = await renderPage(
      [{ eventId: "e1", eventName: "Synthetic PBE" }, { eventId: "e1", eventName: "Synthetic PBE" }],
      { e1: { maxMemberAge: 19, ageAsOf: "2026-01-01" } },
    );
    expect(html).toContain("19 or younger on January 1, 2026");
    expect(html.match(/19 or younger on January 1, 2026/g)).toHaveLength(1);
  });
  it("lists each event's own limit when rows come from different events", async () => {
    const html = await renderPage(
      [{ eventId: "e1", eventName: "Synthetic PBE North" }, { eventId: "e2", eventName: "Synthetic PBE South" }],
      { e1: { maxMemberAge: 19, ageAsOf: "2026-01-01" }, e2: { maxMemberAge: 20, ageAsOf: "2027-02-01" } },
    );
    expect(html).toContain("19 or younger on January 1, 2026");
    expect(html).toContain("20 or younger on February 1, 2027");
    expect(html).toContain("Age limit for each event");
  });
});
