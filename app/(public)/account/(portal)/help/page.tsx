import type { Metadata } from "next";
import Link from "next/link";
import { loadPortalHelpViewer } from "@/modules/help/portal-viewer";
import { visiblePortalGuides } from "@/modules/help/portal-visibility";
import type { PortalAudience } from "@/modules/help/types";
import styles from "@/app/(workspace)/help/help.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Help",
  robots: { index: false, follow: false, nocache: true },
};

const groups: readonly { audience: PortalAudience; title: string }[] = [
  { audience: "attendee", title: "Your registrations" },
  { audience: "director", title: "Your club" },
  { audience: "coordinator", title: "Club coordination" },
];

/**
 * Portal help (#1259): short guides for the roles this account holds, inside the account portal. Which guides are
 * listed is decided here, on the server, from the same checks the portal layout uses. The page grants nothing, adds
 * no staff or system menu, and holds no registration, club or personal data.
 */
export default async function PortalHelpPage() {
  const viewer = await loadPortalHelpViewer();
  const guides = visiblePortalGuides(viewer);

  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">Your account</p>
          <h1>Help</h1>
          <p>Short guides for the things you can do with your account.</p>
        </div>
      </section>
      <div className="account-page-body">
        <div className={styles.page}>
          <div className={styles.note} role="note">
            <strong>Reading a guide is not a task completion</strong>
            <p>Reading a guide does not file a report, finish a registration, approve anything or give anyone access. Those happen on the working pages, by the people allowed to do them.</p>
          </div>
          {guides.length === 0 ? (
            <p className={styles.empty}>There are no guides for this account yet.</p>
          ) : groups.map((group) => {
            const inGroup = guides.filter((guide) => guide.audience === group.audience);
            if (inGroup.length === 0) return null;
            return (
              <section aria-label={group.title} className={styles.group} key={group.audience}>
                <h2 className={styles.groupTitle}>{group.title}</h2>
                <ul className={styles.list}>
                  {inGroup.map((guide) => (
                    <li className={styles.card} key={guide.id}>
                      <Link className={styles.cardLink} href={`/account/help/${guide.id}`}>
                        <span className={styles.cardTitle}>{guide.title}</span>
                        <span className={styles.cardSummary}>{guide.summary}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
