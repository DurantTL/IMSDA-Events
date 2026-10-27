import { describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ getPrisma: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: database.getPrisma }));

import {
  PlatformSettingsError,
  platformAddressesInputSchema,
  platformSettingsInputSchema,
  updatePlatformAddresses,
  updatePlatformSettings,
} from "@/modules/system-admin/platform-settings";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "IMSDA",
    defaultTimezone: "America/Chicago",
    defaultAttendeeEditPolicy: "VERIFY_EVERY_EDIT",
    ...overrides,
  };
}

describe("platform settings invoice header (#780)", () => {
  it("is optional: left out or blank it is unset, so the invoice falls back to the organization name", () => {
    const parsed = platformSettingsInputSchema.parse(validInput());
    expect(parsed.invoiceHeaderDepartment).toBeNull();
    expect(parsed.invoiceHeaderOrganization).toBeNull();
    expect(parsed.invoiceHeaderAddress).toBeNull();
    expect(parsed.invoiceHeaderPhone).toBeNull();
    expect(platformSettingsInputSchema.parse(validInput({ invoiceHeaderDepartment: "  ", invoiceHeaderPhone: "" })).invoiceHeaderDepartment).toBeNull();
  });

  it("keeps the edited block, trimmed, with the address as lines", () => {
    const parsed = platformSettingsInputSchema.parse(validInput({
      invoiceHeaderDepartment: " Synthetic Youth Department ",
      invoiceHeaderOrganization: "Synthetic Test Conference",
      invoiceHeaderAddress: "100 Example Road\nSampletown, ZZ 00000",
      invoiceHeaderPhone: "555-0100",
    }));
    expect(parsed).toMatchObject({
      invoiceHeaderDepartment: "Synthetic Youth Department",
      invoiceHeaderOrganization: "Synthetic Test Conference",
      invoiceHeaderAddress: "100 Example Road\nSampletown, ZZ 00000",
      invoiceHeaderPhone: "555-0100",
    });
  });

  it("refuses more than four address lines or an over-long field", () => {
    expect(() => platformSettingsInputSchema.parse(validInput({ invoiceHeaderAddress: "a\nb\nc\nd\ne" }))).toThrow();
    expect(() => platformSettingsInputSchema.parse(validInput({ invoiceHeaderPhone: "5".repeat(41) }))).toThrow();
  });
});

describe("platform settings input", () => {
  it("treats a cleared field as unset rather than an empty string", () => {
    const parsed = platformSettingsInputSchema.parse(validInput({ logoUrl: "" }));
    // Null, not "". Inheritance asks whether a default exists, and an empty
    // string would answer yes while supplying nothing.
    expect(parsed.logoUrl).toBeNull();
  });

  it("does not edit the central email sender: that is System management > Email only (#1043)", () => {
    for (const field of ["defaultSenderName", "defaultSenderEmail", "defaultReplyToEmail"]) {
      expect(platformSettingsInputSchema.safeParse(validInput({ [field]: "IMSDA Events" })).success).toBe(false);
    }
  });

  it("rejects a malformed address and a malformed URL", () => {
    expect(platformSettingsInputSchema.safeParse(
      validInput({ logoUrl: "imsda.org/logo.png" }),
    ).success).toBe(false);
  });

  it("requires the fields an event cannot be created without", () => {
    expect(platformSettingsInputSchema.safeParse(
      validInput({ organizationName: "" }),
    ).success).toBe(false);
    expect(platformSettingsInputSchema.safeParse(
      validInput({ defaultTimezone: "" }),
    ).success).toBe(false);
  });

  it("refuses unknown fields rather than silently dropping them", () => {
    expect(platformSettingsInputSchema.safeParse(
      validInput({ deliveryMode: "EXTERNAL_EMAIL" }),
    ).success).toBe(false);
  });

  it("no longer takes the alert addresses: they are edited on Notifications, so this form cannot clear them (#1016)", () => {
    for (const field of ["supportContact", "securityAlertEmail", "newClubApplicationEmail"]) {
      expect(platformSettingsInputSchema.safeParse(validInput({ [field]: "a@imsda-events.test" })).success).toBe(false);
    }
  });
});

