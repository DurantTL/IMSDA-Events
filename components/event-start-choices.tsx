import Link from "next/link";
import styles from "@/components/event-start-choices.module.css";

export type EventStartChoiceKey = "blank" | "template" | "copy";

/**
 * The three ways to start an event (#1570), in the order they are shown. The links are the ones the create pages have
 * always had; `carry` is the `?fromCalendarEntry=` query a calendar item's "Add registration" passes along (blank and
 * template take it, copy never has). The sentences say only what the code does: a template brings its forms, messages
 * and settings; a copy brings configuration only (`cloneNeverCopied`); either way the event starts as a private draft.
 */
export const eventStartChoices: ReadonlyArray<{
  key: EventStartChoiceKey;
  title: string;
  text: string;
  href: (carry: string) => string;
}> = [
  {
    key: "blank",
    title: "Start blank",
    text: "Fill in the event by hand. Nothing is brought forward, and the event is saved as a private draft.",
    href: (carry) => `/event-setup${carry}#blank-event`,
  },
  {
    key: "template",
    title: "Start from template",
    text: "The new draft starts with the template’s forms, messages and settings. Review them before you publish.",
    href: (carry) => `/event-setup/from-template${carry}`,
  },
  {
    key: "copy",
    title: "Copy from a past event",
    text: "The new draft starts with that event’s settings and forms. Registrations, attendees and payments are never copied; review dates, limits and links.",
    href: () => "/event-setup/copy",
  },
];

/**
 * Blank, Template and Copy as three link cards at the top of each create page. The one you are on is marked
 * `aria-current="page"`. Plain links: nothing here saves, and creation is still checked on the server.
 */
export function EventStartChoices({ current, carry = "" }: { current: EventStartChoiceKey; /** `?fromCalendarEntry=<id>` or "". */ carry?: string }) {
  return (
    <nav aria-label="How to start the event" data-testid="event-start-choices">
      <ul className={styles.choices}>
        {eventStartChoices.map((choice) => (
          <li key={choice.key}>
            <Link
              aria-current={choice.key === current ? "page" : undefined}
              className={styles.choice}
              data-choice={choice.key}
              href={choice.href(carry)}
            >
              <span className={styles.title}>{choice.title}</span>
              <span className={styles.text}>{choice.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
