import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { clubAccessClosed } from "@/components/club-access-closed";
import { GetFilterForm } from "@/components/get-filter-form";
import { ClubCertificatePicker } from "@/components/club-certificates";
import styles from "@/components/club-certificates.module.css";
import { filterCandidates, parseCertificateFilter } from "@/modules/club-certificates/domain";
import { loadClubCertificates } from "@/modules/club-certificates/repository";
import { getRosterAccessStateForPage } from "@/modules/club-rosters/access";
import { yearLabel } from "@/modules/club-rosters/home-view";

export const metadata: Metadata = { title: "Class and honor certificates" };
export const dynamic = "force-dynamic";

/**
 * The optional class and honor certificates page (#1696): this club's completed honors and class completions, filtered
 * by kind and completion date, and the step that prints the ones you pick. Only the club's director and deputy (and
 * staff acting as the director), and only while the club has switched it on in Club settings; anyone else, and a club
 * that has not, gets "not found". Nothing is emailed.
 */
export default async function ClubCertificatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ kind?: string | string[]; from?: string | string[]; to?: string | string[] }>;
}) {
  const [{ organizationId }, query] = await Promise.all([params, searchParams]);
  const access = await getRosterAccessStateForPage(organizationId);
  if (access.state !== "OPEN") return clubAccessClosed(access);
  const list = await loadClubCertificates(organizationId, access.capabilities);
  if (!list) notFound();
  const base = `/account/clubs/${organizationId}`;
  const filter = parseCertificateFilter(query);
  const filtered = filter.kind !== "ALL" || Boolean(filter.from) || Boolean(filter.to);
  const shown = filterCandidates(list.candidates, filter);
  return (
    <>
      <BackLink href={`${base}/club-info#club-optional-features`}>Back to Club settings</BackLink>
      <section aria-labelledby="certificates-heading" className="public-manage-card">
        <div className="public-manage-card-heading">
          <p className="public-registration-eyebrow">{`Club year ${yearLabel(list.clubYear)}`}</p>
          <h2 id="certificates-heading">Class and honor certificates</h2>
        </div>
        <p className="quiet-copy">
          Pick the completed honors and classes to print a certificate for, or save them as a PDF from your browser. To print a
          batch for investiture, set the dates. Nothing is emailed. Only your club&apos;s director and deputy can see this page.
          You can turn it off in <a href={`${base}/club-info#club-optional-features`}>Club settings</a>.
        </p>
        <GetFilterForm action={`${base}/certificates`} className={styles.filters}>
          <div className={styles.field}>
            <label htmlFor="certificates-kind">Kind</label>
            <select defaultValue={filter.kind} id="certificates-kind" name="kind">
              <option value="ALL">Honors and classes</option>
              <option value="HONOR">Honors only</option>
              <option value="CLASS">Classes only</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="certificates-from">Completed from</label>
            <input defaultValue={filter.from} id="certificates-from" name="from" type="date" />
          </div>
          <div className={styles.field}>
            <label htmlFor="certificates-to">Completed to</label>
            <input defaultValue={filter.to} id="certificates-to" name="to" type="date" />
          </div>
          <button className="secondary-button" type="submit">Show</button>
          {filtered && <Link className="secondary-button" href={`${base}/certificates`} scroll={false}>Clear filters</Link>}
        </GetFilterForm>
        <p className={styles.meta}>{`${shown.length} ${shown.length === 1 ? "completion" : "completions"} shown`}</p>
        <ClubCertificatePicker candidates={shown} filtered={filtered} key={`${filter.kind}|${filter.from}|${filter.to}`} organizationId={organizationId} />
      </section>
    </>
  );
}
