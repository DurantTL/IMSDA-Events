import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { BrandLink } from "@/components/brand-link";
import { PublicHeaderSessionLinks } from "@/components/public-header-session-links";
import { CopyApplicationLink } from "@/components/copy-application-link";
import { getServerEnv } from "@/lib/env";
import { openApplicationUrl } from "@/modules/club-forms/open-applications-domain";
import { listEnabledPublicClubFormKeys, listPublicClubFormClosedKeys, listPublicClubFormFillModes } from "@/modules/club-forms/public-index";
import { publicClubFormGroups, publicClubFormView } from "@/modules/club-forms/public-index-domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Club forms",
  description: "Pathfinder club forms for the Iowa-Missouri Conference, by when in the year they are used and who fills them in.",
  alternates: { canonical: "/clubs/forms" },
  robots: { index: true, follow: true },
};

/**
 * The public Club forms list (#1221), laid out like the conference website's list so the website needs one link.
 * It holds no club data and no medical fields. Director items go through the sign-in-aware club chooser; items sent
 * by private link only say so; an item whose club form is turned off says "Not available yet." with no link.
 */
export default async function PublicClubFormsPage() {
  const [enabled, fillModes, closed] = await Promise.all([listEnabledPublicClubFormKeys(), listPublicClubFormFillModes(), listPublicClubFormClosedKeys()]);
  const baseUrl = getServerEnv().APP_BASE_URL;

  return (
    <main className="public-registration-page public-calendar-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
          <div className="public-header-links">
            <BackLink href="/clubs">Find a club</BackLink>
            <PublicHeaderSessionLinks />
          </div>
        </div>
      </header>

      <section className="public-registration-hero calendar-hero">
        <div>
          <p className="public-registration-eyebrow">Iowa-Missouri Conference</p>
          <h1>Club forms</h1>
          <p>Forms for Pathfinder clubs, in the order they are used during the year.</p>
        </div>
      </section>

      <div className="calendar-layout">
        {publicClubFormGroups.map((group) => (
          <section aria-labelledby={`club-forms-${group.id}`} className="club-forms-index-group" key={group.id}>
            <h2 id={`club-forms-${group.id}`}>{group.title}</h2>
            <ul className="club-forms-index-list">
              {group.items.map((item) => {
                const view = publicClubFormView(item, enabled, fillModes, closed);
                return (
                  <li className="club-forms-index-item" key={view.id}>
                    <div className="club-forms-index-text">
                      <h3>{view.name}</h3>
                      <p>{view.who}</p>
                      {view.note && <p className="club-forms-index-note">{view.note}</p>}
                      {view.applicationPath && <CopyApplicationLink label="Copy link for your website" url={openApplicationUrl(baseUrl, item.templateKey ?? "")} />}
                    </div>
                    {view.href && (
                      <Link className="secondary-button club-forms-index-action" href={view.href}>
                        {view.applicationPath ? "Apply" : "Open"} <ArrowRight aria-hidden="true" size={14} /><span className="sr-only"> {view.name}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