describe("platform alert addresses (#456, #817, #1016)", () => {
  it("are optional and never default to an address: blank means no notice", () => {
    const parsed = platformAddressesInputSchema.parse({});
    expect(parsed).toEqual({ supportContact: null, securityAlertEmail: null, newClubApplicationEmail: null });
    expect(platformAddressesInputSchema.parse({ newClubApplicationEmail: "  ", securityAlertEmail: "" })).toMatchObject({
      newClubApplicationEmail: null,
      securityAlertEmail: null,
    });
  });

  it("keep a valid address, trimmed and lower-cased, and refuse a malformed one", () => {
    const parsed = platformAddressesInputSchema.parse({
      newClubApplicationEmail: "  Youth.Assistant@IMSDA-Events.test ",
      securityAlertEmail: "  Security@IMSDA.org ",
      supportContact: " Help@IMSDA.org",
    });
    expect(parsed).toEqual({
      newClubApplicationEmail: "youth.assistant@imsda-events.test",
      securityAlertEmail: "security@imsda.org",
      supportContact: "help@imsda.org",
    });
    for (const field of ["supportContact", "securityAlertEmail", "newClubApplicationEmail"]) {
      expect(platformAddressesInputSchema.safeParse({ [field]: "not-an-address" }).success).toBe(false);
    }
  });

  it("refuse unknown fields", () => {
    expect(platformAddressesInputSchema.safeParse({ organizationName: "x" }).success).toBe(false);
  });

  it("are saved with an audit row holding both sides, in one transaction", async () => {
    const auditCreate = vi.fn();
    const upsert = vi.fn();
    const tx = {
      platformSettings: {
        findUnique: vi.fn().mockResolvedValue({ supportContact: "old@imsda-events.test", securityAlertEmail: null, newClubApplicationEmail: null }),
        upsert,
      },
      auditLog: { create: auditCreate },
    };
    database.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (work: (client: unknown) => unknown) => work(tx)),
      platformSettings: {
        upsert: vi.fn().mockResolvedValue({ updatedBy: null, updatedAt: new Date("2026-10-18T12:00:00.000Z") }),
      },
    });
    await updatePlatformAddresses(
      platformAddressesInputSchema.parse({ securityAlertEmail: "security@imsda-events.test" }),
      "admin-1",
    );
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { supportContact: null, securityAlertEmail: "security@imsda-events.test", newClubApplicationEmail: null, updatedByUserId: "admin-1" },
    }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "admin-1",
        action: "PLATFORM_ALERT_ADDRESSES_UPDATED",
        metadata: {
          before: { supportContact: "old@imsda-events.test", securityAlertEmail: null, newClubApplicationEmail: null },
          after: { supportContact: null, securityAlertEmail: "security@imsda-events.test", newClubApplicationEmail: null },
        },
      }),
    });
  });
});

