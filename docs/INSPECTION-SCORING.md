# Inspection scoring (#1896)

An optional per-event tool for Spring Camporee campsite and uniform inspections. Off by default. It sits on
Camporee scoring (#1676; rule B19 in `docs/SITE-RULES.md`, inspections are B23).

## What it does

- **Switching on** (More > Inspections for staff, Club events > Inspections for an Area Coordinator) needs Camporee scoring
  on first. It makes two scored events in Camporee scoring, "Campsite inspection" and "Uniform inspection": a score for each
  club, in points, highest wins, ribbons for the first three places. They are marked by `ScoredActivity.inspectionKind`
  (`campsite` or `uniform`), so switching on again never makes a second copy. A scored event someone already made with the
  same name and settings is adopted instead of duplicated.
- **Switching off** hides the entry screen. Both scored events and every score stay, and still rank in Camporee scoring.
- **Entering scores:** pick the inspection, then type a number for each registered club and tap Save on that row. Each save
  is its own small request, so on a weak connection only that row can fail; it shows "Not saved" with a Retry button and
  keeps what was typed. Nothing large is loaded.
- **CSV import** for events that score on paper: columns `club`, `inspection` (campsite or uniform) and `score`; an optional
  `club id` or `club code` column picks the club exactly (the club's id or its organization code). Clubs match by name among the
  registered clubs, ignoring case, spacing and punctuation. The preview lists every row as matched, unknown club, more than one
  club with the name, bad inspection, bad score or duplicate. Duplicate rows (the same club and inspection twice) are not
  applied. Applying sends the digest the preview returned; a changed file or club list asks for a new preview. Only matched rows
  are written.

## Who may do what

The same people as Camporee scoring: an active Area Coordinator (after the second sign-in step), the Clubs Administrator,
event administrators and system administrators may switch it and enter scores; staff with the registration permission enter
scores only. Everyone else is refused on the server. After results are published only the Clubs Administrator and event
administrators may correct a score, and each correction is audited (ids and numbers only), exactly as in Camporee scoring.

## Points

Camporee scoring does not feed club points: `modules/event-points` reads registrations and check-in, not scored events. This
tool adds no points rule. Inspection scores feed ranks, ribbons, trophy counts and the published results only.

## Where the code is

`modules/event-inspections/` (rules, CSV planning, service), `components/inspection-entry.tsx`, pages
`app/(workspace)/more/inspections` and `app/(public)/account/(portal)/area-clubs/events/[eventId]/inspections`, routes
`app/api/events/[eventId]/inspections` and `app/api/attendee/area-clubs/events/[eventId]/inspections` (each with `/import`).
Scores are written only through `enterScore` in `modules/event-scoring/service.ts`.
