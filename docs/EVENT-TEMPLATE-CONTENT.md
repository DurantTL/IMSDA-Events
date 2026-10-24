# Event template content: what is seeded data and what stays in code (#919)

#153 moved the three shared form definitions into seeded, versioned data (`npm run form-templates:sync`, see `docs/FORM-TEMPLATES.md`). Lodging property templates were already versioned data synced by `npm run lodging:sync` (see `docs/LODGING.md`). #919 went through the rest of the Camp Meeting and Women's Retreat content still written into shared source and either moved it or recorded why it stays.

The rule used: move content that is event-specific **values or words a person chooses and then copies into an event** (a preset). Keep content that is generic behavior, a platform-wide constant, a documented field-key contract, or the demo data itself.

## Seeded event content (new in #919)

- Files: `prisma/seed-data/event-content/camp-meeting-meals.json` (kind `MEAL_PRESET`) and `camp-meeting-cancellation.json` (kind `CANCELLATION_PRESET`). Each carries `key`, `kind`, `version`, `name` and `content`. `modules/event-content/seeded-data.ts` lists and validates them; the shapes are in `modules/event-content/domain.ts`.
- Storage: one new table, `SeededEventContent` (`kind` + `key` unique, `version`, `name`, `content` JSON). `npm run event-content:sync` writes a row only when it is missing or the code's `version` is higher, under an advisory lock, and never lowers a stored version. `docker-entrypoint.sh` and CI run it after the migrations. Until it has run, the app uses the bundled copy of the same files, so a deploy that has not synced yet still works.
- **Sync only creates or updates content rows.** It never reads or changes an event, its meal services and plans, its cancellation policy versions, its lodging or its messages. A person applies a preset on the event's own screen, which copies the values into that event; a later version of the content reaches only events that apply it afterwards.
- Nothing edits this content in the app, so unlike form templates there is no "app-owned" state: a stored row is always the code's.
- To ship a revision, change the JSON and raise its `version`. Prices and fees are pricing, which only a human may change: a pull request that changes a meal price or the cancellation fee needs the owner's approval like any other.

### Camp Meeting meals (`MEAL_PRESET`, key `camp-meeting-2026`)

The services, plans and prices that `modules/meals/camp-meeting.ts` held (that file is gone), plus the words the Meals screen shows ("Start from Camp Meeting", the description listing the days and prices, the button and notice). Applied by `POST /api/events/{id}/meals/defaults` with `{ "preset": "camp-meeting-2026" }`, which needs MANAGE_FINANCE and only works on an event with no meal services or plans. The request body is unchanged, so the screen and any caller keep working; an unknown preset is a 400. The audit entry still records `preset: "camp-meeting-2026"`.

### Camp Meeting cancellation rule (`CANCELLATION_PRESET`, key `camp-meeting-2026`)

