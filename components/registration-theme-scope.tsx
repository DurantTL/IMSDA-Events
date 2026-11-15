import type { CSSProperties, ReactNode } from "react";
import { RegistrationBrandingProvider, type RegistrationBrandingImages } from "./registration-branding";
import styles from "./registration-theme-scope.module.css";

/**
 * Wraps a registration page in the event's published look (#283). `style` is the output of `registrationThemeStyle`: custom
 * properties only; `images` is the published logo and banner as URLs (see `registrationBrandingImages`). With no style (the platform look) it renders its children unchanged, so an unthemed form is exactly as before.
 * Presentation only: it takes no business props and passes nothing to pricing, validation, capacity or submission.
 */
export function RegistrationThemeScope({ style, images, children }: { style: CSSProperties | undefined; images?: RegistrationBrandingImages | null; children: ReactNode }) {
  // The logo and banner travel in a context the form's hero reads; with none, the provider adds nothing to the page.
  const content = <RegistrationBrandingProvider images={images}>{children}</RegistrationBrandingProvider>;
  if (!style) return content;
  return <div className={styles.themed} style={style}>{content}</div>;
}

/** The same look for a staff preview element that renders its own markup (the form builder's preview). */
export const registrationThemePreviewClassName = styles.themedPreview;
