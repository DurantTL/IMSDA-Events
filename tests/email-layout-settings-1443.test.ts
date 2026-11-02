import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  getCurrentSession: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/request-context", () => ({ withRequestContext: (handler: unknown) => handler }));
vi.mock("@/modules/access/request-security", () => ({ rejectCrossOriginRequest: () => null }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: mocks.getCurrentSession }));

import { PATCH } from "@/app/api/admin/platform-settings/route";
import {
  checkEmailHeaderName,
  checkEmailHelpEmail,
  checkEmailHelpPhone,
  DEFAULT_EMAIL_LAYOUT_SETTINGS,
} from "@/modules/communications/email-layout-domain";
import { loadEmailLayoutSettings } from "@/modules/communications/email-layout-settings";
import {
  PlatformSettingsError,
  platformSettingsInputSchema,
  updatePlatformSettings,
} from "@/modules/system-admin/platform-settings";

const base = { organizationName: "IMSDA", defaultTimezone: "America/Chicago", defaultAttendeeEditPolicy: "TIERED" };

describe("email layout settings validation (#1443)", () => {
  it("accepts a header name of 1 to 40 characters, trimmed, and refuses 0, 41 or a control character", () => {
    expect(platformSettingsInputSchema.parse({ ...base, emailHeaderName: "  IMSDA Club Ministry " }).emailHeaderName).toBe("IMSDA Club Ministry");
    expect(platformSettingsInputSchema.parse({ ...base, emailClubHeaderName: "x".repeat(40) }).emailClubHeaderName).toBe("x".repeat(40));
    expect(platformSettingsInputSchema.safeParse({ ...base, emailHeaderName: "   " }).success).toBe(false);
    expect(platformSettingsInputSchema.safeParse({ ...base, emailHeaderName: "" }).success).toBe(false);
    expect(platformSettingsInputSchema.safeParse({ ...base, emailClubHeaderName: "x".repeat(41) }).success).toBe(false);
    expect(platformSettingsInputSchema.safeParse({ ...base, emailHeaderName: "Bad\u0007name" }).success).toBe(false);
    expect(checkEmailHeaderName("Two\nlines")).toEqual({ ok: true, value: "Two lines" });
  });

  it("keeps markup in a name as text (it is escaped where it is shown), within the length limit", () => {
    expect(platformSettingsInputSchema.parse({ ...base, emailHeaderName: "<script>x</script>" }).emailHeaderName).toBe("<script>x</script>");
  });

  it("validates the help email like the other emails and stores it in lower case; blank clears it", () => {
    expect(platformSettingsInputSchema.parse({ ...base, emailHelpEmail: " Support@IMSDA.org " }).emailHelpEmail).toBe("support@imsda.org");
    expect(platformSettingsInputSchema.parse({ ...base, emailHelpEmail: "" }).emailHelpEmail).toBeNull();
    expect(platformSettingsInputSchema.safeParse({ ...base, emailHelpEmail: "not-an-address" }).success).toBe(false);
    expect(checkEmailHelpEmail("nope")).toMatchObject({ ok: false });
    expect(checkEmailHelpEmail("")).toEqual({ ok: true, value: null });
  });

  it("leaves an absent contact alone, which is different from clearing it", () => {
    const parsed = platformSettingsInputSchema.parse(base);
    expect(parsed.emailHelpEmail).toBeUndefined();
    expect(parsed.emailHelpPhone).toBeUndefined();
    expect(parsed.emailHeaderName).toBeUndefined();
  });

  it("judges the phone with the shared phone check and stores it in one form", () => {
    expect(checkEmailHelpPhone("515.555.0100")).toEqual({ ok: true, value: "(515) 555-0100" });
    expect(checkEmailHelpPhone("(555) 010-0100")).toMatchObject({ ok: false });
    expect(checkEmailHelpPhone("5550100")).toMatchObject({ ok: false });
    expect(checkEmailHelpPhone("")).toEqual({ ok: true, value: null });
  });

  function database(stored: Record<string, unknown> = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      platformSettings: {
        findUnique: vi.fn().mockResolvedValue({ id: "platform", organizationName: "IMSDA", ...stored }),
        upsert: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
      platformSettings: { upsert: vi.fn().mockResolvedValue({ organizationName: "IMSDA", updatedAt: new Date("2026-11-01T00:00:00Z"), updatedBy: null }) },
    });
    return tx;
  }

  it("refuses an invalid phone on save without echoing it and writes nothing", async () => {
    const tx = database();
    const attempt = updatePlatformSettings(platformSettingsInputSchema.parse({ ...base, emailHelpPhone: "call-me-maybe" }), "admin-1");
    await expect(attempt).rejects.toBeInstanceOf(PlatformSettingsError);
    await expect(attempt).rejects.toThrow(/^Email help phone:/);
    await expect(attempt).rejects.not.toThrow("call-me-maybe");
    expect(tx.platformSettings.upsert).not.toHaveBeenCalled();
  });

  it("saves a valid phone and the names in their stored form, and audits both sides", async () => {
    const tx = database({ emailHeaderName: "IMSDA Events", emailClubHeaderName: "IMSDA Events", emailHelpPhone: "(515) 223-1197" });
    await updatePlatformSettings(platformSettingsInputSchema.parse({
      ...base,
      emailHeaderName: "IMSDA Events",
      emailClubHeaderName: "IMSDA Club Ministry",
      emailHelpEmail: "help@example.org",
      emailHelpPhone: "515-555-0100",
    }), "admin-1");
    expect(tx.platformSettings.upsert.mock.calls[0][0].update).toMatchObject({
      emailClubHeaderName: "IMSDA Club Ministry",
      emailHelpEmail: "help@example.org",
      emailHelpPhone: "(515) 555-0100",
    });
    const audit = tx.auditLog.create.mock.calls[0][0].data.metadata;
    expect(audit.before).toMatchObject({ emailClubHeaderName: "IMSDA Events", emailHelpPhone: "(515) 223-1197" });
    expect(audit.after).toMatchObject({ emailClubHeaderName: "IMSDA Club Ministry", emailHelpPhone: "(515) 555-0100" });
  });

  it("does not write a contact the request left out", async () => {
    const tx = database({ emailHelpEmail: "support@imsda.org" });
    await updatePlatformSettings(platformSettingsInputSchema.parse(base), "admin-1");
    expect(tx.platformSettings.upsert.mock.calls[0][0].update).not.toHaveProperty("emailHelpEmail", null);
  });
});

