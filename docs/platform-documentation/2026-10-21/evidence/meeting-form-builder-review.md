# Meeting form-builder section: workflow and source check

Reviewed for the October 21, 2026 training revision. The owner expects the form-builder changes before the meeting. The meeting date was requested separately; this document does not invent it or certify a future serving release. This is preparation for the presentation, not approval to implement or enable a feature.

## Recommended correction

Replace **“Planned: make forms easier to build and maintain”** with **“Build and check an event form.”** Move this item out of the long-term feature pitch and teach the stable event-staff workflow. Its actions already exist in the reviewed source and remain useful after a layout update. Do not present the inspector, shared-template editing, saved-question library, phone editor or All/Any visual controls as delivered before their actual implementation and review.

Use a four-step capability diagram now. If screenshots of the updated builder are ready before the meeting, replace the diagram or its insets with those actual screens and fictional records. An old accepted/proposed mockup is not an actual new-builder screenshot. Keep the editor-refresh requirement in trainer preparation notes rather than describing the feature to meeting attendees as a distant-future idea.

Suggested slide fields:

```json
{
  "title": "Build and check an event form",
  "kicker": "MEETING WORKFLOW · AUTHORISED EVENT STAFF",
  "status": "current",
  "takeaway": "Choose a starter, save the draft, check the attendee experience, then publish the version.",
  "tiles": [
    {
      "title": "Choose a starter",
      "body": "New from template makes a copy; update an existing draft deliberately.",
      "status": "Independent form copy",
      "icon": "copy"
    },
    {
      "title": "Edit and Save draft",
      "body": "Check question scope and required choices, then save the draft.",
      "status": "Draft is not public",
      "icon": "form"
    },
    {
      "title": "Preview and test",
      "body": "Try the attendee flow; a valid test is required for first publication.",
      "status": "First-publish test",
      "icon": "preview"
    },
    {
      "title": "Publish the version",
      "body": "Review and confirm Publish version, then check the public form.",
      "status": "Check event publication too",
      "icon": "page"
    }
  ]
}
```

**Say:** Start with the correct event and the registration form you intend to change. A starter gives you an independent copy; replacing an existing draft is a deliberate action rather than an automatic update. Check whether each question is asked once for the registration or for every attendee, and check which answers are required. Save the draft before previewing or testing it. Walk through the registration with fictional people and answers. A valid test is required before a form’s first publication; tests remain available after that, but every later version does not acquire another mandatory test. Review the version and publish it when ready. The event must also be published before visitors can register. Later edits create a new draft, and existing registrations retain the version they submitted.

**Show:** In the actual meeting-day editor, point to New from template or Update draft from a template, question scope/Required controls, Save draft, Preview & test, Run test submission, Publish version and the Publish form confirmation. Use fictional data and the right event context. Show the saved/public result without sending a real communication or changing a live event for training.

**Ask:** If you save changes as a draft, have you changed the form visitors are currently using? What else must be published before registration can open?

**Trainer preparation note:** Meeting edition: refresh the builder screenshots against the approved serving version after the scheduled editor changes. Confirm the exact controls before delivery; do not turn this note into an attendee-facing promise that an open redesign issue is already complete. If the update has not landed, retain the stable task sequence and demonstrate the actual available editor rather than passing off a design sample as a released screen.

## Useful current feature labels and controls

| Label | What to teach |
|---|---|
| **Registration forms / Open form builder** | Event-scoped staff tool requiring MANAGE_FORMS; a club director/coordinator role alone does not grant it. |
| **New from template / Use template** | Creates an independent form draft from a starter. |
| **Update draft from a template / Use for the draft** | Explicitly replaces the unpublished draft; it is not a merge or live automatic propagation. |
| **Applies to / Each attendee / Registration** | Separates a question answered for each person from a question answered once for the booking. |
| **Save draft / Save as new draft / Create new version** | The exact save label depends on selected version and edit state; saving is explicit. |
| **Preview & test / Run test submission** | Check the actual attendee flow with fictional values. Save first; the mandatory valid-test gate applies to first publication only. |
| **Publish version / Publish form** | Review and confirm the saved version. Publication of the event is a separate requirement. |
| **Open public form** | Inspect the published result; historical registrations keep their own immutable form version. |