describe("clearing the passkey domain", () => {
  function settingsDatabase(options: { currentRpId: string | null; passkeyOnlyStaff: number }) {
    const tx = {
      platformSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "platform",
          organizationName: "IMSDA",
          passkeyRpId: options.currentRpId,
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      user: { count: vi.fn().mockResolvedValue(options.passkeyOnlyStaff) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    };
    prisma.platformSettings = {
      ...tx.platformSettings,
      // The read-back after saving.
      upsert: vi.fn().mockResolvedValue({
        organizationName: "IMSDA",
        updatedAt: new Date("2026-09-25T00:00:00Z"),
        updatedBy: null,
        passkeyRpId: null,
      }),
    };
    database.getPrisma.mockReturnValue(prisma);
    return tx;
  }

  const cleared = () => platformSettingsInputSchema.parse(validInput({ passkeyRpId: "" }));

  it("is refused while staff can sign in only with a passkey (#456)", async () => {
    const tx = settingsDatabase({ currentRpId: "events.imsda.org", passkeyOnlyStaff: 2 });

    const attempt = updatePlatformSettings(cleared(), "admin-1");
    await expect(attempt).rejects.toBeInstanceOf(PlatformSettingsError);
    await expect(attempt).rejects.toThrow("2 staff sign in only with a passkey; they'd be locked out.");

    // Counted as: active accounts that must pass a second step (system admins
    // and anyone with an active event membership), with a live passkey and no
    // active authenticator.
    expect(tx.user.count).toHaveBeenCalledWith({
      where: {
        accountStatus: "ACTIVE",
        passkeys: { some: { revokedAt: null } },
        NOT: { mfaEnrollment: { is: { status: "ACTIVE" } } },
        OR: [
          { globalRole: "SYSTEM_ADMIN" },
          { memberships: { some: { status: "ACTIVE" } } },
        ],
      },
    });
    expect(tx.platformSettings.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("is allowed once every passkey user also has an authenticator", async () => {
    const tx = settingsDatabase({ currentRpId: "events.imsda.org", passkeyOnlyStaff: 0 });

    await updatePlatformSettings(cleared(), "admin-1");

    expect(tx.platformSettings.upsert).toHaveBeenCalled();
  });

  it("is refused for a change to a different domain too, which strands passkeys the same way", async () => {
    const tx = settingsDatabase({ currentRpId: "events.imsda.org", passkeyOnlyStaff: 1 });

    await expect(updatePlatformSettings(
      platformSettingsInputSchema.parse(validInput({ passkeyRpId: "portal.imsda.org" })),
      "admin-1",
    )).rejects.toThrow("1 staff sign in only with a passkey; they'd be locked out.");
    expect(tx.platformSettings.upsert).not.toHaveBeenCalled();
  });

  it("allows setting a domain for the first time without checking", async () => {
    const tx = settingsDatabase({ currentRpId: null, passkeyOnlyStaff: 3 });

    await updatePlatformSettings(
      platformSettingsInputSchema.parse(validInput({ passkeyRpId: "events.imsda.org" })),
      "admin-1",
    );

    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.platformSettings.upsert).toHaveBeenCalled();
  });

  it("does not check when the domain is unchanged", async () => {
    const tx = settingsDatabase({ currentRpId: "events.imsda.org", passkeyOnlyStaff: 3 });

    await updatePlatformSettings(
      platformSettingsInputSchema.parse(validInput({ passkeyRpId: "events.imsda.org" })),
      "admin-1",
    );

    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.platformSettings.upsert).toHaveBeenCalled();
  });
});

describe("stale-write baseline (#1076)", () => {
  function baselineDatabase() {
    const tx = {
      platformSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: "platform",
          organizationName: "IMSDA",
          logoUrl: null,
          publicWebsiteUrl: "https://imsda.org",
          defaultTimezone: "America/Chicago",
          defaultAttendeeEditPolicy: "VERIFY_EVERY_EDIT",
          passkeyRpId: null,
          invoiceHeaderPhone: null,
        }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      user: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    database.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
      platformSettings: {
        upsert: vi.fn().mockResolvedValue({ organizationName: "IMSDA", updatedAt: new Date("2026-09-25T00:00:00Z"), updatedBy: null }),
      },
    });
    return tx;
  }

  const matching = {
    organizationName: "IMSDA",
    logoUrl: "",
    publicWebsiteUrl: "https://imsda.org",
    defaultTimezone: "America/Chicago",
    defaultAttendeeEditPolicy: "VERIFY_EVERY_EDIT",
  };

  it("refuses the save and names the fields when someone else changed them since the page loaded", async () => {
    const tx = baselineDatabase();
    const attempt = updatePlatformSettings(
      { ...platformSettingsInputSchema.parse(validInput()), baseline: { ...matching, organizationName: "Old name", defaultTimezone: "UTC" } },
      "admin-1",
    );
    await expect(attempt).rejects.toMatchObject({
      code: "PLATFORM_SETTINGS_CONFLICT",
      fields: ["organizationName", "defaultTimezone"],
    });
    expect(tx.platformSettings.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("saves when the baseline still matches, and never writes the baseline to the row or the audit", async () => {
    const tx = baselineDatabase();
    await updatePlatformSettings(
      { ...platformSettingsInputSchema.parse(validInput({ organizationName: "IMSDA Renamed" })), baseline: matching },
      "admin-1",
    );
    const upsertCall = tx.platformSettings.upsert.mock.calls[0][0];
    expect(upsertCall.update).not.toHaveProperty("baseline");
    expect(upsertCall.create).not.toHaveProperty("baseline");
    expect(JSON.stringify(tx.auditLog.create.mock.calls[0][0])).not.toContain("baseline");
  });

  it("keeps today's behaviour when no baseline is sent", async () => {
    const tx = baselineDatabase();
    await updatePlatformSettings(platformSettingsInputSchema.parse(validInput({ organizationName: "Anything" })), "admin-1");
    expect(tx.platformSettings.upsert).toHaveBeenCalled();
  });

  it("the request schema accepts a string-valued baseline and still refuses unknown fields", async () => {
    const { platformSettingsRequestSchema } = await import("@/modules/system-admin/platform-settings");
    expect(platformSettingsRequestSchema.safeParse(validInput({ baseline: { organizationName: "IMSDA" } })).success).toBe(true);
    expect(platformSettingsRequestSchema.safeParse(validInput({ baseline: { organizationName: 1 } })).success).toBe(false);
    expect(platformSettingsRequestSchema.safeParse(validInput({ deliveryMode: "x" })).success).toBe(false);
  });
});
