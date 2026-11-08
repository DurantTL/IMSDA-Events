import { NavigationLink as Link } from "@/components/navigation-link";
import styles from "./forms-create-section.module.css";
import { formCreateChoices, type FormCreateEvents } from "@/modules/forms-hub/create-choices";

/**
 * "Create a form" (#1571): four purposes, each going to the page that already creates it. The two event forms need an
 * event first, chosen in a plain GET form (works without scripts). Authorization stays on those pages; nothing is created here.
 */
export function FormsCreateSection({ events }: { events: FormCreateEvents }) {
  return (
    <section className={styles.section} aria-labelledby="forms-create-heading" data-testid="forms-create">
      <h2 id="forms-create-heading" className={styles.heading}>Create a form</h2>
      <p className={styles.note}>Registration forms are built inside each event: choose Registration form, pick the event, and the builder opens.</p>
      <ul className={styles.cards} data-count={formCreateChoices.length}>
        {formCreateChoices.map((choice) => (
          <li key={choice.key}>
            <div className={styles.card} data-testid="forms-create-card" data-choice={choice.key}>
              <span className={styles.title}>{choice.title}</span>
              <p className={styles.text}>{choice.description}</p>
              {!choice.needsEvent ? (
                <Link className={`${styles.button} ${styles.link}`} href={choice.href}>{choice.submitLabel}</Link>
              ) : events.state === "unavailable" ? (
                <p className={styles.unavailable}>Unavailable: events could not be read just now.</p>
              ) : events.state === "empty" ? (
                <p className={styles.text}>There are no events yet. Create an event first.</p>
              ) : (
                <form action={choice.href} className={styles.form} method="get">
                  <label>Event
                    <select name="event" required defaultValue="">
                      <option value="" disabled>Choose an event</option>
                      {events.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                    </select>
                  </label>
                  <button className={styles.button} type="submit">{choice.submitLabel}</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
