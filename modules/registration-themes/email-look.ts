import { checkThemeContrast } from "./contrast";
import { normalizeThemeTokens, registrationThemeTokensSchema } from "./tokens";

/**
 * The part of an event's registration look that its email layout uses (#283): two colors, the event name and an optional
 * logo with its description. Nothing else from the look reaches an email, and every value is either a validated `#rrggbb`
 * or plain text the layout escapes.
 */
export type EmailLook = {
  primary: string;
  accent: string;
  eventName: string;
  logo?: { src: string; alt: string };
};

/** A stored version row as the email look reads it. */
export type EmailLookVersionRow = { status: string; tokens: unknown; logoAssetId?: string | null };

export type EmailLookEvent = { slug: string; name: string; isPublished: boolean; archivedAt: Date | string | null };

export const EMAIL_LOOK_HEX = /^#[0-9a-f]{6}$/;

/** The logo as the public asset route serves it. Width 640 is the smallest size the route resizes to. */
export function emailLogoUrl(origin: string, eventSlug: string, assetId: string) {
  return `${origin}/api/public/events/${encodeURIComponent(eventSlug)}/assets/${encodeURIComponent(assetId)}?w=640`;
}

/**
 * The email look for a stored version, or null when the platform layout applies. A PUBLISHED or ARCHIVED version counts (both
 * are immutable history, so a retry of a message sent under an older look still has its look); a DRAFT never does. The tokens
 * must pass the schema and the contrast checks, which include white text on the main color. The logo is used only when the
 * event is published and not archived (otherwise the public file route would refuse it), the upload still exists, the
 * description exists and the site's address is known; without it the event name shows in the header.
 */
export function resolveEmailLook(input: {
  row: EmailLookVersionRow | null | undefined;
  event: EmailLookEvent | null | undefined;
  logoAssetExists: boolean;
  appOrigin: string | null;
}): EmailLook | null {
  const { row, event } = input;
  if (!row || !event || (row.status !== "PUBLISHED" && row.status !== "ARCHIVED")) return null;
  const parsed = registrationThemeTokensSchema.safeParse(row.tokens);
  if (!parsed.success) return null;
  const tokens = normalizeThemeTokens(parsed.data);
  if (!checkThemeContrast(tokens).passes) return null;
  if (!EMAIL_LOOK_HEX.test(tokens.primary) || !EMAIL_LOOK_HEX.test(tokens.accent)) return null;
  const eventName = event.name.replace(/\s+/g, " ").trim();
  if (!eventName) return null;
  const look: EmailLook = { primary: tokens.primary, accent: tokens.accent, eventName };
  const logoAlt = tokens.logoAlt?.trim();
  if (row.logoAssetId && input.logoAssetExists && logoAlt && input.appOrigin && event.isPublished && !event.archivedAt) {
    look.logo = { src: emailLogoUrl(input.appOrigin, event.slug, row.logoAssetId), alt: logoAlt };
  }
  return look;
}
