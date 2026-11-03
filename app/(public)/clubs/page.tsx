import type { Metadata } from "next";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { StartAClubCallout } from "@/components/start-a-club-callout";
import { PublicClubDirectory } from "@/components/public-club-directory";
import { listPublicClubs } from "@/modules/organizations/public-club-directory";
import { HubLink } from "@/components/site-notices-view";
import { getPublishedHubContent } from "@/modules/site-content/hub-content";
import { splitVerse } from "@/modules/site-content/hub-content-domain";
import homeStyles from "@/components/public-home-page.module.css";
import styles from "./public-clubs.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find a club",
  description: "Pathfinder and Adventurer clubs across the Iowa-Missouri Conference that have chosen to be listed publicly.",
  alternates: { canonical: "/clubs" },
  robots: { index: true, follow: true },
};

/**
 * The public club directory and map (#437): only clubs whose own director
 * chose "list this club publicly," with only what they published. See
 * modules/organizations/public-club-directory for exactly what that is and
 * what it deliberately leaves out.
 */
export default async function PublicClubsPage({ searchParams }: { searchParams?: Promise<{ q?: string | string[] }> } = {}) {
  const { q } = searchParams ? await searchParams : { q: undefined };
  const initialSearch = (Array.isArray(q) ? q[0] : q) ?? "";
  const [clubs, hubContent] = await Promise.all([listPublicClubs(), getPublishedHubContent()]);
  const verse = hubContent.footer.verse ? splitVerse(hubContent.footer.verse) : null;

  return (
    <main className={`public-registration-page public-calendar-page public-home-page ${homeStyles.page} ${styles.page}`}>
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" label="IMAdventist calendar" publicBrand wordmark />
          <nav aria-label="Explore" className={homeStyles.primaryNav}>
            <Link href="/events">Events</Link><Link href="/calendar">Calendar</Link><a aria-current="page" href="/clubs">Club ministry</a>
          </nav>
          <div className="public-header-links"><PublicHeaderSessionLinks navLinks={[]} /></div>
        </div>
      </header>
      <section className={`public-registration-hero calendar-hero public-home-banner ${styles.hero}`}>
        <div>
          <p className="public-registration-eyebrow">Iowa–Missouri Conference</p>
          <h1>Club ministry</h1>
          <p>Grow in faith, friendship and service with Pathfinder and Adventurer clubs across Iowa and Missouri.</p>
          <div className={styles.heroActions}>
            <a className="primary-button" href="#find-a-club">Find a club</a>
            <Link className="secondary-button" href="/clubs/forms">Club forms</Link>
          </div>
        </div>
      </section>

      <div className="calendar-layout">
        <section aria-labelledby="find-a-club" className={styles.finder}>
          <div className={styles.sectionHeading}>
            <p className={homeStyles.kicker}>Find your community</p>
            <h2 id="find-a-club">Find a club</h2>
            <p>Search the clubs that have chosen to be listed publicly. Select a club to see its church, town and meeting schedule.</p>
          </div>
          <PublicClubDirectory clubs={clubs} initialSearch={initialSearch} />
        </section>
        <section aria-label="More for your club" className={styles.nextSteps}>
          <StartAClubCallout />
          <div>
            <h2>Already part of a club?</h2>
            <p>Find forms for your club year, or use your account to reach your existing club tools.</p>
            <Link className="secondary-button" href="/clubs/forms">Browse club forms</Link>
            <Link className="secondary-button" href="/account">My account</Link>
          </div>
        </section>
        <p className={styles.eventLink}><Link href="/events">See all events open for registration</Link></p>
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
