import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Club portal fixes from the owner's iPad review (#918). Items: roster name prominence, Emergency contact
 * wording for adults, the date field layout rules, the two item searches that must visibly filter, Orders
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
import { ClubRosterWorkspace } from "@/components/club-roster-workspace";
import { RosterGuardianFields } from "@/components/roster-guardian-fields";
import { narrowedListSize, searchResultSummary } from "@/lib/search-match";
import { isAdultRosterPerson } from "@/modules/club-rosters/domain";
import { guardianTerm } from "@/modules/club-rosters/guardians-domain";
import { areaClubPortalNavItems } from "@/modules/club-rosters/portal-nav";
import { teamPermissionsIntro } from "@/modules/club-teams/permission-domain";
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

describe("2. adults have an Emergency contact, a minor has a Guardian", () => {
  it("treats staff, adults, and anyone 18 or over as an adult", () => {
    expect(isAdultRosterPerson("STAFF")).toBe(true);
    expect(isAdultRosterPerson("ADULT")).toBe(true);
    expect(isAdultRosterPerson("YOUTH")).toBe(false);
    expect(isAdultRosterPerson("UNDERAGE", "2024-01-01", "2026-10-14")).toBe(false);
    expect(isAdultRosterPerson("YOUTH", "2008-10-14", "2026-10-14")).toBe(true);
    expect(isAdultRosterPerson("YOUTH", "2008-10-15", "2026-10-14")).toBe(false);
    expect(isAdultRosterPerson("YOUTH", "not a date", "2026-10-14")).toBe(false);
    expect(guardianTerm(true)).toEqual({ singular: "Emergency contact", plural: "Emergency contacts" });
    expect(guardianTerm(false)).toEqual({ singular: "Guardian", plural: "Guardians" });
  });

  const fields = (adult: boolean) => renderToStaticMarkup(createElement(RosterGuardianFields, { adult, errors: {}, guardianState: "ready", records: undefined }));
  it("words the roster dialog's contact section for an adult as Emergency contact, with no Guardian", () => {
    const html = fields(true);
    expect(html).toContain("<legend>Emergency contacts (optional)</legend>");
    expect(html).toContain("<h3>Emergency contact 1</h3>");
    expect(html).toContain('aria-label="Emergency contact 2"');
    expect(html).not.toMatch(/Guardian/);
  });
  it("keeps Guardian for a minor", () => {
    const html = fields(false);
    expect(html).toContain("<legend>Guardians (optional)</legend>");
    expect(html).toContain("<h3>Guardian 1</h3>");
    expect(html).not.toContain("Emergency contact");
  });
  it("labels each row of the read-only contacts panel by who it is for", async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/modules/club-rosters/guardians-repository", async () => {
      const actual = await vi.importActual<typeof import("@/modules/club-rosters/guardians-repository")>("@/modules/club-rosters/guardians-repository");
      const entry = { name: "Synthetic Contact", relationship: "Spouse", email: "", phone: "" };
      return {
        ...actual,
        listGuardianContactsForClub: async () => [
          { memberId: "m1", firstName: "Staff", lastName: "Person", attendeeType: "STAFF", status: "ACTIVE", guardians: [{ position: 1, ...entry }] },
          { memberId: "m2", firstName: "Youth", lastName: "Person", attendeeType: "YOUTH", status: "ACTIVE", guardians: [{ position: 1, ...entry }] },
        ],
      };
    });
    const { ClubGuardiansPanel: Panel } = await import("@/components/club-guardians-panel");
    const element = await Panel({ organizationId: "club-1", viewer: { kind: "AREA_COORDINATOR", actor: { kind: "ATTENDEE", accountId: "a1" } } as never });
    const html = renderToStaticMarkup(element!);
    const [, staffRow, youthRow] = html.split("</tr>");
    expect(staffRow).toContain("Emergency contact");
    expect(staffRow).not.toContain(">Guardian<");
    expect(youthRow).toContain(">Guardian<");
    expect(youthRow).not.toContain("Emergency contact");
  });
});

describe("3. date, time and datetime-local fields are sized like every other field", () => {
  const dateRule = /input:is\(\[type="date"\], \[type="time"\], \[type="datetime-local"\][^)]*\) \{([^}]*)\}/.exec(css)?.[1] ?? "";
  it("has one general rule for date, time and datetime-local inputs", () => {
    expect(dateRule).not.toBe("");
    for (const declaration of ["display: block", "box-sizing: border-box", "min-width: 0", "max-width: 100%", "min-height: 2.6rem", "line-height: 1.4", "-webkit-appearance: none", "appearance: none"]) {
      expect(dateRule).toContain(declaration);
    }
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
  it("opens the select as a short list while a search has several matches", () => {
    expect(narrowedListSize(5, "")).toBeUndefined();
    expect(narrowedListSize(1, "x")).toBeUndefined();
    expect(narrowedListSize(0, "x")).toBeUndefined();
    expect(narrowedListSize(3, "x")).toBe(4);
    expect(narrowedListSize(40, "x")).toBe(6);
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
    expect(byId(tree, "earned-item").props.size).toBe(6);
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
    expect(byId(tree, "club-order-picker-item").props.size).toBe(3);
    type(byId(tree, "club-order-picker-search"), "nk 1");
    tree = orders();
    expect(optionLabels(byId(tree, "club-order-picker-item"))).toEqual(["Choose an item", "Neckerchief · NK-1"]);
    expect(byId(tree, "club-order-picker-item").props.value).toBe("c");
    type(byId(tree, "club-order-picker-search"), "zzz");
    tree = orders();
    expect(text(byId(tree, "club-order-picker-results"))).toContain("No items match");
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

describe("7. the Team permissions tab explains itself", () => {
  it("says what the tab does and what each level allows, in plain words", () => {
    expect(teamPermissionsIntro.summary).toContain("18 or older");
    expect(teamPermissionsIntro.summary).toContain("your permission");
    expect(teamPermissionsIntro.levels.map((level) => level.label)).toEqual(["Waiting for a decision", "Permission granted", "Declined"]);
    for (const level of teamPermissionsIntro.levels) expect(level.detail.length).toBeGreaterThan(30);
    expect(teamPermissionsIntro.levels[2]!.detail).toContain("coach");
    expect(teamPermissionsIntro.footer).toContain("Grant or Decline");
  });
  it("renders on the page above the list", async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/modules/organizations/area-coordinators", () => ({
      currentAreaCoordinatorViewerActive: async () => true,
      currentAreaCoordinator: async () => ({ id: "ac-1" }),
    }));
    vi.doMock("@/modules/club-teams/permission-repository", () => ({ listCoordinatorTeamPermissions: async () => [] }));
    const page = (await import("@/app/(public)/account/(portal)/area-clubs/team-permissions/page")).default;
    const html = renderToStaticMarkup(await page());
    expect(html).toContain(teamPermissionsIntro.summary);
    for (const level of teamPermissionsIntro.levels) {
      expect(html).toContain(level.label);
      expect(html).toContain(level.detail.replace(/'/g, "&#x27;"));
    }
    expect(html.indexOf("Waiting for a decision")).toBeLessThan(html.indexOf("Team members 18 and over"));
  });
});
