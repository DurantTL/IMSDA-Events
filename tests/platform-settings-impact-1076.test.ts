import { describe, expect, it } from "vitest";
import {
  platformSettingsChanges,
  platformSettingsEffects,
  type PlatformSettingsDraft,
} from "@/components/platform-settings-impact";

const saved: PlatformSettingsDraft = {
  organizationName: "Synthetic Conference",
  logoUrl: "",
  publicWebsiteUrl: "https://example.test",
  defaultTimezone: "America/Chicago",
  defaultAttendeeEditPolicy: "VERIFY_EVERY_EDIT",
  passkeyRpId: "events.example.test",
  invoiceHeaderDepartment: "",
  invoiceHeaderOrganization: "",
  invoiceHeaderAddress: "",
  invoiceHeaderPhone: "(515) 555-0100",
  publicHelpPhone: "",
  publicHelpEmail: "help@example.test",
  emailHeaderName: "IMSDA Events",
  emailClubHeaderName: "IMSDA Events",
  emailHelpEmail: "support@example.test",
  emailHelpPhone: "(515) 555-0100",
};

describe("platform settings change preview (#1076)", () => {
  it("treats the homepage help email's letter case as no change", () => {
    expect(platformSettingsChanges(saved, { ...saved, publicHelpEmail: " Help@Example.test " })).toEqual([]);
  });

  it("lists nothing when nothing changed", () => {
    expect(platformSettingsChanges(saved, { ...saved })).toEqual([]);
  });

  it("lists each changed field with old and new value, blank shown as (blank), and its effect", () => {
    const changes = platformSettingsChanges(saved, {
      ...saved,
      logoUrl: "https://example.test/logo.png",
      invoiceHeaderPhone: "",
      defaultAttendeeEditPolicy: "TIERED",
      passkeyRpId: "portal.example.test",
    });
    expect(changes.map((change) => change.field)).toEqual([
      "logoUrl",
      "defaultAttendeeEditPolicy",
      "passkeyRpId",
      "invoiceHeaderPhone",
    ]);
    expect(changes[0]).toMatchObject({ label: "Logo URL", from: "(blank)", to: "https://example.test/logo.png" });
    expect(changes[1]).toMatchObject({ from: "Verify every edit", to: "Tiered by sensitivity" });
    expect(changes[2].effect).toBe("Every existing passkey stops working.");
    expect(changes[3]).toMatchObject({ from: "(515) 555-0100", to: "(blank)" });
    expect(changes[3].effect).toContain("earlier PDFs keep their header");
  });

  it("ignores surrounding spaces and passkey letter case", () => {
    expect(platformSettingsChanges(saved, { ...saved, organizationName: " Synthetic Conference ", passkeyRpId: "Events.Example.Test " })).toEqual([]);
  });

  it("states each effect once", () => {
    const changes = platformSettingsChanges(saved, { ...saved, organizationName: "New", publicWebsiteUrl: "https://other.test" });
    expect(platformSettingsEffects(changes)).toEqual(["Shown everywhere the organization appears, right away."]);
  });
});
