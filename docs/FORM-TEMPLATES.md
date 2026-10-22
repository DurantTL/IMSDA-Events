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
- **Source tracking:** `RegistrationForm.sourceTemplateVersionId` is the immutable `SeededFormTemplateVersion` id (it names its template) the form was created from or last had its draft replaced from. It is written in the same transaction as the form or draft it describes. Forms made before this, forms made from a template that was not stored yet, and annual clones have no source and show nothing.
- **Pinned version:** "New from template" and "Update draft from a template" send the version id the person chose. If the template has moved on, nothing is applied and the request fails with `TEMPLATE_CHANGED` (409); reload to see the newer version.
- **Notice:** a form whose source template has a newer, readable version shows "The <template> template has changed since this form was made", with "Update draft from a template" (the existing replace-the-draft confirmation, pinned to that version) and "Dismiss for this version". Showing it never changes a form. Dismissing records the newer version in `dismissedTemplateVersionId` and never touches the source; a later template version notifies again. Anyone with MANAGE_FORMS sees and can dismiss it.
