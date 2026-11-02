import { ArrowLeft } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { BRAND_LINK_HREF } from "@/components/brand-link";
import styles from "@/components/back-to-events-link.module.css";

/**
 * "Back to events" for every sign-in page (#1496): always visible, first in the page so it is at the top on a phone.
 * `placement="card"` sits at the top of an `.auth-card`; `"page"` sits under a public header, aligned with its content.
 */
export function BackToEventsLink({ placement = "card" }: { placement?: "card" | "page" }) {
  const link = (
    <Link className={`auth-back-link ${styles.link}`} href={BRAND_LINK_HREF}>
      <ArrowLeft size={15} aria-hidden="true" /> Back to events
    </Link>
  );
  return placement === "page" ? <div className={styles.bar}>{link}</div> : link;
}
