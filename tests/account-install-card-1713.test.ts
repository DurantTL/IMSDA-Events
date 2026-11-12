import { describe, expect, it } from "vitest";
import { INSTALL_CARD_DISMISSED_KEYS, installCardVariant, type InstallCardInput } from "@/lib/install-card";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const base: InstallCardInput = {
  userAgent: DESKTOP_CHROME, platform: "Win32", maxTouchPoints: 0,
  standalone: false, installPromptAvailable: false, dismissed: false, installed: false,
};
const variant = (over: Partial<InstallCardInput>) => installCardVariant({ ...base, ...over });

describe("install card variant with the Web Install API (#1713)", () => {
  it("offers Install when navigator.install exists, with or without the prompt event", () => {
    expect(variant({ webInstallAvailable: true })).toBe("install");
    expect(variant({ webInstallAvailable: true, installPromptAvailable: true })).toBe("install");
  });

  it("never offers a button when neither mechanism exists", () => {
    expect(variant({ webInstallAvailable: false })).toBe("none");
    expect(variant({})).toBe("none");
  });

  it("keeps the iOS Share steps and hides when saved, installed or dismissed", () => {
    expect(variant({ userAgent: IPHONE_SAFARI, platform: "iPhone", maxTouchPoints: 5, webInstallAvailable: true })).toBe("ios-safari");
    for (const flag of ["standalone", "installed", "dismissed"] as const) {
      expect(variant({ webInstallAvailable: true, [flag]: true })).toBe("none");
    }
  });
});

describe("dismiss keys (#1713)", () => {
  it("uses a separate stored key for the account card and keeps the staff key unchanged", () => {
    expect(INSTALL_CARD_DISMISSED_KEYS.staff).toBe("imsda-staff-install-card-dismissed");
    expect(INSTALL_CARD_DISMISSED_KEYS.account).toBe("imsda-account-install-card-dismissed");
    expect(INSTALL_CARD_DISMISSED_KEYS.account).not.toBe(INSTALL_CARD_DISMISSED_KEYS.staff);
  });
});
