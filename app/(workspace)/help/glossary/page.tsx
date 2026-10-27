import type { Metadata } from "next";
import { withCurrentEvent } from "@/components/staff-navigation";
import { BackLink } from "@/components/back-link";
import { StaffPageHeader } from "@/components/staff-page-header";
import { glossaryTerms } from "@/modules/help/glossary";
import { loadHelpViewer } from "@/modules/help/viewer";
import styles from "../help.module.css";

export const metadata: Metadata = { title: "Glossary" };
export const dynamic = "force-dynamic";

/** Plain-language words used in the workspace (#1077). Open to every staff member; it holds no event or personal data. */
export default async function GlossaryPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { event: requested } = await searchParams;
  const viewer = await loadHelpViewer(requested);
  return (
    <section className="page-stack">
      <BackLink href={withCurrentEvent("/help", viewer.selectedEventId)} variant="staff">Back to Help &amp; learning</BackLink>
      <StaffPageHeader description="What the words in the workspace mean." />
      <dl className={styles.terms}>
        {glossaryTerms.map((entry) => (
          <div className={styles.term} key={entry.term}>
            <dt>{entry.term}</dt>
            <dd>{entry.meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
