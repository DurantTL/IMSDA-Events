/**
 * Shown in place of a health record while the personal-data key is unavailable (#1652). Nothing is lost and
 * nothing is shown: the record opens again by itself once the key loads. No value, key or reason code is shown.
 */
export function HealthRecordLocked() {
  return (
    <section className="page-stack club-form-page">
      <header>
        <h2>Health records are locked right now</h2>
      </header>
      <p className="quiet-copy">
        Locked: the personal-data key is unavailable right now. Nothing has been lost. Try again in a few minutes. If it
        stays locked, tell a system administrator.
      </p>
    </section>
  );
}
