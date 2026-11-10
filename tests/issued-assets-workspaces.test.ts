import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { AssetIssueDesk } from "@/components/asset-issue-desk";
import { IssuedAssetsWorkspace } from "@/components/issued-assets-workspace";
import type { AssigneeOptions, CatalogView, DeskLot, DeskPerson, DeskType, IssuanceRow } from "@/modules/issued-assets/view";

/**
 * The issued-asset screens (#213), rendered on the server with synthetic data: the catalog form offers a numbered range,
 * the desk shows the room a key opens next to where the family stays now, words and not only colour carry the state, and
 * the screens carry no names beyond what the server gave them. What each button does is checked by the real-database
 * script and the route tests.
 */
const catalog: CatalogView = {
  truncated: false,
  types: [
    { id: "t1", name: "Dorm room key", mode: "SERIALIZED", active: true, assigneeKinds: ["ATTENDEE", "REGISTRATION"], roomLinked: true, depositPolicyRef: "CM26 key deposit", replacementPolicyRef: null, depositCents: 1000, depositShortfall: "KEEP_ALL", replacementFeeCents: 2500, assetCount: 2, availableQuantity: 1, outQuantity: 1 },
    { id: "t2", name: "Welcome packet", mode: "QUANTITY", active: true, assigneeKinds: ["ATTENDEE"], roomLinked: false, depositPolicyRef: null, replacementPolicyRef: null, depositCents: 0, depositShortfall: "KEEP_ALL", replacementFeeCents: 0, assetCount: 1, availableQuantity: 90, outQuantity: 10 },
  ],
  assets: [
    { id: "a1", typeId: "t1", identifier: "K-214", scanCode: "K-214", quantityTotal: 1, condition: "GOOD", location: null, availability: "AVAILABLE", outQuantity: 1 },
    { id: "a2", typeId: "t1", identifier: "K-215", scanCode: "K-215", quantityTotal: 1, condition: "WORN", location: "Front desk", availability: "AVAILABLE", outQuantity: 0 },
    { id: "a3", typeId: "t2", identifier: "WP-27", scanCode: "WP-27", quantityTotal: 100, condition: "NEW", location: null, availability: "AVAILABLE", outQuantity: 10 },
  ],
};

describe("issued-assets configuration screen", () => {
  const html = renderToStaticMarkup(createElement(IssuedAssetsWorkspace, { eventId: "ev1", initialCatalog: catalog, canOpenDesk: true }));

  it("gives each kind a stock card with a status chip, visible Edit and Add items buttons, and its policy facts (#1581)", () => {
    expect(html).toContain("Add a kind of item");
    expect(html).toContain(">Dorm room key</h2>");
    expect(html).toContain('<span class="status-chip green">Active</span>');
    expect(html).toContain('aria-label="Edit Dorm room key">Edit</button>');
    expect(html).toContain('aria-label="Add items to Welcome packet">Add items</button>');
    expect(html).toContain("Room-linked. Deposit policy: CM26 key deposit. Usual cash deposit $10.00. Replacement fee $25.00.");
  });

  it("keeps the add and edit forms out of the page: they open in a dialog (#1581)", () => {
    expect(html).not.toContain("Numbered (one holder at a time)");
    expect(html).not.toContain("Add a numbered range");
    expect(html).not.toContain('role="dialog"');
  });

  it("shows stock in words and links to the check-in desk only when the viewer may open it", () => {
    expect(html).toContain("1 in stock, 1 out");
    expect(html).toContain("90 in stock, 10 out");
    expect(html).toContain("/check-in/assets?event=ev1");
    expect(html).toContain("Issue and return desk");
    const closed = renderToStaticMarkup(createElement(IssuedAssetsWorkspace, { eventId: "ev1", initialCatalog: catalog, canOpenDesk: false }));
    expect(closed).not.toContain("/check-in/assets");
    expect(closed).not.toContain("Issue and return desk");
  });

  it("marks a switched-off kind with a neutral Inactive chip, the word rule B12 allows", () => {
    const off = renderToStaticMarkup(createElement(IssuedAssetsWorkspace, { eventId: "ev1", initialCatalog: { ...catalog, types: [{ ...catalog.types[0], active: false }] }, canOpenDesk: false }));
    expect(off).toContain('<span class="status-chip neutral">Inactive</span>');
  });

  it("explains an empty inventory and offers the next step (#1581)", () => {
    const empty = renderToStaticMarkup(createElement(IssuedAssetsWorkspace, { eventId: "ev1", initialCatalog: { truncated: false, types: [], assets: [] }, canOpenDesk: false }));
    expect(empty).toContain("No kinds of item yet");
    expect(empty).toContain("Add a kind of item, such as a dorm room key");
    expect(empty.match(/Add a kind of item/g)!.length).toBeGreaterThanOrEqual(3);
    expect(empty.match(/class="primary-button"/g)).toHaveLength(1);
  });

  it("turns the items table into cards on a phone and never lets the card widen the page (#1581, rule B3)", () => {
    expect(html).toContain("table-cards");
    const css = readFileSync(join(process.cwd(), "components/issued-assets-workspace.module.css"), "utf8");
    expect(css).toMatch(/\.card \{[^}]*min-width: 0;/);
    expect(css).toMatch(/\.items \{[^}]*min-width: 0;/);
  });

  it("says 1 item or 1 lot in the singular", () => {
    const one = renderToStaticMarkup(createElement(IssuedAssetsWorkspace, { eventId: "ev1", initialCatalog: { ...catalog, types: [{ ...catalog.types[0], assetCount: 1 }], assets: [catalog.assets[0]] }, canOpenDesk: false }));
    expect(one).toContain("1 item;");
    expect(one).toContain(">1 item</summary>");
  });

  it("keeps the sortable items table, with its screen-reader labels, under the card", () => {
    expect(html).toContain("<details");
    expect(html).toContain("Condition of K-214");
    expect(html).toContain("Status of K-214");
    expect(html).toContain("Location of K-214");
  });
});