describe("PATCH /api/admin/platform-settings with the email layout fields (#1443)", () => {
  const request = (payload: unknown) => new Request("http://localhost/api/admin/platform-settings", { method: "PATCH", body: JSON.stringify(payload) });
  const call = (payload: unknown) => (PATCH as unknown as (request: Request) => Promise<Response>)(request(payload));

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "admin-1", globalRole: "SYSTEM_ADMIN" } });
  });

  it("refuses everyone but a system administrator, before any parsing", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "staff-1", globalRole: "NONE" } });
    expect((await call({ ...base, emailHeaderName: "Anything" })).status).toBe(403);
    mocks.getCurrentSession.mockResolvedValue({ user: null });
    expect((await call({ ...base })).status).toBe(403);
  });

  it("answers 400 with the field's own message for a 41-character name, a bad email or a blank name", async () => {
    for (const [field, value, path] of [
      ["emailClubHeaderName", "x".repeat(41), "emailClubHeaderName"],
      ["emailHeaderName", " ", "emailHeaderName"],
      ["emailHelpEmail", "nope", "emailHelpEmail"],
    ] as const) {
      const response = await call({ ...base, [field]: value });
      expect(response.status, field).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("INVALID_PLATFORM_SETTINGS");
      expect(body.issues[0].path[0]).toBe(path);
    }
  });

  it("passes valid values through to the update", async () => {
    // The route uses the real module, so spy on the database through the transaction instead.
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      platformSettings: { findUnique: vi.fn().mockResolvedValue({ id: "platform", organizationName: "IMSDA" }), upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
      platformSettings: { upsert: vi.fn().mockResolvedValue({ organizationName: "IMSDA", updatedAt: new Date("2026-11-01T00:00:00Z"), updatedBy: null, emailHeaderName: "IMSDA Events", emailClubHeaderName: "IMSDA Club Ministry", emailHelpEmail: "help@example.org", emailHelpPhone: "(515) 555-0100" }) },
    });
    const response = await call({ ...base, emailClubHeaderName: "IMSDA Club Ministry", emailHelpEmail: "help@example.org", emailHelpPhone: "(515) 555-0100" });
    expect(response.status).toBe(200);
    expect((await response.json()).settings).toMatchObject({ emailClubHeaderName: "IMSDA Club Ministry", emailHelpEmail: "help@example.org" });
    expect(tx.platformSettings.upsert.mock.calls[0][0].update).toMatchObject({ emailClubHeaderName: "IMSDA Club Ministry", emailHelpPhone: "(515) 555-0100" });
  });

  it("answers 400 for a phone the shared check refuses", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      platformSettings: { findUnique: vi.fn().mockResolvedValue({ id: "platform" }), upsert: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    mocks.getPrisma.mockReturnValue({ $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) });
    const response = await call({ ...base, emailHelpPhone: "(555) 010-0100" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_SETTING");
    expect(tx.platformSettings.upsert).not.toHaveBeenCalled();
  });
});

describe("reading the settings for a delivery run (#1443)", () => {
  it("returns the defaults for a missing row, a missing table, or a failed read", async () => {
    expect(await loadEmailLayoutSettings({})).toEqual(DEFAULT_EMAIL_LAYOUT_SETTINGS);
    expect(await loadEmailLayoutSettings({ platformSettings: { findUnique: vi.fn(async () => null) } })).toEqual(DEFAULT_EMAIL_LAYOUT_SETTINGS);
    expect(await loadEmailLayoutSettings({ platformSettings: { findUnique: vi.fn(async () => { throw new Error("db down"); }) } })).toEqual(DEFAULT_EMAIL_LAYOUT_SETTINGS);
  });

  it("returns what is stored, including a cleared contact", async () => {
    const settings = await loadEmailLayoutSettings({
      platformSettings: {
        findUnique: vi.fn(async () => ({ emailHeaderName: "A", emailClubHeaderName: "B", emailHelpEmail: null, emailHelpPhone: "(515) 555-0100" })),
      },
    });
    expect(settings).toEqual({ headerName: "A", clubHeaderName: "B", helpEmail: null, helpPhone: "(515) 555-0100" });
  });
});
