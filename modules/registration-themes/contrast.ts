import { contrastRatio, mixHex } from "./color";
import type { RegistrationThemeTokens } from "./tokens";

/** The text color on a primary button, and in the hero band: always white, so the check below is about primary itself. */
export const ON_PRIMARY = "#ffffff";

/** How much of a color goes into its soft tint over the surface. One table feeds both the check and the rendered variables. */
export const TINT_PERCENT = { primary: 10, accent: 10, success: 12, warning: 14, error: 10 } as const;

export type ThemeTints = Record<keyof typeof TINT_PERCENT, string>;

/** The soft backgrounds the registration CSS shows behind selected options, notices and badges (`--imsda-navy-soft` and its kin). */
export function deriveThemeTints(tokens: RegistrationThemeTokens): ThemeTints {
  return {
    primary: mixHex(tokens.primary, TINT_PERCENT.primary, tokens.surface),
    accent: mixHex(tokens.accent, TINT_PERCENT.accent, tokens.surface),
    success: mixHex(tokens.success, TINT_PERCENT.success, tokens.surface),
    warning: mixHex(tokens.warning, TINT_PERCENT.warning, tokens.surface),
    error: mixHex(tokens.error, TINT_PERCENT.error, tokens.surface),
  };
}

export type ContrastCheck = {
  id: string;
  /** Plain words: what is read against what. */
  label: string;
  foreground: string;
  background: string;
  /** Rounded down to two decimals for display. */
  ratio: number;
  minimum: 3 | 4.5;
  passes: boolean;
};

export type ThemeContrastReport = { checks: ContrastCheck[]; passes: boolean; failing: ContrastCheck[] };

/** WCAG 2.2: 4.5:1 for text, 3:1 for a focus or selected outline (SC 1.4.3 and 1.4.11). */
export function checkThemeContrast(tokens: RegistrationThemeTokens): ThemeContrastReport {
  const tints = deriveThemeTints(tokens);
  const checks: ContrastCheck[] = [];
  const add = (id: string, label: string, foreground: string, background: string, minimum: 3 | 4.5) => {
    const exact = contrastRatio(foreground, background);
    checks.push({ id, label, foreground, background, ratio: Math.floor(exact * 100) / 100, minimum, passes: exact >= minimum });
  };
  const { surface, pageBackground: page } = tokens;
  add("text-on-surface", "Text on cards", tokens.text, surface, 4.5);
  add("muted-on-surface", "Hint text on cards", tokens.muted, surface, 4.5);
  add("text-on-page", "Text on the page background", tokens.text, page, 4.5);
  add("muted-on-page", "Hint text on the page background", tokens.muted, page, 4.5);
  add("button-text-on-primary", "White button text on the main color", ON_PRIMARY, tokens.primary, 4.5);
  add("primary-link-on-surface", "Main color as link text on cards", tokens.primary, surface, 4.5);
  add("primary-link-on-page", "Main color as link text on the page background", tokens.primary, page, 4.5);
  add("accent-outline-on-surface", "Accent focus and selected outline on cards", tokens.accent, surface, 3);
  add("accent-outline-on-page", "Accent focus and selected outline on the page background", tokens.accent, page, 3);
  add("accent-text-on-surface", "Accent as text on cards", tokens.accent, surface, 4.5);
  add("accent-text-on-page", "Accent as text on the page background", tokens.accent, page, 4.5);
  add("success-on-surface", "Success text on cards", tokens.success, surface, 4.5);
  add("warning-on-surface", "Warning text on cards", tokens.warning, surface, 4.5);
  add("error-on-surface", "Error text on cards", tokens.error, surface, 4.5);
  add("primary-on-tint", "Main color on its soft tint", tokens.primary, tints.primary, 4.5);
  add("accent-on-tint", "Accent on its soft tint (selected options)", tokens.accent, tints.accent, 4.5);
  add("text-on-accent-tint", "Text on the accent tint (selected options)", tokens.text, tints.accent, 4.5);
  add("success-on-tint", "Success text on its soft tint", tokens.success, tints.success, 4.5);
  add("warning-on-tint", "Warning text on its soft tint", tokens.warning, tints.warning, 4.5);
  add("error-on-tint", "Error text on its soft tint", tokens.error, tints.error, 4.5);
  const failing = checks.filter((check) => !check.passes);
  return { checks, passes: failing.length === 0, failing };
}

/** One plain sentence per failing check, for the publish refusal. */
export function describeContrastFailures(report: ThemeContrastReport): string {
  return report.failing.map((check) => `${check.label} is ${check.ratio}:1 and needs ${check.minimum}:1`).join("; ");
}
