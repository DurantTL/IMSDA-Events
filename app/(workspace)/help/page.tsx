import type { Metadata } from "next";
import Link from "next/link";
import { StaffPageHeader } from "@/components/staff-page-header";
import { helpPageTitle, withCurrentEvent } from "@/components/staff-navigation";
import { loadHelpViewer } from "@/modules/help/viewer";
import { visibleGuides } from "@/modules/help/visibility";
import { HelpSearch } from "./help-search";
import styles from "./help.module.css";

export const metadata: Metadata = { title: helpPageTitle };
export const dynamic = "force-dynamic";

/**
 * Help & learning (#1077). Every staff member may open it, including staff with no
 * event. The guides listed are decided here, on the server, for this viewer; the
 * page grants nothing and holds no event, attendee or private data.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const viewer = await loadHelpViewer(requested);
  const guides = visibleGuides(viewer).map(({ id, title, summary, workspace, keywords }) => ({ id, title, summary, workspace, keywords }));

  return (
    <section className="page-stack">
      <StaffPageHeader description="Short guides for common tasks, written for the pages you can open." />
      <div className={styles.page}>
        <p className={styles.intro}>Pick the task you are doing. Each guide says what you need, what it will change, how to check it worked, and what to do next.</p>
        <div className={styles.note} role="note">
          <strong>Reading a guide is not a task completion</strong>
          <p>Reading or practising here is not a finished task, an approval, verified attendance, a readiness sign-off or a permission. Those happen on the working pages, by the people allowed to do them.</p>
        </div>
        <HelpSearch guides={guides} selectedEventId={viewer.selectedEventId} />
        <div className={styles.glossaryLinkRow}>
          <Link className={`secondary-button ${styles.linkButton}`} href={withCurrentEvent("/help/glossary", viewer.selectedEventId)}>Open the glossary</Link>
        </div>
      </div>
    </section>
  );
}
