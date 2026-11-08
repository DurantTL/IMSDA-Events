// The "Create a form" choices on the All forms page (#1571): pure data, so the labels and routes are testable.
// Each choice routes to the page that already creates that kind of form; nothing here creates or authorizes anything.
export type FormCreateChoice = {
  key: "registration" | "event-information" | "general-information" | "club";
  title: string;
  description: string;
  /** The existing creation page. Event-scoped choices take `?event=<id>` from a GET form. */
  href: string;
  /** True when the form belongs to one event, so an event has to be chosen first. */
  needsEvent: boolean;
  submitLabel: string;
};

export const formCreateChoices: readonly FormCreateChoice[] = [
  { key: "registration", title: "Registration form", description: "Signs people up for an event, with prices and payment.", href: "/registration-builder", needsEvent: true, submitLabel: "Open registration builder" },
  { key: "event-information", title: "Event information form", description: "Questions for one event, with no registration or payment.", href: "/information-forms", needsEvent: true, submitLabel: "Open event information forms" },
  { key: "general-information", title: "General information form", description: "A form that is not tied to an event.", href: "/admin/information-forms", needsEvent: false, submitLabel: "Open general information forms" },
  { key: "club", title: "Club form", description: "Forms clubs fill in, with requirements and fill modes.", href: "/admin/club-forms", needsEvent: false, submitLabel: "Open club forms" },
];

/** What the event select shows: a list, a plain "none yet", or "Unavailable" when the read failed. */
export type FormCreateEvents = { state: "ready"; events: Array<{ id: string; name: string }> } | { state: "empty" } | { state: "unavailable" };

type EventForPicker = { id: string; name: string; startsAt: Date; endsAt: Date };

/** Upcoming and current events first (soonest first), then past ones (most recent first). `null` means the read failed. */
export function buildFormCreateEvents(events: ReadonlyArray<EventForPicker> | null, now: Date = new Date()): FormCreateEvents {
  if (events === null) return { state: "unavailable" };
  if (events.length === 0) return { state: "empty" };
  const upcoming = events.filter((event) => event.endsAt.getTime() >= now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = events.filter((event) => event.endsAt.getTime() < now.getTime()).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return { state: "ready", events: [...upcoming, ...past].map(({ id, name }) => ({ id, name })) };
}
