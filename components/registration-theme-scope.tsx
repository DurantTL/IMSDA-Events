import type { CSSProperties, ReactNode } from "react";
import styles from "./registration-theme-scope.module.css";

/**
 * Wraps a registration page in the event's published look (#283). `style` is the output of `registrationThemeStyle`: custom
 * properties only. With no style (the platform look) it renders its children unchanged, so an unthemed form is exactly as before.
 * Presentation only: it takes no business props and passes nothing to pricing, validation, capacity or submission.
 */
export function RegistrationThemeScope({ style, children }: { style: CSSProperties | undefined; children: ReactNode }) {
  if (!style) return <>{children}</>;
  return <div className={styles.themed} style={style}>{children}</div>;
}

/** The same look for a staff preview element that renders its own markup (the form builder's preview). */
export const registrationThemePreviewClassName = styles.themedPreview;
