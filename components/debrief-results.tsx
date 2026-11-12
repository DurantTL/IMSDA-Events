import Link from "next/link";
import { formatInConferenceTime } from "@/modules/calendar/conference-format";
import type { DebriefFormResults, DebriefResults } from "@/modules/event-debriefs/results";
import styles from "@/components/debrief-results.module.css";

function when(iso: string) {
  return formatInConferenceTime(iso, { dateStyle: "medium", timeStyle: "short" });
}

function FormBlock({ form, headingId }: { form: DebriefFormResults; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className={styles.results} data-testid={`debrief-results-${form.purpose.toLowerCase()}`}>
      <h3 className={styles.heading} id={headingId}>{form.title}</h3>
      <p className={styles.counts}>
        {form.answered} {form.answered === 1 ? "answer" : "answers"} from {form.asked} {form.asked === 1 ? "person" : "people"} asked
        {form.waiting > 0 ? `, ${form.waiting} still to answer` : ""}.
      </p>
      {form.responses.length === 0 ? (
        <p className={styles.muted}>No answers yet.</p>
      ) : (
        <ul className={styles.list}>
          {form.responses.map((response) => (
            <li className={styles.card} key={response.id}>
              <p className={styles.who} translate="no">{response.who}</p>
              <p className={styles.when}>{when(response.submittedAt)}</p>
              <dl className={styles.answers}>
                {response.answers.map((entry) => (
                  <div key={entry.question}>
                    <dt>{entry.question}</dt>
                    <dd>{entry.answer}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The answers of an event's debrief and director evaluation, one block each. Only the staff page renders it, after the server
 * has checked the viewer may read them. `readOnlyFrom` marks last year's answers carried onto a copy of the event.
 */
export function DebriefResultsView({ results, idPrefix, readOnlyFrom }: { results: DebriefResults; idPrefix: string; readOnlyFrom?: { href: string } }) {
  return (
    <div className={styles.results}>
      {readOnlyFrom && (
        <p className={styles.muted}>
          Read only. These are the answers from <span translate="no">{results.eventName}</span>.{" "}
          <Link className={styles.link} href={readOnlyFrom.href}>Open that event&apos;s debrief</Link>
        </p>
      )}
      {results.forms.length === 0 ? <p className={styles.muted}>This event has no debrief questions yet.</p> : results.forms.map((form) => <FormBlock form={form} headingId={`${idPrefix}-${form.purpose.toLowerCase()}`} key={form.formId} />)}
    </div>
  );
}
