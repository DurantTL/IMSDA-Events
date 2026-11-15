import { publicEventAssetUrl } from "@/components/event-content-blocks";
import type { RegistrationBranding } from "@/modules/registration-themes/resolve";
import type { RegistrationBrandingImages } from "@/components/registration-branding";

/** Widths the public asset route can resize to (modules/events/asset-variant-widths.ts); the banner offers three. */
const BANNER_WIDTHS = [640, 1280, 1920] as const;

/** The published logo and banner as public URLs for a page of this event or undefined when there are none. */
export function publicRegistrationBrandingImages(branding: RegistrationBranding, eventSlug: string): RegistrationBrandingImages | undefined {
  const images: RegistrationBrandingImages = {};
  if (branding.logo) images.logo = { src: `${publicEventAssetUrl(eventSlug, branding.logo.assetId)}?w=640`, alt: branding.logo.alt };
  if (branding.hero) {
    const base = publicEventAssetUrl(eventSlug, branding.hero.assetId);
    images.hero = {
      src: `${base}?w=1280`,
      srcSet: BANNER_WIDTHS.map((width) => `${base}?w=${width} ${width}w`).join(", "),
      alt: branding.hero.alt,
      focus: branding.hero.focus,
    };
  }
  return images.logo || images.hero ? images : undefined;
}

/** The staff view of the same images: the event's own inline asset URLs at original size. They work before the event is published, but only for CONFIGURE_EVENT. */
export function staffRegistrationBrandingImages(branding: RegistrationBranding, eventId: string): RegistrationBrandingImages | undefined {
  const url = (assetId: string) => `/api/events/${encodeURIComponent(eventId)}/assets/${encodeURIComponent(assetId)}?disposition=inline`;
  const images: RegistrationBrandingImages = {};
  if (branding.logo) images.logo = { src: url(branding.logo.assetId), alt: branding.logo.alt };
  if (branding.hero) images.hero = { src: url(branding.hero.assetId), alt: branding.hero.alt, focus: branding.hero.focus };
  return images.logo || images.hero ? images : undefined;
}
