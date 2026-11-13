import { describe, expect, it } from "vitest";
import { checkThemeContrast, deriveThemeTints, TINT_PERCENT } from "@/modules/registration-themes/contrast";
import { contrastRatio, mixHex } from "@/modules/registration-themes/color";
import { registrationThemeStyle, resolveRegistrationTheme, themeCssVariables } from "@/modules/registration-themes/resolve";
import {
  PLATFORM_DEFAULT_THEME,
  THEME_FONT_STACKS,
  registrationThemeTokensSchema,
  type RegistrationThemeTokens,
} from "@/modules/registration-themes/tokens";

/** Registration themes (#283, slice 1): the token schema, the contrast checks, the resolver and the style it builds. Synthetic values only. */

const custom: RegistrationThemeTokens = {
  ...PLATFORM_DEFAULT_THEME,
  primary: "#1b4d3e",
  accent: "#7a2e65",
  headingFont: "classic-serif",
  contentWidth: "narrow",
  density: "compact",
  cardRadius: "round",
  shadow: "raised",
  buttonShape: "pill",
};

describe("registration theme tokens", () => {
  it("accepts the platform default and a custom theme", () => {
    expect(registrationThemeTokensSchema.safeParse(PLATFORM_DEFAULT_THEME).success).toBe(true);
    expect(registrationThemeTokensSchema.safeParse(custom).success).toBe(true);
  });

  it.each(["red", "#fff", "#12345", "#1234567", "rgb(0,0,0)", "url(https://example.test/x.png)", "#00000;", "#003b5c; background: red", "var(--x)", " #003b5c", "#00zz00"])(
    "rejects the color %s",
    (value) => {
      expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, primary: value }).success).toBe(false);
    },
  );

  it("rejects unknown fonts, web-font names and css in a font", () => {
    for (const value of ["Comic Sans MS", "Roboto", "inherit", "serif; color: red", "url(https://example.test/f.woff2)", "classic-serif, evil"]) {
      expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, headingFont: value }).success).toBe(false);
      expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, bodyFont: value }).success).toBe(false);
    }
  });

  it("rejects unknown choices, unknown keys and extra properties", () => {
    expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, contentWidth: "full" }).success).toBe(false);
    expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, shadow: "0 0 9px red" }).success).toBe(false);
    expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, customCss: "body{}" }).success).toBe(false);
    expect(registrationThemeTokensSchema.safeParse({ ...PLATFORM_DEFAULT_THEME, logoUrl: "https://example.test/a.png" }).success).toBe(false);
    const { primary: _primary, ...missing } = PLATFORM_DEFAULT_THEME; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(registrationThemeTokensSchema.safeParse(missing).success).toBe(false);
  });

  it("allows only system font stacks: no web-font download is named", () => {
    for (const stack of Object.values(THEME_FONT_STACKS)) expect(stack).not.toMatch(/url\(|;|\{|\}|https?:/);
  });
});