The rule `campMeetingPreset` built, as a rules template with a `{{deadline}}` placeholder for the last day of the first window, plus the words the rules screen shows. Before the deadline a full refund minus a $10 processing fee (`flatWithholdCents: 1000`); after it, or for a no-show on the first night, the deposit is forfeited and the reservation cancelled. Two readings were chosen and flagged for the owner when it was written (#169): only the deposit is forfeited after the deadline (anything paid beyond it stays refundable), and the card fee follows the window. The screen only starts a draft from it: a human reviews and saves it, and nothing is saved from the preset.

### Proof that the values did not change

`tests/fixtures/legacy-event-content-919.json` was captured from the old TypeScript before it was removed: the full meal definition and a hash of it, the cancellation rule for three deadlines and their hashes, and the exact screen and error wording. `tests/seeded-event-content-919.test.ts` compares the seeded data to it (every price, every service, the rule for each deadline, the $10 fee, each sentence), checks that the dated definitions applied to an event are the same, and covers the sync (create, current, update, never backwards, nothing but the one table touched) and the fall back to the bundled copy. The existing cancellation and meals tests now read the seeded data through `tests/support/camp-meeting-seeds.ts`, so they also run against it. The #155 neutrality test no longer grandfathers `campMeetingMeals`, `applyCampMeetingMealPreset` or `campMeetingPreset`.

## Every item in #919

| Item | Decision | Reason |
| --- | --- | --- |
| `modules/meals/camp-meeting.ts`: meal services, plans, prices | **Moved** | Seeded `MEAL_PRESET`, above. Same values, proven by the fixture. |
| `applyCampMeetingMealPreset`, preset `camp-meeting-2026`, `meals/defaults` route | **Moved** | Now `applyMealPreset(eventId, actor, presetKey)`, which reads the seeded preset. The preset key and the request body are unchanged. |
| `components/meals-workspace.tsx`, "Start from Camp Meeting" copy | **Moved** | The label and description are in the seeded preset; the page passes them in. The screen is generic. |
| `modules/cancellation-policy/rules.ts`, `campMeetingPreset` and the $10 fee | **Moved** | Seeded `CANCELLATION_PRESET`. The fee is unchanged at 1000 cents. `rules.ts` keeps the generic rule shape and calculator inputs only. |
| Camp Meeting rule UI in `cancellation-policy-workspace.tsx` | **Moved** | Label, description and rules come from the seeded preset. |
| `modules/event-templates/starters.ts`: `womens_retreat` and `camp_meeting` starters | **Kept** | Starters are already stored template data: "Add starter templates" writes them as `EventTemplate` versions, and staff edit them from there. Rewriting stored templates from code on every deploy would overwrite staff edits, which is the opposite of the form-template rule. `starters.ts` is already an approved event-specific path in the #155 test. |
| Copy in `components/event-template-list.tsx` | **Kept** | A sentence naming which built-in forms keep last year's prices. It describes the forms that exist and is generic UI text, not event content. |
| `modules/communications/templates.ts`: Women's Retreat sample name and hotel group text | **Already neutral** | The sample context reads "IMSDA Sample Event" and a made-up hotel; nothing event-specific is left. The real hotel group text is per-event data (`Event.hotelGroupName` and the other hotel columns). |
| `modules/lodging/templates/sunnydale.ts` (Camp Meeting housing) | **Kept** | Already versioned seeded data: `lodging:sync` stores it in `LodgingProperty` rows and applies it only when its `version` is newer (`docs/LODGING.md`). It describes a facility, not an event, and changing it from TypeScript to JSON would add no behavior. |
| Per-night rate bases in `modules/lodging/domain.ts` | **Kept** | The four bases are generic (per unit or person, per night or per event); a doc comment mentions which event uses which. Labels carry no event name. |
| `modules/payments/in-person-card.ts`: check-in card fee | **Kept** | The platform's Square in-person rate (2.6% + 15 cents) for every event's check-in, not WR26 content, and it is pricing. Moving it would add a way to change a fee without changing the code review it gets today, with no gain. The WR26 mention is the history of who approved it. |
| `modules/system-admin/readiness-items.ts`: WR26 sign-off item | **Kept** | A one-off go-live checklist entry. Sign-offs are stored against its key (`wr26-signed-off`), so renaming or moving it would orphan the record. Grandfathered in the #155 test. |
| `prisma/seed.ts` demo events | **Kept** | It is the synthetic demo data (local only; production never runs it). It is already data for the seed command. |
| `modules/meals/domain.ts` meal ticket field keys | **Kept** | A documented contract between the meals module and the Camp Meeting form template: the meal field keys the form submits and the module reads. The form template is seeded data; the keys are the interface to it. Change one only with the other, and raise the template version. |
| `modules/forms/field-flags.ts`, `modules/reporting/check-in-book.ts` (`guest_age`), `modules/forms/roster-summary.ts` | **Kept** | The same kind of contract: they read well-known template field keys (`guest_age` and similar). Changing a key in the template means changing these, so they are documented here rather than data. |
| WR26 legacy importer (`modules/imports/*`) | **Out of scope** | Legitimately specific to that event. |

## Not done

- No event, registration form, meal plan, cancellation policy, lodging or message was changed, and nothing reads the new table except the Meals and cancellation rules screens when a person is choosing a preset.
- No price, fee or capacity changed.
