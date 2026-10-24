/** Names the part being loaded and shows no counts, so nothing flashes as zero (#1186). */
export default function AreaOverviewLoading() {
  return (
    <section aria-busy="true" className="public-manage-card page-stack area-overview-page coordinator-loading" role="status">
      <h2>Club overview</h2>
      <p className="field-help">Loading the club overview: clubs, roster counts and the monthly record status…</p>
    </section>
  );
}
