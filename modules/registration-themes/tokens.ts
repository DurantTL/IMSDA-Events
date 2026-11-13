import { z } from "zod";

/**
 * The constrained token set for an event's registration look (#283). A theme is data, never CSS: every value is checked
 * here against a closed list or a strict pattern, so nothing a person types can become a stylesheet rule, a URL or a script.
 * Fonts are system stacks only (no web-font downloads, no uploaded files). Adding a token means adding it here first.
 */

/** A color is exactly `#` and six hex digits. No named colors, no functions, no alpha, no URLs. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const colorToken = z.string().regex(HEX_COLOR, "Use a six-digit hex color such as #003b5c.");

export const THEME_COLOR_KEYS = ["primary", "accent", "surface", "text", "muted", "success", "warning", "error", "pageBackground"] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** The platform's own font, then system font stacks that every device already has. The value is the CSS font-family list. */
export const THEME_FONT_STACKS = {
  platform: '"Noto Sans", "Noto Sans Fallback", Arial, sans-serif',
  "system-sans": 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "humanist-sans": '"Trebuchet MS", "Gill Sans", Calibri, "Segoe UI", sans-serif',
  "geometric-sans": '"Century Gothic", "Avenir Next", Avenir, "Segoe UI", sans-serif',
  "classic-serif": 'Georgia, "Times New Roman", Times, serif',
} as const;
export type ThemeFontKey = keyof typeof THEME_FONT_STACKS;
export const THEME_FONT_KEYS = Object.keys(THEME_FONT_STACKS) as [ThemeFontKey, ...ThemeFontKey[]];

export const THEME_FONT_LABELS: Record<ThemeFontKey, string> = {
  platform: "Platform font",
  "system-sans": "System sans-serif",
  "humanist-sans": "Humanist sans-serif",
  "geometric-sans": "Geometric sans-serif",
  "classic-serif": "Classic serif",
};

export const THEME_CONTENT_WIDTHS = { narrow: "900px", standard: "1180px", wide: "1360px" } as const;
export const THEME_DENSITIES = { comfortable: { gap: "16px", fieldGap: "15px" }, compact: { gap: "10px", fieldGap: "9px" } } as const;
export const THEME_CARD_RADII = { square: "4px", soft: "19px", round: "28px" } as const;
export const THEME_SHADOWS = {
  none: "none",
  subtle: "0 8px 28px rgba(0, 0, 0, 0.06)",
  raised: "0 14px 40px rgba(0, 0, 0, 0.16)",
} as const;
export const THEME_BUTTON_RADII = { rounded: "10px", pill: "999px", square: "2px" } as const;

export const registrationThemeTokensSchema = z
  .object({
    primary: colorToken,
    accent: colorToken,
    surface: colorToken,
    text: colorToken,
    muted: colorToken,
    success: colorToken,
    warning: colorToken,
    error: colorToken,
    pageBackground: colorToken,
    headingFont: z.enum(THEME_FONT_KEYS),
    bodyFont: z.enum(THEME_FONT_KEYS),
    contentWidth: z.enum(["narrow", "standard", "wide"]),
    density: z.enum(["comfortable", "compact"]),
    cardRadius: z.enum(["square", "soft", "round"]),
    shadow: z.enum(["none", "subtle", "raised"]),
    buttonShape: z.enum(["rounded", "pill", "square"]),
  })
  .strict();

export type RegistrationThemeTokens = z.infer<typeof registrationThemeTokensSchema>;

/** Today's look, from `:root` in app/globals.css (--imsda-navy, --imsda-purple, --card, --ink, --muted, --green, --gold-text, --coral, --paper). */
export const PLATFORM_DEFAULT_THEME: RegistrationThemeTokens = {
  primary: "#003b5c",
  accent: "#582c83",
  surface: "#ffffff",
  text: "#243640",
  muted: "#536872",
  success: "#267357",
  warning: "#805807",
  error: "#a95549",
  pageBackground: "#f4f7f8",
  headingFont: "platform",
  bodyFont: "platform",
  contentWidth: "standard",
  density: "comfortable",
  cardRadius: "soft",
  shadow: "subtle",
  buttonShape: "rounded",
};

/** Lowercases colors so two spellings of one theme compare equal. */
export function normalizeThemeTokens(tokens: RegistrationThemeTokens): RegistrationThemeTokens {
  const next = { ...tokens };
  for (const key of THEME_COLOR_KEYS) next[key] = tokens[key].toLowerCase();
  return next;
}

export function isPlatformDefaultTheme(tokens: RegistrationThemeTokens) {
  const a = normalizeThemeTokens(tokens);
  const b = PLATFORM_DEFAULT_THEME;
  return (Object.keys(b) as (keyof RegistrationThemeTokens)[]).every((key) => a[key] === b[key]);
}
