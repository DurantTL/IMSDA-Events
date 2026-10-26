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

## Response alerts (#1222)

`InformationForm.submissionNotifyEmails` (at most 10, empty by default) lists the addresses emailed when a response
arrives. It is set in the builder's Form settings tab ("Email when a response arrives"), saved with the other settings
(`PATCH .../settings`). Only a system administrator may change the addresses, for `GENERAL` and `EVENT` forms alike: event staff with `MANAGE_FORMS` get a 403 and the settings tab shows the list read-only and is not versioned with the
definition. `submission-alert.ts` queues one internal email per address after the response is stored, never inside the
write: a failure to queue or send is logged (response id only) and the response stays saved. The email names the form and
the time and links to the response; it never carries an answer. It follows the "Information form response received"
switch (#1016), read before the response is written.

## The Adventurer templates and the member list (#1222)

`adventurer-templates.ts` holds the four Adventurer club forms as information-audience code templates (synced by
`npm run form-templates:sync`). The annual registration uses a `MEMBER_LIST` field: repeating rows of exactly name, age,
level and what the member is working on. It is the single exception to the no-roster rule, and `memberListRefusals` in
`definition.ts` allowlists that exact row shape: any other column or column type, a sensitive column label, a second
member list, an attendee scope or an attendee roster is still refused. `GET .../responses/export?format=members` exports
one CSV row per member (club, name, age, level, working on).

`MEMBER_LIST` is not in `formFieldTypes` (the club form builder, the question library and the registration builder never
see it); `informationFormFieldTypes` adds it. `registrationFormDefinitionSchema` refuses it explicitly, and
`formTemplateDefinitionSchema` (templates and information forms) accepts it. The allowlist pins each column's key, type and
label (Name, Age, Adventurer level, Working on this year). `verbatim-texts.ts` holds the separate word-for-word allowlist
(purpose statement, annual intro, photo release, three labels): a text skips the sensitive-text check only when it equals one
exactly (whitespace normalized); keys and every other refusal are unchanged.
