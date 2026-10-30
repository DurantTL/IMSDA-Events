import Link from "next/link";
import { AlertTriangle, Info, Siren } from "lucide-react";
import { linkText, noticeLevelLabels, type HubNotice } from "@/modules/site-content/hub-content-domain";
import styles from "@/components/site-notices-view.module.css";

const icons = { INFO: Info, URGENT: AlertTriangle, EMERGENCY: Siren } as const;

/** A staff-written link: a path on this site goes through next/link, an https address is a plain link. */
export function HubLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return href.startsWith("/") ? <Link className={className} href={href}>{children}</Link> : <a className={className} href={href}>{children}</a>;
}

/** The notices as drawn: pure, so the preview and the tests render exactly what the pages do. Nothing when there are none. */
export function SiteNoticesView({ notices }: { notices: readonly HubNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Site notices" className={styles["site-notices"]}>
      <ul>
        {notices.map((notice) => {
          const Icon = icons[notice.level];
          return (
            <li className={`${styles["site-notice"]} ${styles[`site-notice-${notice.level.toLowerCase()}`]}`} key={notice.id}>
              <Icon size={20} aria-hidden="true" />
              <p>
                <strong>{noticeLevelLabels[notice.level]}: </strong>
                {notice.message}
                {notice.linkHref ? <> <HubLink className={styles["site-notice-link"]} href={notice.linkHref}>{linkText(notice)}</HubLink></> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

