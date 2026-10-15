import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #554 slice (c): with the one-sign-in switch on, /login and /account/sign-in
 * redirect to /sign-in (carrying `next` and `error`); with it off nothing
 * redirects and the old pages are exactly as before.
 */

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), enabled: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/account-merge/account-link", () => ({ isUnifiedSignInEnabled: mocks.enabled }));

import { redirectToUnifiedSignInWhenEnabled, unifiedSignInPathFor } from "@/modules/account-merge/sign-in-redirect";

beforeEach(() => vi.clearAllMocks());

describe("unifiedSignInPathFor", () => {
  it("carries next and error, and drops anything else or repeated", () => {
    expect(unifiedSignInPathFor({})).toBe("/sign-in");
    expect(unifiedSignInPathFor({ next: "/overview" })).toBe("/sign-in?next=%2Foverview");
    expect(unifiedSignInPathFor({ error: "google-expired", next: "/account/profile" })).toBe("/sign-in?next=%2Faccount%2Fprofile&error=google-expired");
    expect(unifiedSignInPathFor({ next: ["/a", "/b"], other: "x" })).toBe("/sign-in");
  });
});

describe("redirectToUnifiedSignInWhenEnabled", () => {
  it("redirects with the switch on", async () => {
    mocks.enabled.mockResolvedValue(true);
    await redirectToUnifiedSignInWhenEnabled({ next: "/overview" });
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in?next=%2Foverview");
  });

  it("does nothing with the switch off", async () => {
    mocks.enabled.mockResolvedValue(false);
    await redirectToUnifiedSignInWhenEnabled({ next: "/overview" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("treats an unreadable switch as off so the old pages keep working", async () => {
    mocks.enabled.mockRejectedValue(new Error("database unavailable"));
    await redirectToUnifiedSignInWhenEnabled({});
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("the old pages call it before anything else", () => {
  it.each(["app/login/page.tsx", "app/(public)/account/sign-in/page.tsx"])("%s", (file) => {
    const text = readFileSync(file, "utf8");
    const call = text.indexOf("await redirectToUnifiedSignInWhenEnabled(");
    expect(call).toBeGreaterThan(0);
    // Ahead of the signed-in redirects and every data read the page makes.
    for (const later of ["getCurrentSession()", "getCurrentAttendee()", "passkeysConfigured()"]) {
      const at = text.indexOf(`await ${later}`);
      if (at !== -1) expect(call).toBeLessThan(at);
    }
  });

  it("the /sign-in page sends visitors to /login while the switch is off", () => {
    const text = readFileSync("app/sign-in/page.tsx", "utf8");
    expect(text).toContain('if (!enabled) redirect("/login");');
    // Fail closed: an unreadable switch is "off".
    expect(text).toMatch(/try \{\s+enabled = await isUnifiedSignInEnabled\(\);\s+\} catch \{\s+enabled = false;/);
  });
});
