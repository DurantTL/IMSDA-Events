import type { CSSProperties } from "react";
import { checkThemeContrast, deriveThemeTints, ON_PRIMARY } from "./contrast";
import { mixHex } from "./color";
import {
  isPlatformDefaultTheme,
  normalizeThemeTokens,
  PLATFORM_DEFAULT_THEME,
  registrationThemeTokensSchema,
  THEME_BUTTON_RADII,
  THEME_CARD_RADII,
  THEME_CONTENT_WIDTHS,
  THEME_DENSITIES,
  THEME_FONT_STACKS,
  THEME_SHADOWS,
  type RegistrationThemeTokens,
} from "./tokens";

/** The part of a stored version this module reads. */
export type StoredThemeRow = { status: string; tokens: unknown };

/**
 * The look a registration page uses: the event's PUBLISHED version when its stored tokens still pass the schema and the contrast checks,
 * otherwise the platform default. A draft, an archived version, a missing row or tokens that fail the schema all give the
 * default, so a bad row can never break or restyle a public form.
 */
export function resolveRegistrationTheme(row: StoredThemeRow | null | undefined): RegistrationThemeTokens {
  if (!row || row.status !== "PUBLISHED") return PLATFORM_DEFAULT_THEME;
  const parsed = registrationThemeTokensSchema.safeParse(row.tokens);
  if (!parsed.success) return PLATFORM_DEFAULT_THEME;
  const tokens = normalizeThemeTokens(parsed.data);
  // Publishing checks contrast, but a row that got here another way (or under older rules) must not reach a public form.
  return checkThemeContrast(tokens).passes ? tokens : PLATFORM_DEFAULT_THEME;
}

/**
 * The CSS custom properties for a theme, and nothing else: every key starts with `--` and every value is built from a
 * validated hex color or a constant looked up by an allowlisted key, never from a stored string. Returns undefined for the
 * platform default so an unthemed form renders exactly as it does today.
 *
 * It overrides the custom properties the registration CSS already reads (the `--imsda-*` colors, `--ink`, `--muted`,
 * `--card`, `--paper`, `--field-focus`, `--focus-ring`, the soft tints) and adds `--reg-theme-*` / `--radius-theme-*`
 * variables that registration-theme-scope.module.css consumes.
 */
export function registrationThemeStyle(tokens: RegistrationThemeTokens): CSSProperties | undefined {
  const safe = registrationThemeTokensSchema.parse(normalizeThemeTokens(tokens));
  return isPlatformDefaultTheme(safe) ? undefined : themeCssVariables(safe);
}

/** The same custom properties for any valid theme, the platform default included (the staff editor's sample always needs them). */
export function themeCssVariables(tokens: RegistrationThemeTokens): CSSProperties {
  const safe = registrationThemeTokensSchema.parse(normalizeThemeTokens(tokens));
  const tints = deriveThemeTints(safe);
  const vars: Record<`--${string}`, string> = {
    "--imsda-navy": safe.primary,
    "--imsda-navy-deep": mixHex("#000000", 25, safe.primary),
    "--imsda-navy-soft": tints.primary,
    "--imsda-purple": safe.accent,
    "--imsda-purple-soft": tints.accent,
    "--focus-ring": safe.accent,
    "--field-focus": safe.accent,
    "--ink": safe.text,
    "--muted": safe.muted,
    "--card": safe.surface,
    "--field-bg": safe.surface,
    "--paper": safe.pageBackground,
    "--green": safe.success,
    "--green-soft": tints.success,
    "--gold-text": safe.warning,
    "--imsda-gold-soft": tints.warning,
    "--coral": safe.error,
    "--coral-soft": tints.error,
    "--reg-theme-on-primary": ON_PRIMARY,
    "--reg-theme-page-bg": safe.pageBackground,
    "--reg-theme-font-heading": THEME_FONT_STACKS[safe.headingFont],
    "--reg-theme-font-body": THEME_FONT_STACKS[safe.bodyFont],
    "--reg-theme-max-width": THEME_CONTENT_WIDTHS[safe.contentWidth],
    "--reg-theme-gap": THEME_DENSITIES[safe.density].gap,
    "--reg-theme-field-gap": THEME_DENSITIES[safe.density].fieldGap,
    "--reg-theme-shadow": THEME_SHADOWS[safe.shadow],
    "--radius-theme-card": THEME_CARD_RADII[safe.cardRadius],
    "--radius-theme-button": THEME_BUTTON_RADII[safe.buttonShape],
  };
  return vars as CSSProperties;
}