## Routes, permissions and checked sources

Reviewed worktree: `6667bc02c95b62fcce03c035b02c62823c9eb4f1`, the merge of the preceding documentation PR. `git diff 7f77c1df..HEAD -- app components modules prisma` was empty: the latest reviewed main still has the original screenshot-era application implementation.

- `/registration-builder?event=<event-id>`: `app/(workspace)/registration-builder/page.tsx`. The page resolves event context and checks MANAGE_FORMS. The reviewed source still has the current phone exclusion; do not teach complete phone editing as released.
- `components/staff-navigation.ts`: the sidebar uses the existing Registration form destination; the event overview shortcut is **Registration forms → Open form builder**. No new menu is proposed here.
- `components/registration-builder-workspace.tsx`: New from template and Update draft from a template at the page intro; version/draft saving and Publish version in the editor header; Preview & test and Run test submission; Publish form confirmation; Open public form.
- `modules/forms/repository.ts`: independent copied template definition, explicit draft replacement, immutable published versions, transaction/concurrency rules and first-publish-only valid-test enforcement.
- `modules/forms/seeded-templates.ts`: current starter loading, separate from the still-planned editable shared-template library.
- `docs/STAFF-EVENT-WORKFLOW.md`: staff workflow context.

## Fresh issue status and what it means for the meeting

GitHub issue bodies were fetched again for #1063, #1064, #1065 and #1069–#1072. All remain **open** in the observed issue data. The foundation issues retain queue-4 labels. The last four retain needs-decision/design-pending labels. Current source contains no merged implementation of those changes. A PR-search connector returned issue matches rather than an exhaustive pull-request inventory, so this review makes no claim about the absence of work-in-progress PRs.

| Owner | Observed scope | Presentation treatment |
|---|---|---|
| #1063 | Component extraction, explicitly no visible/behaviour change. | Do not sell extraction itself as a new visible user capability. |
| #1064 | System-admin editable Form templates, immutable template versions and code/app sync rules. | Capture and teach only after delivered; event staff still choosing starters is current. |
| #1065 | System-admin Save as template, source/version tracking and Template changed notice. | Do not claim the new library/notice is current. Existing Update draft from a template is current. |
| #1069 | Inspector, distinct Form settings, proposed history/restore and phone inspector. | Visual review pending; no unlabelled future UI. |
| #1070 | Saved question library and safe copied references. | Design/ownership decisions pending. |
| #1071 | Complete phone editing and accessible move workflows. | Do not remove the current device limitation from training as if the change already shipped. |
| #1072 | Flat All/Any visibility groups and rule summary, with compatibility. | Behaviour direction recorded; visual and compatibility work still pending. |

Owner sources: [#1062](https://github.com/DurantTL/IMSDA-Events/issues/1062), [#1063](https://github.com/DurantTL/IMSDA-Events/issues/1063), [#1064](https://github.com/DurantTL/IMSDA-Events/issues/1064), [#1065](https://github.com/DurantTL/IMSDA-Events/issues/1065), [#1069](https://github.com/DurantTL/IMSDA-Events/issues/1069), [#1070](https://github.com/DurantTL/IMSDA-Events/issues/1070), [#1071](https://github.com/DurantTL/IMSDA-Events/issues/1071), [#1072](https://github.com/DurantTL/IMSDA-Events/issues/1072). The source-confirmed template replacement and first-publish-only test behaviours are the delivered #1056/#1057 and #1061/#1066 baseline.

## Before presenting

1. Read the actual release/main revision that will serve the meeting and confirm the implementation/visual-review outcome, rather than closing open scope from the presentation.
2. Capture the final editor with a synthetic event and registration form. Preserve current save/test/version semantics even if the layout changes.
3. If #1064/#1065 are delivered, show shared-template administration only in the system-administrator context and ordinary event-staff starter use in its own context.
4. Refresh button labels, crops, callouts and presenter notes together. Test first publication separately from a later draft of a previously published form.
5. Demonstrate the public result with the correct published event. Avoid private links, real attendee records and external communications in the training capture.

No application code, issue state/labels, queue order, production switch or live form was changed by this review.
