import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), logError: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ platformSettings: { findUnique: mocks.findUnique } }) }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: vi.fn(), logWarn: vi.fn() }));

import { getFormsHelpContact } from "@/modules/system-admin/platform-settings";
import { resolveFormsHelpContact, telHref } from "@/modules/system-admin/forms-help-contact";

/** The Forms help contact (#1445): settings first, per-field fallback, never throws. Synthetic data only. */
describe("Forms help contact", () => {
  it("uses the settings when present", async () => {
    mocks.findUnique.mockResolvedValue({ publicHelpEmail: " a@example.test ", publicHelpPhone: "(515) 555-0111" });
    expect(await getFormsHelpContact()).toEqual({ email: "a@example.test", phone: "(515) 555-0111" });
  });
  it("falls back per field when absent", async () => {
    mocks.findUnique.mockResolvedValue({ publicHelpEmail: null, publicHelpPhone: "(515) 555-0111" });
    expect(await getFormsHelpContact()).toEqual({ email: "support@imsda.org", phone: "(515) 555-0111" });
    mocks.findUnique.mockResolvedValue(null);
    expect(await getFormsHelpContact()).toEqual({ email: "support@imsda.org", phone: "(515) 223-1197" });
  });
  it("falls back and does not throw when the read fails", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db down"));
    expect(await getFormsHelpContact()).toEqual({ email: "support@imsda.org", phone: "(515) 223-1197" });
  });
  it("builds the tel link from the digits", () => {
    expect(telHref("(515) 223-1197")).toBe("tel:+15152231197");
    expect(telHref("1-515-223-1197")).toBe("tel:+15152231197");
    expect(resolveFormsHelpContact({ email: " ", phone: "" }).email).toBe("support@imsda.org");
  });
});

