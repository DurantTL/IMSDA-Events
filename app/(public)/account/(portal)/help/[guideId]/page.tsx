import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { docLabel, docUrl } from "@/modules/help/guides";
import { loadPortalHelpViewer } from "@/modules/help/portal-viewer";
import { portalGuideForViewer, portalGuideLinksForViewer, portalUnavailableText } from "@/modules/help/portal-visibility";
import styles from "@/app/(workspace)/help/help.module.css";

export const dynamic = "force-dynamic";

const audienceLabels = {
  attendee: "For everyone with an account",
  director: "For club roles",
  coordinator: "For Area Coordinators",
} as const;

/** The tab title names a guide only for a viewer who may see it; a hidden guide and an unknown id get the same title. */
export async function generateMetadata({ params }: { params: Promise<{ guideId: string }> }): Promise<Metadata> {
  const { guideId } = await params;
  const guide = portalGuideForViewer(guideId, await loadPortalHelpViewer());
  return { title: guide?.title ?? "Help", robots: { index: false, follow: false, nocache: true } };
}

/**
 * One portal guide (#1259). A guide this viewer may not see answers exactly like an id that does not exist.
 * Links go only to pages the viewer can open, and a club page resolves to their own club only when they direct one.
 */
export default async function PortalGuidePage({ params }: { params: Promise<{ guideId: string }> }) {
  const { guideId } = await params;
  const viewer = await loadPortalHelpViewer();
  const guide = portalGuideForViewer(guideId, viewer);
  if (!guide) notFound();
  const { links, unavailable } = portalGuideLinksForViewer(guide, viewer);

  return (
    <>
      <section className="public-registration-hero public-manage-hero account-page-hero">
        <div>
          <p className="public-registration-eyebrow">Help</p>
          <h1>{guide.title}</h1>
        </div>
      </section>
      <div className="account-page-body">
        <BackLink href="/account/help">Back to Help</BackLink>
        <article className={styles.page}>
          <div className={styles.badges}>
            <span className={styles.badge}>{audienceLabels[guide.audience]}</span>
          </div>
          <p className={styles.intro}>{guide.summary}</p>
          <section className={styles.section} aria-labelledby="guide-needs">
            <h2 className={styles.sectionTitle} id="guide-needs">What you need</h2>
            <ul className={styles.bullets}>{guide.needs.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section className={styles.section} aria-labelledby="guide-changes">
            <h2 className={styles.sectionTitle} id="guide-changes">What this will change</h2>
            <ul className={styles.bullets}>{guide.changes.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section className={styles.section} aria-labelledby="guide-steps">
            <h2 className={styles.sectionTitle} id="guide-steps">Steps</h2>
            <ol className={styles.steps}>{guide.steps.map((item) => <li key={item}>{item}</li>)}</ol>
          </section>
          <section className={styles.section} aria-labelledby="guide-verify">
            <h2 className={styles.sectionTitle} id="guide-verify">How to check it worked</h2>
            <ul className={styles.bullets}>{guide.verify.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          <section className={styles.section} aria-labelledby="guide-next">
            <h2 className={styles.sectionTitle} id="guide-next">What to do next</h2>
            <p className={styles.empty}>{guide.next}</p>
          </section>
          <section className={styles.section} aria-labelledby="guide-pages">
            <h2 className={styles.sectionTitle} id="guide-pages">Go to the page</h2>
            {links.length > 0 && (
              <ul className={styles.links}>
                {links.map((link) => (
                  <li key={link.id}><Link className="secondary-button" href={link.href}>{link.label}</Link></li>
                ))}
              </ul>
            )}
            {(unavailable > 0 || links.length === 0) && <p className={styles.empty}>{portalUnavailableText}</p>}
          </section>
          {guide.relatedDocs.length > 0 && (
            <section className={styles.section} aria-labelledby="guide-docs">
              <h2 className={styles.sectionTitle} id="guide-docs">More detail</h2>
              <ul className={styles.links}>
                {guide.relatedDocs.map((path) => (
                  <li key={path}><a href={docUrl(path)} rel="noreferrer" target="_blank">{docLabel(path)} (opens GitHub)</a></li>
                ))}
              </ul>
            </section>
          )}
          <p className={styles.note} role="note">Reading this guide is not a task completion. It does not file anything, approve anything or give anyone access.</p>
          <p className={styles.foot}>Kept by: {guide.owner}. Last reviewed: {guide.lastReviewed}.</p>
        </article>
      </div>
    </>
  );
}
