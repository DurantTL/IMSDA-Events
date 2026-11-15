"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ThemeHeroFocus } from "@/modules/registration-themes/tokens";
import { THEME_HERO_FOCUS_POSITIONS } from "@/modules/registration-themes/tokens";
import styles from "./registration-branding.module.css";

/**
 * The event's logo and banner for a registration page (#283), already turned into URLs by the page. Presentation only: the
 * form reads it to draw two pictures and nothing else, so it has no way to touch pricing, validation, capacity or submission.
 */
export type RegistrationBrandingImages = {
  logo?: { src: string; alt: string };
  hero?: { src: string; srcSet?: string; alt: string; focus: ThemeHeroFocus };
};

const BrandingContext = createContext<RegistrationBrandingImages | null>(null);

export function RegistrationBrandingProvider({ images, children }: { images: RegistrationBrandingImages | null | undefined; children?: ReactNode }) {
  if (!images || (!images.logo && !images.hero)) return <>{children}</>;
  return <BrandingContext.Provider value={images}>{children}</BrandingContext.Provider>;
}

/** The banner as its own strip, never behind text. Nothing at all (not even an empty wrapper) without a banner. */
export function RegistrationBannerStrip({ compact = false }: { compact?: boolean }) {
  const hero = useContext(BrandingContext)?.hero;
  if (!hero) return null;
  return (
    <div className={compact ? `${styles.banner} ${styles.compact}` : styles.banner} data-testid="registration-banner">
      {/* eslint-disable-next-line @next/next/no-img-element -- the event's own upload, served by the asset route */}
      <img alt={hero.alt} className={styles.bannerImage} height={300} sizes="(min-width: 1228px) 1180px, 100vw" src={hero.src} srcSet={hero.srcSet} style={{ objectPosition: THEME_HERO_FOCUS_POSITIONS[hero.focus] }} width={1200} />
    </div>
  );
}

/** The logo on a light tile so any logo, light or dark, can be read. Nothing without a logo. */
export function RegistrationLogoTile() {
  const logo = useContext(BrandingContext)?.logo;
  if (!logo) return null;
  return (
    <div className={styles.logoTile} data-testid="registration-logo">
      {/* eslint-disable-next-line @next/next/no-img-element -- the event's own upload, served by the asset route */}
      <img alt={logo.alt} className={styles.logoImage} src={logo.src} />
    </div>
  );
}
