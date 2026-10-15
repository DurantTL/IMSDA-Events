# Event features (#965)

One page, `/more/features`, lists every feature an event can have on or off, with
its state, its switch where one exists, and a Settings link. It adds no write path
and no permission: each switch sends the request that already owns it, and the
server checks the same permission again. Staff without the permission see the
state and no switch. Turning a feature off asks first.

Code: `modules/event-features/` (`model.ts` builds the rows, `requests.ts` names the
request each switch sends, `creation.ts` is the creation step), the page
`app/(workspace)/more/features/page.tsx`, and `components/event-features-table.tsx`.

## What is on the page and who may switch it

| Feature | Switch sends | Who may switch |
| --- | --- | --- |
| Honors, Event patches, Club assignments, Seminar assignments, Merchandise, Attendee community | `PUT` / `DELETE /api/events/{id}/modules/{key}` | System administrators only. Club modules do not apply to a general event. Merchandise and Seminar assignments stay on while the event has products or a ranked field (refused, with the reason). |
| Public content | none | Always on. |
| Waitlist, Automatic promotion, Shirt sizes, Pay on Square, Sterling Volunteers check for adults | `PATCH /api/events/{id}` (the settings update, built from a fresh `GET /api/events/{id}` on every toggle so nothing changed elsewhere is put back, with its `expectedStartsOn` / `expectedEndsOn`, #445) | Event settings access (`CONFIGURE_EVENT`). Automatic promotion needs the waitlist. |
| General registration link (club events) | `PUT /api/events/{id}/general-link` | `CONFIGURE_EVENT`. On only for club events billed to the church. |
| Several teams per club (club events) | `PUT /api/events/{id}/team-settings` (every other rule read fresh with `GET` and sent back as stored) | `CONFIGURE_EVENT`. Refused by the server where teams are in use. |
| Published | `POST /api/events/{id}/publish` or `/unpublish` | `CONFIGURE_EVENT`. Readiness is checked by the server. |
| Show on the public calendar | `PATCH /api/admin/calendar/events/{id}` | System administrators, and only once the event is published. |
| Lodging, Meals | none | Shown as set up or not (an event lodging row; at least one meal service that is not cancelled), with a link to their pages for staff who may open them. |

The old Event modules page at `/more` stays: it holds the audit trail and the
module requests. Event Admins see "Request this" on a module that is off.

## Event creation

`/event-setup` has a skippable "Which features does this event use?" step. Only a
system administrator reaches event creation, so choosing modules there never
widens who can turn them on.

- **Blank**: a collapsed step after the basics. Defaults come from the audience
  (`defaultModuleKeys`). Untouched, nothing extra is sent and the server applies the
  same defaults. Touched, `features: { modules, showOnCalendar }` goes with
  `POST /api/events`, beside the five flags, which are ordinary settings fields.
- **Template**: shows the template's own settings (read from its published
  version). Changes go in `features` of `POST /api/event-templates/{id}/apply`; the
  template's own flags apply where nothing was changed.
- **Copy**: shows what the copy will carry, following the "What to copy" choices
  (`ClonePlan.features`, `cloneCreationFeatures`). Read only; change a switch on the
  Event features page afterwards.

The modules are written by `writeCreationModules` in the transaction that creates
the event, with `skipDuplicates`, so the event and its switches exist together or
not at all, and a repeated write changes nothing. A module that does not apply to
the audience is dropped rather than stored. The general link and teams need a
published form and the event to exist, so the step names them and they are turned on
from the Event features page.

Real-database check: `npm run test:event-creation-features`.
