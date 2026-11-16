# Form templates

The registration form templates event staff start a form from ("New from template", "Update draft from a template"). System administrators edit them at **System administration, Form templates** (`/admin/form-templates`). Whole-event templates, saved questions and club forms are separate things.

## Storage and versions

- Templates live in `SeededFormTemplate` (stable `key`, latest `version`, `latestSource`) with an immutable `SeededFormTemplateVersion` row per version (`source` CODE or APP, and `createdByUserId` for APP).
- A version holds form-definition configuration only. It never versions meal plans, lodging inventory, cancellation policies, messages, people, answers or registrations.
- Every save in the app adds the next version, marks it APP with its author, and moves the template row to it, in one transaction. Earlier versions are kept.

## Code-defined templates and app edits

- `npm run form-templates:sync` stores every template in `formTemplates` (`modules/forms/definition.ts`). The three seeded ones carry a `version` in `prisma/seed-data/form-templates/`; the rest are versioned by content (a changed definition becomes the next version).
- Sync only updates a template whose latest version came from the code (`latestSource` CODE). A template whose latest version was saved in the app is app-owned: sync skips it and reports it, whatever version the code has. There is no "reset to code" action.
- Sync and every app save take the same advisory lock, and a save names the version the editor loaded (`expectedVersion`), so a save and a sync, or two saves, can never overwrite one another; the later one is refused as a version conflict.
- A template created in the app (a copy of another) has no code copy. An unreadable stored definition is handled safely: a code template falls back to the code's copy, an app-created one is left out of the picker and flagged on the Form templates page.

## Who can do what

- Only system administrators can list, open, copy or save templates (server-checked on the pages and on `/api/admin/form-templates`; writes also reject cross-origin requests). Event staff can still pick templates when they create or update a form.
- Audit entries (`FORM_TEMPLATE_VERSION_SAVED`, `FORM_TEMPLATE_CREATED`) carry ids and the template key only.
- Forms already created from a template keep the definition they were created with; a new version reaches only forms created afterwards.

## Saving a form as a template, and the "template changed" notice (#1065)

- **Save as template** (Registration form builder, system administrators only; `POST /api/admin/form-templates/from-form`, server-checked, cross-origin requests rejected) snapshots the one stored form version it is given, never unsaved editor content. If the editor has unsaved changes the administrator must confirm that the template is made from the stored version without them. It makes a new APP template at version 1, or the next version of an existing one (the template keeps its own name, description and audience), through the same advisory lock, `expectedVersion` check and audit path as every other template write. Only configuration is copied: no answers, registrations, test submissions, people or messages.
- Policy-version acknowledgments belong to one event, so saving a form as a template turns each into typed placeholder wording and tells the administrator which to reword. Saving, copying and saving from a form all refuse a template definition that still points at a policy version.
- **Source tracking:** `RegistrationForm.sourceTemplateVersionId` is the immutable `SeededFormTemplateVersion` id (it names its template) the form was created from or last had its draft replaced from. It is written in the same transaction as the form or draft it describes. Forms made before this, forms made from a template that was not stored yet, and annual clones (a clone copies a form's definition, not its template source) have no source and show nothing.
- **Pinned version:** "New from template" and "Update draft from a template" send the version id the person chose. If the template has moved on, nothing is applied and the request fails with `TEMPLATE_CHANGED` (409); reload to see the newer version.
- **Notice:** a form whose source template has a newer, readable version shows "The <template> template has changed since this form was made", with "Update draft from a template" (the existing replace-the-draft confirmation, pinned to that version) and "Dismiss for this version". Showing it never changes a form. Replacing a draft with the code's copy of a template that is not stored yet clears the form's source rather than leaving a stale one. Dismissing records the newer version in `dismissedTemplateVersionId` and never touches the source; a later template version notifies again. Anyone with MANAGE_FORMS sees and can dismiss it.
- **Placeholder wording and meal prices:** a template saved from a form carries placeholder acknowledgment wording where the form pointed at a policy version, and a form version whose acknowledgment still reads "Replace this with the statement people acknowledge." cannot be published (saving a draft is allowed; the error lists the field labels). The replace-the-draft confirmation warns when the template has such wording. Meal ticket prices (and the "— $X each" label suffix) are kept in the template as defaults, like the seeded Camp Meeting template: when a form is created from the template, or its draft is replaced, the target event's meal plan sets the real prices.

## Iowa-Missouri Music Festival (#2031)

- `music_festival` is a seeded template (`prisma/seed-data/form-templates/music-festival.json`, version 1, audience School group), synced by `npm run form-templates:sync`. A matching starter event template ("Add starter templates") creates a general event billed to the school after the event, with the attendee types Student, staying on campus (`STUDENT_DORM`), Student, not staying in the dorm (`STUDENT_DAY`) and Teacher / sponsor (`TEACHER_SPONSOR`). The types have no age ranges.
- The school registers once (school name, contact, music copies, lodging request, Saturday sack suppers, dietary needs marked sensitive) and adds one roster row per person. The first question on each row is the attendee type; student questions (age, gender, grade, voice part, T-shirt size, instrument, teacher rating) show for the two student types, and the teacher or sponsor title and T-shirt size (with "No T-shirt, please") show for teachers.
- One per-person fee carries the prices by attendee type: $50, $40 and $0. The template sets no event, capacity or registration deadline. Staff choose Thursday, April 8 to Saturday, April 10, 2027 and Sunnydale Academy when they create the event, and review the prices before publishing.
- The roster rules require an always-visible first and last name, so every person is asked for both. The student sizes are the adult sizes in `modules/registrations/shirt-sizes.ts`; the starter leaves "collect shirt sizes" off because that confirmation does not cover a teacher's "No T-shirt, please".
- Nothing is paid online: the conference bills the school after the event, so its registrations stay Submitted. The Attendee list, its CSV, the event archive and the kitchen report start with Submitted and Confirmed on any billed-later event (a club event or a church- or school-billed general event, `isBilledLaterEvent`), not only on club events.