describe("registration theme contrast", () => {
  it("passes for the platform default, with every pair named", () => {
    const report = checkThemeContrast(PLATFORM_DEFAULT_THEME);
    expect(report.failing.map((check) => check.id)).toEqual([]);
    expect(report.passes).toBe(true);
    const ids = report.checks.map((check) => check.id);
    for (const id of ["text-on-surface", "muted-on-surface", "text-on-page", "muted-on-page", "button-text-on-primary", "primary-link-on-surface", "accent-outline-on-surface", "success-on-surface", "warning-on-surface", "error-on-surface", "primary-on-tint", "error-on-tint"]) {
      expect(ids).toContain(id);
    }
    expect(report.checks.find((check) => check.id === "accent-outline-on-surface")?.minimum).toBe(3);
    expect(report.checks.find((check) => check.id === "text-on-surface")?.minimum).toBe(4.5);
  });

  it("fails a low-contrast theme and names the failing pairs", () => {
    const report = checkThemeContrast({ ...PLATFORM_DEFAULT_THEME, primary: "#f0b323", muted: "#bbbbbb", error: "#ff9999" });
    expect(report.passes).toBe(false);
    const failing = report.failing.map((check) => check.id);
    expect(failing).toEqual(expect.arrayContaining(["button-text-on-primary", "primary-link-on-surface", "muted-on-surface", "muted-on-page", "error-on-surface", "error-on-tint"]));
    expect(report.failing.every((check) => check.ratio < check.minimum)).toBe(true);
    expect(report.checks.find((check) => check.id === "text-on-surface")?.passes).toBe(true);
  });

  it("checks the text on a derived tint against the color the stylesheet receives", () => {
    const tokens = { ...PLATFORM_DEFAULT_THEME, accent: "#7a2e65" };
    const tints = deriveThemeTints(tokens);
    expect(tints.accent).toBe(mixHex("#7a2e65", TINT_PERCENT.accent, tokens.surface));
    expect(themeCssVariables(tokens)["--imsda-purple-soft" as never]).toBe(tints.accent);
    const check = checkThemeContrast(tokens).checks.find((entry) => entry.id === "accent-on-tint")!;
    expect(check.background).toBe(tints.accent);
    expect(check.ratio).toBe(Math.floor(contrastRatio("#7a2e65", tints.accent) * 100) / 100);
  });

  it("computes the WCAG ratio (black on white is 21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("resolving the registration theme", () => {
  const published = (tokens: unknown, status = "PUBLISHED") => ({ status, tokens });

  it("uses the published tokens, with colors lowercased", () => {
    expect(resolveRegistrationTheme(published({ ...custom, primary: "#1B4D3E" }))).toEqual(custom);
  });

  it("falls back to the platform default for no row, invalid JSON, a draft and an archived version", () => {
    expect(resolveRegistrationTheme(null)).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(undefined)).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(published({ ...custom, primary: "url(x)" }))).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(published("not an object"))).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(published({ ...custom, extra: 1 }))).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(published(custom, "DRAFT"))).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(published(custom, "ARCHIVED"))).toBe(PLATFORM_DEFAULT_THEME);
  });

  it("falls back to the platform default when published tokens fail the contrast checks", () => {
    expect(resolveRegistrationTheme(published({ ...custom, primary: "#f0b323" }))).toBe(PLATFORM_DEFAULT_THEME);
    expect(resolveRegistrationTheme(published({ ...custom, muted: "#cccccc" }))).toBe(PLATFORM_DEFAULT_THEME);
  });

  it("is deterministic", () => {
    expect(resolveRegistrationTheme(published(custom))).toEqual(resolveRegistrationTheme(published(custom)));
    expect(registrationThemeStyle(custom)).toEqual(registrationThemeStyle(custom));
  });
});

describe("registration theme style", () => {
  it("is undefined for the platform default, so an unthemed form renders as before", () => {
    expect(registrationThemeStyle(PLATFORM_DEFAULT_THEME)).toBeUndefined();
    expect(registrationThemeStyle({ ...PLATFORM_DEFAULT_THEME, primary: "#003B5C" })).toBeUndefined();
  });

  it("holds only custom properties built from validated values", () => {
    const style = registrationThemeStyle(custom)!;
    expect(style).toBeDefined();
    const entries = Object.entries(style);
    expect(entries.length).toBeGreaterThan(10);
    for (const [key, value] of entries) {
      expect(key.startsWith("--")).toBe(true);
      expect(typeof value).toBe("string");
      expect(value).not.toMatch(/url\(|;|[{}<>]|expression|@import|javascript:/i);
    }
    const record = style as Record<string, string>;
    expect(record["--imsda-navy"]).toBe("#1b4d3e");
    expect(record["--imsda-purple"]).toBe("#7a2e65");
    expect(record["--reg-theme-font-heading"]).toBe(THEME_FONT_STACKS["classic-serif"]);
    expect(record["--reg-theme-max-width"]).toBe("900px");
    expect(record["--radius-theme-button"]).toBe("999px");
  });

  it("refuses tokens that skipped validation instead of emitting them", () => {
    expect(() => registrationThemeStyle({ ...custom, primary: "red; background:url(x)" })).toThrow();
    expect(() => registrationThemeStyle({ ...custom, headingFont: "evil" as never })).toThrow();
  });
});
