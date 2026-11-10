import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import { BackLink } from "@/components/back-link";
import styles from "@/components/restricted-page-header.module.css";

/**
 * The header for a restricted-purpose staff page (#1584): the health information pages and the emergency plan. The staff
 * shell draws the page's one `h1`, so this draws none. It leads with the purpose label, so the page is never read as a
 * routine report, then an optional single back link, one sentence, the subject (a record's name and status) and the
 * page's one action. It shows only what the page passes in and loads nothing.
 *
 * `printTitle` is a title block that appears on paper only: the shell's header is hidden when printing, so a printed
 * sheet keeps the event name and the confidential label it had before.
 */
export function RestrictedPageHeader({ purpose, locked = true, back, description, subject, action, printTitle, printSubject = false }: {
  /** What this page is for, in a few words, such as "Confidential · read only". */
  purpose: ReactNode;
  /** The lock mark beside the purpose label; off for a page that holds no medical information. */
  locked?: boolean;
  back?: { href: string; label: string };
  /** One sentence in the muted colour. */
  description?: ReactNode;
  /** The record this page is about, such as a member's name, club and status. */
  subject?: ReactNode;
  /** The page's one action. */
  action?: ReactNode;
  printTitle?: ReactNode;
  /** On paper, keep the purpose label and the subject block (and hide the rest): for a record whose printout must say whose it is. */
  printSubject?: boolean;
}) {
  return (
    <header className={`${styles.header} ${printSubject ? styles.printSubject : ""}`} data-restricted-header="">
      {back ? <BackLink href={back.href} variant="staff">{back.label}</BackLink> : null}
      <div className={styles.row}>
        <div className={styles.text}>
          <p className={styles.purpose}>{locked ? <LockKeyhole aria-hidden="true" size={15} /> : null}<span>{purpose}</span></p>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
      {subject ? <div className={styles.subject}>{subject}</div> : null}
      {printTitle ? <div className={styles.printTitle}>{printTitle}</div> : null}
    </header>
  );
}
