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
  type ThemeHeroFocus,
} from "./tokens";

/** The part of a stored version this module reads. */
export type StoredThemeRow = { status: string; tokens: unknown; logoAssetId?: string | null; heroAssetId?: string | null };

/** The published logo and banner of a look, by upload id (the page turns an id into a URL). */
export type RegistrationBranding = {
  logo?: { assetId: string; alt: string };
  hero?: { assetId: string; alt: string; focus: ThemeHeroFocus };
};

/**
 * The look a registration page uses: the event's PUBLISHED version when its stored tokens still pass the schema and the contrast checks,
 * otherwise the platform default. A draft, an archived version, a missing row or tokens that fail the schema all give the
 * default, so a bad row can never break or restyle a public form.
 */
export function resolveRegistrationTheme(row: StoredThemeRow | null | undefined): RegistrationThemeTokens {
  return resolvePublishedTokens(row) ?? PLATFORM_DEFAULT_THEME;
}

/** The row's tokens when it is a published version that passes the schema and the contrast checks; null when the platform look applies. */
function resolvePublishedTokens(row: StoredThemeRow | null | undefined): RegistrationThemeTokens | null {
  if (!row || row.status !== "PUBLISHED") return null;
  const parsed = registrationThemeTokensSchema.safeParse(row.tokens);
  if (!parsed.success) return null;
  const tokens = normalizeThemeTokens(parsed.data);
  // Publishing checks contrast, but a row that got here another way (or under older rules) must not reach a public form.
  return checkThemeContrast(tokens).passes ? tokens : null;
}

/**
 * The published look's logo and banner, or an empty object. Only a row that resolves (published, valid, passing contrast)
 * has any: a row that falls back to the platform look has no images either. An image whose upload was deleted (its id is
 * cleared) or that has no description is left out, so the result is the same every time for the same row.
 */
export function resolveRegistrationBranding(row: StoredThemeRow | null | undefined): RegistrationBranding {
  const tokens = resolvePublishedTokens(row);
  if (!tokens || !row) return {};
  const branding: RegistrationBranding = {};
  if (row.logoAssetId && tokens.logoAlt) branding.logo = { assetId: row.logoAssetId, alt: tokens.logoAlt };
  if (row.heroAssetId && tokens.heroAlt) branding.hero = { assetId: row.heroAssetId, alt: tokens.heroAlt, focus: tokens.heroFocus ?? "center" };
  return branding;
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
