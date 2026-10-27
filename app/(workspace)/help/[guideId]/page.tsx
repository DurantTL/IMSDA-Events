import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withCurrentEvent } from "@/components/staff-navigation";
import { BackLink } from "@/components/back-link";
import { docLabel, docUrl } from "@/modules/help/guides";
import { loadHelpViewer } from "@/modules/help/viewer";
import { guideForViewer, guideLinksForViewer, unavailableText } from "@/modules/help/visibility";
import styles from "../help.module.css";

export const dynamic = "force-dynamic";

/**
 * The tab title names a guide only for a viewer who may see it. A hidden guide and an
 * unknown id both get the same generic title, so the title does not reveal a hidden guide.
 */
export async function generateMetadata({ params, searchParams }: { params: Promise<{ guideId: string }>; searchParams: Promise<{ event?: string }> }): Promise<Metadata> {
  const { guideId } = await params;
  const { event: requested } = await searchParams;
  const guide = guideForViewer(guideId, await loadHelpViewer(requested));
  return { title: guide?.title ?? "Help & learning" };
}

/**
 * One guide (#1077). A guide this viewer may not see answers exactly like an id that
 * does not exist, so a hidden guide's existence is not revealed. Links to working
 * pages are shown only when the viewer can open them.
 */
export default async function GuidePage({ params, searchParams }: { params: Promise<{ guideId: string }>; searchParams: Promise<{ event?: string }> }) {
  const { guideId } = await params;
  const { event: requested } = await searchParams;
  const viewer = await loadHelpViewer(requested);
  const guide = guideForViewer(guideId, viewer);
  if (!guide) notFound();
  const { links, unavailable } = guideLinksForViewer(guide, viewer);

  return (
    <section className="page-stack">
      <BackLink href={withCurrentEvent("/help", viewer.selectedEventId)} variant="staff">Back to Help &amp; learning</BackLink>
      <article className={styles.page}>
        <h2 className={styles.guideTitle}>{guide.title}</h2>
        <div className={styles.badges}>
          <span className={styles.badge}>{guide.workspace === "System" ? "System administration" : "Event workspace"}</span>
        </div>
        <p className={styles.intro}>{guide.summary}</p>
        <section className={styles.section} aria-labelledby="guide-needs">
          <h3 className={styles.sectionTitle} id="guide-needs">What you need</h3>
          <ul className={styles.bullets}>{guide.needs.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section className={styles.section} aria-labelledby="guide-changes">
          <h3 className={styles.sectionTitle} id="guide-changes">What this will change</h3>
          <ul className={styles.bullets}>{guide.changes.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section className={styles.section} aria-labelledby="guide-steps">
          <h3 className={styles.sectionTitle} id="guide-steps">Steps</h3>
          <ol className={styles.steps}>{guide.steps.map((item) => <li key={item}>{item}</li>)}</ol>
        </section>
        <section className={styles.section} aria-labelledby="guide-verify">
          <h3 className={styles.sectionTitle} id="guide-verify">How to check it worked</h3>
          <ul className={styles.bullets}>{guide.verify.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section className={styles.section} aria-labelledby="guide-next">
          <h3 className={styles.sectionTitle} id="guide-next">What to do next</h3>
          <p className={styles.empty}>{guide.next}</p>
        </section>
        <section className={styles.section} aria-labelledby="guide-pages">
          <h3 className={styles.sectionTitle} id="guide-pages">Go to the page</h3>
          {links.length > 0 && (
            <ul className={styles.links}>
              {links.map((link) => (
                <li key={link.id}><Link className="secondary-button" href={link.href}>{link.label}</Link></li>
              ))}
            </ul>
          )}
          {(unavailable > 0 || links.length === 0) && <p className={styles.empty}>{unavailableText(viewer)}</p>}
        </section>
        {guide.relatedDocs.length > 0 && (
          <section className={styles.section} aria-labelledby="guide-docs">
            <h3 className={styles.sectionTitle} id="guide-docs">More detail</h3>
            <ul className={styles.links}>
              {guide.relatedDocs.map((path) => (
                <li key={path}><a href={docUrl(path)} rel="noreferrer" target="_blank">{docLabel(path)} (opens GitHub)</a></li>
              ))}
            </ul>
          </section>
        )}
        <p className={styles.note} role="note">Reading this guide is not a task completion. It does not finish the task, approve anything, sign off readiness or give anyone access.</p>
        <p className={styles.foot}>Kept by: {guide.owner}. Last reviewed: {guide.lastReviewed}.</p>
      </article>
    </section>
  );
}
