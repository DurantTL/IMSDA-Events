import { ClubDirectorRole, EventRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ADMIN_ROLE_LABELS } from "@/modules/access/admin-roles-domain";
import { eventRoles } from "@/modules/access/permissions";
import { clubRoleText, eventExtraText, eventRoleText, systemRoleText, type RoleText } from "@/modules/access/role-descriptions";
import { roleDetails } from "@/modules/access/role-display";
import { clubDirectorRoleLabels, clubRoleDescriptions } from "@/modules/organizations/director-grants-domain";
import { CLUB_ROLE_LABELS, EVENT_ROLE_LABELS, peopleRoleLabel, summarizePeopleAccess } from "@/modules/system-admin/people-directory-model";

function expectPlain(text: RoleText | undefined, label: string) {
  expect(text, label).toBeDefined();
  expect(text!.name.trim().length, `${label} name`).toBeGreaterThan(0);
  expect(text!.summary, `${label} summary`).toMatch(/^[^\n.]+\.$/);
  expect(text!.summary.endsWith("."), label).toBe(true);
  expect((text!.summary.match(/\./g) ?? []).length, `${label} is one sentence`).toBe(1);
}

describe("role wording (#1278)", () => {
  it("describes every event role, club role, extra and system role in one sentence", () => {
    for (const role of Object.values(EventRole)) expectPlain(eventRoleText[role], role);
    for (const role of Object.values(ClubDirectorRole)) expectPlain(clubRoleText[role], role);
    for (const key of ["VIEW_HEALTH_INFORMATION", "FINALIZE_INVOICES"] as const) expectPlain(eventExtraText[key], key);
    for (const key of ["SYSTEM_ADMIN", "CLUBS_ADMIN", "AREA_COORDINATOR", "EVENTS_ADMIN"] as const) expectPlain(systemRoleText[key], key);
    expect(Object.keys(eventRoleText).sort()).toEqual([...Object.values(EventRole)].sort());
    expect(Object.keys(clubRoleText).sort()).toEqual([...Object.values(ClubDirectorRole)].sort());
    expect([...eventRoles].sort()).toEqual([...Object.values(EventRole)].sort());
  });

  it("gives every role a can list", () => {
    const all = [...Object.values(eventRoleText), ...Object.values(clubRoleText), ...Object.values(eventExtraText), ...Object.values(systemRoleText)];
    for (const text of all) expect(text.can.length, text.name).toBeGreaterThan(0);
  });

  it("reads every other label from the one module", () => {
    for (const role of Object.values(EventRole)) {
      expect(roleDetails[role].label).toBe(eventRoleText[role].name);
      expect(roleDetails[role].description).toBe(eventRoleText[role].summary);
      expect(EVENT_ROLE_LABELS[role]).toBe(eventRoleText[role].name);
    }
    for (const role of Object.values(ClubDirectorRole)) {
      expect(clubDirectorRoleLabels[role]).toBe(clubRoleText[role].name);
      expect(clubRoleDescriptions[role]).toBe(clubRoleText[role].summary);
      expect(CLUB_ROLE_LABELS[role]).toBe(clubRoleText[role].name);
    }
    expect(ADMIN_ROLE_LABELS).toEqual({
      EVENTS_ADMIN: systemRoleText.EVENTS_ADMIN.name,
      CLUBS_ADMIN: systemRoleText.CLUBS_ADMIN.name,
      SYSTEM_ADMIN: systemRoleText.SYSTEM_ADMIN.name,
    });
    expect(peopleRoleLabel({ kind: "system-admin" })).toBe(systemRoleText.SYSTEM_ADMIN.name);
    expect(peopleRoleLabel({ kind: "clubs-admin" })).toBe(systemRoleText.CLUBS_ADMIN.name);
    expect(peopleRoleLabel({ kind: "area-coordinator" })).toBe(systemRoleText.AREA_COORDINATOR.name);
    expect(summarizePeopleAccess({ systemAdministrator: true, clubsAdministrator: true, areaCoordinator: true, activeEventCount: 0, activeClubRoleCount: 0 }))
      .toEqual([systemRoleText.SYSTEM_ADMIN.name, systemRoleText.CLUBS_ADMIN.name, systemRoleText.AREA_COORDINATOR.name]);
  });
});
