import { NavigationLink as Link } from "@/components/navigation-link";
import hubStyles from "@/components/admin-hub.module.css";
import styles from "./forms-create-section.module.css";
import { formCreateChoices, type FormCreateEvents } from "@/modules/forms-hub/create-choices";

/**
 * "Create a form" (#1571): four purposes, each going to the page that already creates it. The two event forms need an
 * event first, chosen in a plain GET form (works without scripts). Authorization stays on those pages; nothing is created here.
 * The card grid is the Admin hub's (four across, 2 x 2 on an iPad, one per row on a phone).
 */
export function FormsCreateSection({ events }: { events: FormCreateEvents }) {
  return (
    <section className={styles.section} aria-labelledby="forms-create-heading" data-testid="forms-create">
      <h2 id="forms-create-heading" className={styles.heading}>Create a form</h2>
      <p className={styles.note}>Registration forms are built inside each event: choose Registration form, pick the event, and the builder opens.</p>
      <ul className={hubStyles.cards} data-count={formCreateChoices.length}>
        {formCreateChoices.map((choice) => {
          const titleId = `forms-create-${choice.key}-title`;
          const labelId = `forms-create-${choice.key}-label`;
          return (
            <li key={choice.key}>
              <div className={styles.card} data-testid="forms-create-card" data-choice={choice.key}>
                <h3 className={styles.title} id={titleId}>{choice.title}</h3>
                <p className={styles.text}>{choice.description}</p>
                {!choice.needsEvent ? (
                  <Link className={`primary-button ${styles.action}`} href={choice.href}>{choice.submitLabel}</Link>
                ) : events.state === "unavailable" ? (
                  <p className={styles.unavailable}>Unavailable: events could not be read just now. Reload the page to try again.</p>
                ) : events.state === "empty" ? (
                  <p className={styles.text}>There are no events yet. <Link href="/event-setup">Create an event first.</Link></p>
                ) : (
                  <form action={choice.href} className={styles.form} method="get">
                    <label id={labelId} htmlFor={`${titleId}-event`}>Event</label>
                    <select aria-labelledby={`${labelId} ${titleId}`} id={`${titleId}-event`} name="event" required defaultValue="">
                      <option value="" disabled>Choose an event</option>
                      {events.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                    </select>
                    <button className={`primary-button ${styles.action}`} type="submit">{choice.submitLabel}</button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
