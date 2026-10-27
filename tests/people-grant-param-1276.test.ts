import { describe, expect, it } from "vitest";
import {
  GRANT_ITEM_CAP,
  formatGrantParam,
  parseGrantParam,
  planGrantItems,
  type GrantItem,
  type GrantPlanPerson,
} from "@/modules/system-admin/people-directory-model";
import { deferredPersonHref } from "@/modules/system-admin/people-invite-href";

describe("the ?grant= link (#1276)", () => {
  const items: GrantItem[] = [
    { type: "sa" },
    { type: "ca" },
    { type: "ac" },
    { type: "event", eventId: "evt_1", role: "REGISTRATION_MANAGER" },
    { type: "club", organizationId: "org-9", role: "REGISTRAR" },
  ];

  it("round-trips every kind of item", () => {
    expect(formatGrantParam(items)).toBe("sa,ca,ac,e:evt_1:REGISTRATION_MANAGER,c:org-9:REGISTRAR");
    expect(parseGrantParam(formatGrantParam(items))).toEqual(items);
  });

  it("ignores unknown kinds, bad roles, bad ids, extra parts and repeats", () => {
    expect(parseGrantParam("sa,sa,nope,e:evt_1:NOT_A_ROLE,e:bad id:EVENT_ADMIN,c:org-1:DIRECTOR:extra,c::DIRECTOR,ac:1,<script>,,")).toEqual([{ type: "sa" }]);
    expect(parseGrantParam("e:evt_1:EVENT_ADMIN,c:org-1:DIRECTOR")).toEqual([
      { type: "event", eventId: "evt_1", role: "EVENT_ADMIN" },
      { type: "club", organizationId: "org-1", role: "DIRECTOR" },
    ]);
  });

  it("is empty for anything that is not text", () => {
    expect(parseGrantParam(undefined)).toEqual([]);
    expect(parseGrantParam(42)).toEqual([]);
    expect(parseGrantParam([])).toEqual([]);
    expect(parseGrantParam(["ac", "sa"])).toEqual([{ type: "ac" }]);
  });

  it("keeps at most the cap", () => {
    const many = Array.from({ length: 100 }, (_, index) => `c:org-${index}:DIRECTOR`).join(",");
    expect(parseGrantParam(many)).toHaveLength(GRANT_ITEM_CAP);
  });
});

describe("the person page's Chosen in the invite rows (#1276)", () => {
  const items: GrantItem[] = [
    { type: "sa" },
    { type: "ac" },
    { type: "event", eventId: "evt_1", role: "EVENT_ADMIN" },
    { type: "club", organizationId: "org-1", role: "DIRECTOR" },
  ];
  const base: GrantPlanPerson = {
    hasStaff: true, hasAccount: true, systemAdministrator: false, clubsAdministrator: false, areaCoordinator: false, activeEventIds: [], clubOrganizationIds: [],
  };

  it("marks everything saveable for a person with both logins and none of it", () => {
    expect(planGrantItems(items, "full", base).map((row) => row.state)).toEqual(["save", "save", "save", "save"]);
  });

  it("marks what the person already has", () => {
    const rows = planGrantItems(items, "full", { ...base, systemAdministrator: true, areaCoordinator: true, activeEventIds: ["evt_1"], clubOrganizationIds: ["org-1"] });
    expect(rows.map((row) => row.state)).toEqual(["has", "has", "has", "has"]);
  });

  it("does not offer staff-side items on an account-only person, or family-side on a staff-only one", () => {
    expect(planGrantItems(items, "full", { ...base, hasStaff: false }).map((row) => row.state)).toEqual(["needs-staff", "save", "needs-staff", "save"]);
    expect(planGrantItems(items, "full", { ...base, hasAccount: false }).map((row) => row.state)).toEqual(["save", "needs-account", "save", "needs-account"]);
  });

  it("never shows staff-side items to a Clubs Administrator", () => {
    expect(planGrantItems(items, "clubs", base).map((row) => row.item.type)).toEqual(["ac", "club"]);
  });
});

describe("where a deferred invite sends the inviter (#1276)", () => {
  it("opens the staff page when staff-side items are deferred and a staff login exists", () => {
    expect(deferredPersonHref({ staffId: "u1", accountId: "a1" }, [{ type: "sa" }, { type: "ac" }])).toBe("/admin/people/staff/u1?grant=sa%2Cac");
  });

  it("opens the account page when only family-side items are deferred", () => {
    expect(deferredPersonHref({ staffId: "u1", accountId: "a1" }, [{ type: "club", organizationId: "org-1", role: "DIRECTOR" }])).toBe("/admin/people/account/a1?grant=c%3Aorg-1%3ADIRECTOR");
  });

  it("falls back to whichever login exists", () => {
    expect(deferredPersonHref({ staffId: null, accountId: "a1" }, [{ type: "sa" }])).toBe("/admin/people/account/a1?grant=sa");
    expect(deferredPersonHref({ staffId: "u1", accountId: null }, [{ type: "ac" }])).toBe("/admin/people/staff/u1?grant=ac");
  });
});
