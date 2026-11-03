import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLink } from "@/components/brand-link";
import { PublicExploreNav } from "@/components/public-explore-nav";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { EmptyState } from "@/components/empty-state";
import { HubLink } from "@/components/site-notices-view";
import { listEnabledPublicClubFormKeys, listPublicClubFormClosedKeys, listPublicClubFormFillModes } from "@/modules/club-forms/public-index";
import { publicClubFormView } from "@/modules/club-forms/public-index-domain";
import { applyPublicClubFormsSettings, publicClubFormsIntro, type PublicClubFormsSettings } from "@/modules/club-forms/public-index-settings-domain";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";
import { splitVerse } from "@/modules/site-content/hub-content-domain";
import homeStyles from "@/components/public-home-page.module.css";
import styles from "@/app/(public)/clubs/public-clubs.module.css";

/**
 * The public Club forms list (#1221), laid out like the conference website's list so the website needs one link.
 * It holds no club data and no medical fields. Which forms show, their group, order and line, and the intro, come from
 * the staff settings (#1562; null is today's built-in page). Director items go through the sign-in-aware club chooser;
 * items sent by private link only say so; an item whose club form is turned off says "Not available yet." with no link.
 * Staff tools such as copying an application link do not belong here: they live on the director forms page and in the
 * Clubs administration form settings.
 */
export async function renderPublicClubForms(settings: PublicClubFormsSettings | null) {
  const [enabled, fillModes, closed, hubContent] = await Promise.all([listEnabledPublicClubFormKeys(), listPublicClubFormFillModes(), listPublicClubFormClosedKeys(), getPublishedHubContent()]);
  const verse = hubContent.footer.verse ? splitVerse(hubContent.footer.verse) : null;
  const groups = applyPublicClubFormsSettings(settings).filter((group) => group.items.length > 0);
  const intro = publicClubFormsIntro(settings);

  return (
    <main className={`public-registration-page public-calendar-page public-home-page ${homeStyles.page} ${styles.page}`}>
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" destination="home" wordmark />
          <PublicExploreNav current="clubs" currentKind="location" />
          <div className="public-header-links"><PublicHeaderSessionLinks navLinks={[]} /></div>
        </div>
      </header>
      <section className={`public-registration-hero calendar-hero public-home-banner ${styles.hero}`}>
        <div>
          <p className="public-registration-eyebrow">Iowa–Missouri Conference</p>
          <h1>Club forms</h1>
          <p>Forms for Pathfinder clubs, organized around your club year. Find who fills each form in and how to get started.</p>
        </div>
      </section>

      <div className="calendar-layout">
        <div className={styles.formIntro}>
          <div><h2>Before you begin</h2><p>{intro}</p></div>
          <a className="secondary-button" href="/clubs">Find a club</a>
        </div>
        {groups.length > 0 ? <nav aria-label="Form categories" className={styles.categories}>{groups.map((group) => <a href={`#club-forms-${group.id}`} key={group.id}>{group.title}</a>)}</nav> : <EmptyState headingLevel={2} title="No club forms are listed yet">Check back soon, or ask your club director which form you need.</EmptyState>}
        {groups.map((group) => (
          <section aria-labelledby={`club-forms-${group.id}`} className={styles.formGroup} key={group.id}>
            <h2 id={`club-forms-${group.id}`}>{group.title}</h2>
            <ul className={styles.formList}>
              {group.items.map((item) => {
                const view = publicClubFormView(item, enabled, fillModes, closed);
                return (
                  <li className={styles.formItem} key={view.id}>
                    <div className={styles.formText}>
                      <h3>{view.name}</h3>
                      <p>{view.who}</p>
                      {view.note && <p className={styles.formNote}>{view.note}</p>}
                    </div>
                    {view.href && (
                      <Link className={`secondary-button ${styles.formAction}`} href={view.href}>
                        {view.applicationPath ? "Apply" : "Open"} <ArrowRight aria-hidden="true" size={14} /><span className="sr-only"> {view.name}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <footer className="home-footer">
          {verse && <p className="home-footer-verse">{verse.text}{verse.cite && <> <cite>{verse.cite}</cite></>}</p>}
          {hubContent.footer.contactLines.map((line, index) => <p className={homeStyles.homeFooterContact} key={`${index}-${line}`}>{line}</p>)}
          {hubContent.footer.links.length > 0 && <nav aria-label="Footer links" className={homeStyles.homeFooterLinks}><ul>
            {hubContent.footer.links.map((link, index) => <li key={`${link.href}-${index}`}><HubLink href={link.href}>{link.label}</HubLink></li>)}
          </ul></nav>}
        </footer>
      </div>
    </main>
  );
}
