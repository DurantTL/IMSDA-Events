import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { ClubLetters } from "@/components/club-letters";
import { loadClubLetters } from "@/modules/club-letters/repository";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { yearLabel } from "@/modules/club-rosters/home-view";

export const metadata: Metadata = { title: "Letters and certificates" };
export const dynamic = "force-dynamic";

/**
 * The optional fill-in letters and certificates page (#1708): the club's templates and the step that prints one for the
 * people you pick. Only the club's director and deputy (and staff acting as the director), and only while the club has
 * switched it on in Club settings; anyone else, and a club that has not, gets "not found". Nothing is emailed.
 */
export default async function ClubLettersPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const list = await loadClubLetters(organizationId, access.capabilities);
  if (!list) notFound();
  const base = `/account/clubs/${organizationId}`;
  return (
    <>
      <BackLink href={`${base}/club-info#club-optional-features`}>Back to Club settings</BackLink>
      <section aria-labelledby="letters-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{`Club year ${yearLabel(list.clubYear)}`}</p>
          <h2 id="letters-heading">Letters and certificates</h2>
        </div>
        <p className="quiet-copy">
          Write a letter or certificate once, with placeholders for each person&apos;s name, then print it for the people you
          pick or save it as a PDF from your browser. Nothing is emailed. Only your club&apos;s director and deputy can see this
          page. You can turn it off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>; your templates are kept.
        </p>
        <ClubLetters letters={list.letters} organizationId={organizationId} people={list.people} />
      </section>
    </>
  );
}
