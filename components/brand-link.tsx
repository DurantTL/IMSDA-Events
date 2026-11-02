import type { ComponentProps, ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { GuardedLink } from "@/components/guarded-link";
import { NavigationLink } from "@/components/navigation-link";
import styles from "@/components/brand-link.module.css";

/** Every IMSDA Events logo or wordmark goes to the public calendar (#1496). */
export const BRAND_LINK_HREF = "/calendar";
export const BRAND_LINK_LABEL = "IMSDA Events calendar";

type BrandLinkProps = Omit<ComponentProps<typeof GuardedLink>, "href" | "aria-label" | "children"> & {
  /** Use `GuardedLink` (the staff app shell does). Without it a plain link is still guarded: see the note below. */
  guarded?: boolean;
  /** The accessible name. When the link shows extra text, start it with that text (WCAG 2.5.3). */
  label?: string;
  /** The smaller mark used where space is tight. */
  compact?: boolean;
  /** The "IMSDA Events" text beside the mark: true for the standard stacked wordmark, or your own text. */
  wordmark?: boolean | ReactNode;
};

/**
 * The one way to draw the IMSDA Events mark (#1496). It is a link to `/calendar` with the accessible name
 * "IMSDA Events calendar", a 44px minimum tap target, and the shared focus ring from `a:focus-visible`.
 *
 * Unsaved-changes guard (#1452): every dirty form goes through `useUnsavedChangesGuard`, whose capture-phase
 * document click listener asks before any plain `a[href]` click leaves the page, so this link is guarded on a page
 * with a dirty form whichever link it renders. `guarded` renders `GuardedLink` as well, as the app shell always has.
 * It stays off by default because `GuardedLink` needs the app router, which a server-rendered page test lacks.
 * In the `/embed/*` iframe pass `target="_top"` so the calendar opens in the top window.
 */
export function BrandLink({ compact = false, wordmark = false, guarded = false, label = BRAND_LINK_LABEL, className, ...rest }: BrandLinkProps) {
  const classes = [styles.link, className ?? styles.standalone].join(" ");
  const Anchor = guarded ? GuardedLink : NavigationLink;
  return (
    <Anchor {...rest} className={classes} href={BRAND_LINK_HREF} aria-label={label}>
      <BrandMark compact={compact} />
      {wordmark === true ? <span><strong>IMSDA</strong><small>Events</small></span> : wordmark || null}
    </Anchor>
  );
}