const types: DeskType[] = [{ id: "t1", name: "Dorm room key", mode: "SERIALIZED", assigneeKinds: ["ATTENDEE", "REGISTRATION", "ROOM"], roomLinked: true, depositPolicyRef: null, depositCents: 1000, depositShortfall: "KEEP_ALL", replacementFeeCents: 2500 }];
const lots: DeskLot[] = [{ code: "WP-27", identifier: "WP-27", typeName: "Welcome packet", remaining: 90 }];
const options: AssigneeOptions = { rooms: [{ id: "u1", name: "213, Girls Dorm" }], staff: [{ userId: "usr_1", name: "Synthetic Staff" }] };

const row = (extra: Partial<IssuanceRow>): IssuanceRow => ({
  id: "i1", assetId: "a1", identifier: "K-214", typeName: "Dorm room key", serialized: true, quantity: 1, holderKind: "ATTENDEE", holderLabel: "Pat Example", purpose: "Issued at check-in",
  issuedAt: "2027-06-15T18:00:00.000Z", issuedByName: "Synthetic Staff", entryMethod: "MANUAL", expectedReturnAt: null, open: true, endReason: null, endedAt: null, endNote: null,
  endQuantity: null, depositEntryId: null, attendeeId: "att1", registrationId: null, previousIssuanceId: null, roomName: "214, Girls Dorm", sourceAssignmentId: "as1", lodging: { status: "CURRENT", currentRooms: ["214, Girls Dorm"] }, ...extra,
});

const person = (issuances: IssuanceRow[], rooms: DeskPerson["rooms"]): DeskPerson => ({ attendeeId: "att1", registrationId: "reg1", name: "Pat Example", confirmationCode: "CODE-1", registrationActive: true, rooms, issuances });

describe("issued-assets check-in desk", () => {
  it("shows the attendee, their room and a one-tap welcome packet", () => {
    const html = renderToStaticMarkup(createElement(AssetIssueDesk, {
      eventId: "ev1", userId: "usr_1", types, lots, options, outNow: [],
      person: person([], [{ assignmentId: "as1", unitId: "u1", roomName: "214, Girls Dorm", firstNight: "2027-06-15", lastNight: "2027-06-18" }]),
    }));
    expect(html).toContain("Pat Example");
    expect(html).toContain("Room: 214, Girls Dorm");
    expect(html).toContain("Welcome packet: WP-27 (90 left)");
    expect(html).toContain("Scan or type a code");
    expect(html).toContain("Check out records returns, lost or damaged keys and the cash key deposit");
    expect(html).toContain("/more/issued-assets/closeout?event=ev1");
  });

  it("says in words when a key opens a room the family has left", () => {
    const html = renderToStaticMarkup(createElement(AssetIssueDesk, {
      eventId: "ev1", userId: "usr_1", types, lots, options, outNow: [],
      person: person([row({ lodging: { status: "MOVED", currentRooms: ["213, Girls Dorm"] } })], [{ assignmentId: "as2", unitId: "u2", roomName: "213, Girls Dorm", firstNight: "2027-06-15", lastNight: "2027-06-18" }]),
    }));
    expect(html).toContain("Opens 214, Girls Dorm, but they now stay in 213, Girls Dorm. Swap the key in Check out.");
    expect(html).toContain("Entered in error");
  });

  it("keeps ended issues under a history note rather than deleting them", () => {
    const html = renderToStaticMarkup(createElement(AssetIssueDesk, {
      eventId: "ev1", userId: "usr_1", types, lots, options, outNow: [],
      person: person([row({ id: "i0", open: false, endReason: "REPLACED", endedAt: "2027-06-16T10:00:00.000Z", endNote: "Moved rooms" })], []),
    }));
    expect(html).toContain("1 earlier issue (history is kept)");
    expect(html).toContain("Moved rooms");
  });

  it("without a person, lists what is out now and asks for a lookup", () => {
    const html = renderToStaticMarkup(createElement(AssetIssueDesk, { eventId: "ev1", userId: "usr_1", types, lots, options, person: null, outNow: [row({})] }));
    expect(html).toContain("Out now");
    expect(html).toContain("K-214");
    expect(html).toContain("Find an attendee");
    expect(html).toContain("Look up an item");
  });
});
