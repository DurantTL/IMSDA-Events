# Archiving an event (#635)

Archiving hides a real past event without deleting it. Deleting (#620) is for test events with nothing attached.

- **Who:** a system administrator or the event's own Event Admin, from Event settings, Danger zone (Archive event / Unarchive event). The rule is `decideEventArchiveAccess` and is enforced again in the transaction.
- **Data:** only `Event.archivedAt` and `Event.archivedByUserId` change. Nothing is deleted. Unarchiving clears both and restores everything exactly.
- **Hidden:** `listEventsForUser` leaves archived events out by default, so the staff event selector and switchers, `/select-event`, the event copy picker, check-in and login defaults, and `GET /api/events` omit them. `selectEventContext` never chooses one automatically (only, remembered, nearest). The system dashboard, public landing page, sitemap, public calendar (and the calendar admin list), public registration forms, club and group and general-link registration, attendee hub and community, info cards, content and assets, merchandise projection, health forms and promo code lookups all exclude an archived event.
- **Registration closed:** `EventLifecycleSource.archivedAt` is required, so any query that evaluates registration must select it (the type checker enforces this) and `evaluateEventRegistrationPhase` returns `CLOSED` for an archived event.
- **Still readable:** an explicit `?event=` link opens an archived event, so reports and exports work. `/archived-events` lists them (all for a system administrator, the ones the account is a member of otherwise), linked from the event picker in the staff shell, `/select-event` and `/admin`.
- **Audit:** `EVENT_ARCHIVED` and `EVENT_UNARCHIVED`, metadata is `{ eventId }` only. A repeated request writes no second row.
- **Checks:** `tests/event-archive.test.ts` (pure rules) and `npm run test:event-archive` (real database).
