# Information forms (#1148)

Survey, interest and post-event forms that gather answers only: no registration, roster, payment, meals, lodging or
health data. Definitions reuse `registrationFormDefinitionSchema` plus `informationFormDefinitionSchema`, which refuses
prices, payment, rosters, attendee-level fields, meal/lodging/attendee-type fields and health or sensitive fields, naming
the field.

- `GENERAL` forms belong to no event; system administrators manage them (`app/api/admin/information-forms/*`).
- `EVENT` forms belong to one event; `MANAGE_FORMS` on that event (or a system administrator) manages them
  (`app/api/events/[eventId]/information-forms/*`).
- Versions follow `RegistrationFormVersion`: a published version never changes; editing creates a new draft.
- `storeInformationFormResponse` is the idempotent write the public fill page (part C) will call.
- Every query takes a target and finds forms inside it, so an id from another scope or event is "not found".
