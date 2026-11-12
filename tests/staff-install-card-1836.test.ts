import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installCardVariant, isIosDevice, type InstallCardInput } from "@/lib/install-card";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_EDGE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/130.0 Mobile/15E148 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DESKTOP_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";

const base: InstallCardInput = {
  userAgent: DESKTOP_CHROME, platform: "Win32", maxTouchPoints: 0,
  standalone: false, installPromptAvailable: false, dismissed: false, installed: false,
};
const variant = (over: Partial<InstallCardInput>) => installCardVariant({ ...base, ...over });
const iphone = { userAgent: IPHONE_SAFARI, platform: "iPhone", maxTouchPoints: 5 };

describe("staff install card variant (#1836)", () => {
  it("offers Install in Chromium only once the prompt has fired", () => {
    expect(variant({ installPromptAvailable: true })).toBe("install");
    expect(variant({ userAgent: ANDROID_CHROME, platform: "Linux armv81", maxTouchPoints: 5, installPromptAvailable: true })).toBe("install");
    expect(variant({})).toBe("none");
  });

  it("shows nothing on Android without the prompt, and on desktop Safari or Firefox", () => {
    expect(variant({ userAgent: ANDROID_CHROME, platform: "Linux armv81", maxTouchPoints: 5 })).toBe("none");
    expect(variant({ userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 0 })).toBe("none");
    expect(variant({ userAgent: DESKTOP_FIREFOX, platform: "Win32" })).toBe("none");
  });

  it("shows the Share steps in iPhone and iPad Safari, with or without a prompt", () => {
    expect(variant(iphone)).toBe("ios-safari");
    expect(variant({ ...iphone, installPromptAvailable: true })).toBe("ios-safari");
    expect(variant({ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPad", maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("treats iPadOS with a Mac user agent as an iPad, and a real Mac as not", () => {
    const ipados = { userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 5 };
    expect(isIosDevice(ipados)).toBe(true);
    expect(variant(ipados)).toBe("ios-safari");
    expect(isIosDevice({ ...ipados, maxTouchPoints: 0 })).toBe(false);
    expect(isIosDevice({ ...ipados, maxTouchPoints: 1 })).toBe(false);
  });

  it("asks iPhone and iPad users of other browsers to open Safari", () => {
    for (const userAgent of [IPHONE_CHROME, IPHONE_FIREFOX, IPHONE_EDGE]) {
      expect(variant({ ...iphone, userAgent })).toBe("ios-other-browser");
    }
    expect(variant({ userAgent: IPHONE_CHROME, platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios-other-browser");
  });

  it("never shows when standalone, installed or dismissed, in any browser", () => {
    for (const device of [{}, iphone, { ...iphone, userAgent: IPHONE_CHROME }]) {
      for (const flag of ["standalone", "installed", "dismissed"] as const) {
        expect(variant({ ...device, installPromptAvailable: true, [flag]: true })).toBe("none");
      }
    }
  });

  it("loads the install-prompt listener from the staff layout, so a prompt fired on another staff page is kept", () => {
    const layout = readFileSync(path.join(process.cwd(), "app/(workspace)/layout.tsx"), "utf8");
    expect(layout).toContain('import { StaffInstallPromptCapture } from "@/components/staff-install-card";');
    expect(layout).toContain("<StaffInstallPromptCapture />");
    const card = readFileSync(path.join(process.cwd(), "components/install-card.tsx"), "utf8");
    expect(card).toMatch(/if \(typeof window !== "undefined"\) \{\n  window\.addEventListener\("beforeinstallprompt"/);
  });
});
