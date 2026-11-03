import type { ComponentProps, ReactNode } from "react";
import Image from "next/image";
import { BRAND_CALENDAR_LABEL, BRAND_SYMBOL_PATH, PRODUCT_DESCRIPTOR, PRODUCT_NAME } from "@/lib/brand";
import { GuardedLink } from "@/components/guarded-link";
import { NavigationLink } from "@/components/navigation-link";
import styles from "@/components/brand-link.module.css";

/** Every IMAdventist logo or wordmark goes to the public calendar (#1496). */
export const BRAND_LINK_HREF = "/calendar";
export const BRAND_LINK_LABEL = BRAND_CALENDAR_LABEL;

type BrandLinkProps = Omit<ComponentProps<typeof GuardedLink>, "href" | "aria-label" | "children"> & {
  /** Use `GuardedLink` (the staff app shell does). Without it a plain link is still guarded: see the note below. */
  guarded?: boolean;
  /** The accessible name. When the link shows extra text, start it with that text (WCAG 2.5.3). */
  label?: string;
  /** The "IMAdventist" text beside the symbol: true for the standard stacked wordmark, or your own text. */
  wordmark?: boolean | ReactNode;
};

/**
 * The one way to draw the IMAdventist symbol (#1496). It is a link to `/calendar` with the accessible name
 * "IMAdventist calendar", a 44px minimum tap target, and the shared focus ring from `a:focus-visible`.
 *
 * Unsaved-changes guard (#1452): every dirty form goes through `useUnsavedChangesGuard`, whose capture-phase
 * document click listener asks before any plain `a[href]` click leaves the page, so this link is guarded on a page
 * with a dirty form whichever link it renders. `guarded` renders `GuardedLink` as well, as the app shell always has.
 * It stays off by default because `GuardedLink` needs the app router, which a server-rendered page test lacks.
 * In the `/embed/*` iframe pass `target="_top"` so the calendar opens in the top window.
 */
export function BrandLink({ wordmark = false, guarded = false, label = BRAND_LINK_LABEL, className, ...rest }: BrandLinkProps) {
  const classes = [styles.link, className ?? styles.standalone].join(" ");
  const Anchor = guarded ? GuardedLink : NavigationLink;
  return (
    <Anchor {...rest} className={classes} href={BRAND_LINK_HREF} aria-label={label}>
      <Image alt="" aria-hidden="true" className={styles.symbol} height={72} src={BRAND_SYMBOL_PATH} width={72} />
      {wordmark === true ? <span><strong>{PRODUCT_NAME}</strong><small>{PRODUCT_DESCRIPTOR}</small></span> : wordmark || null}
    </Anchor>
  );
}
