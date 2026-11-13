# Bulk actions module

The reviewed bulk-action framework (#182). It runs a small, closed list of actions over the registrations a staff filter matches, in one event, and only after the person has read a preview and confirmed it.

## The flow

1. **Preview** (`createBulkPreview`, `POST /api/events/[eventId]/bulk-actions`). Reads the authorized result set with `enumerateOperationsRegistrationIds`, which applies the search's own permission gates. Records the run (`BulkActionRun`): the action, its parameters, the canonical query, the candidate registrations as `{ id, updatedAt }`, a fingerprint, and a 30-minute expiry. Nothing is changed. The audit log gets `BULK_ACTION_PREVIEWED`.
2. **Confirm** (`confirmBulkAction`, `POST .../[runId]/confirm`). Needs the run's own actor and an idempotency key. The step from PREVIEWED to APPLYING is one conditional update, so only one request wins it.
3. **Apply.** One outcome per registration: COMPLETED, SKIPPED, CONFLICT, FAILED or OBSOLETE, stored in `BulkActionRecordOutcome` with a short reason code. The run ends APPLIED with counts, and the audit log gets `BULK_ACTION_APPLIED`.

## What is checked again at confirm

A preview is not a grant. At confirm the route resolves the person's membership again, and the framework re-checks the base access, the action's permissions and every export field's permission, that the tag is still active, and re-runs the same query narrowed to the snapshot ids (`onlyIds`).

- A permission or tag that is gone: the whole run is refused and nothing is applied.
- A record that no longer matches the query: OBSOLETE.
- A record whose `updatedAt` differs from the preview: CONFLICT, never overwritten.
- Tag already on (apply) or not on (remove): SKIPPED.
- One record failing: FAILED, and the rest continue.
- The handler itself stopping: the confirmation is already in the audit log, the run still ends APPLIED, and every record not reached is FAILED ("interrupted"). A run left in APPLYING for more than 10 minutes is ended the same way on the next retry with its key.

The version check reads all current versions once, just before the writes. A change landing in the few milliseconds between that read and one record's write is not detected; the tag writes themselves are idempotent, so the worst case is a tag applied to a record that changed a moment ago.

## Idempotency

The same key on the same run returns the stored summary and applies nothing twice. For an export it returns the recorded summary and no second file: the file is built once, returned in the confirm response, and never stored. To export again, preview again. A different key on an already-confirmed run is refused. A key already used by another run in the event is refused.

## Restricted domains

The action key is a closed allowlist (`BULK_ACTION_KEYS`). There is no "set a field" handler. Any other key, such as a refund, cancellation, transfer, identity merge, protected record, lodging or session assignment, or a payment, price or capacity edit, is refused with the page to use (`parseBulkActionKey`).

## Limits

At most 500 registrations for a tag action and 5000 for an export. A larger scope is refused as too broad, never truncated.

## Actions in this slice

- `APPLY_TAG` and `REMOVE_TAG`: through `modules/tags/repository.ts` (`applyRegistrationTag`, `removeRegistrationTag`, with the run id as the correlation id so each per-record audit row links to the run). Recognition tags are excluded. Needs `MANAGE_REGISTRATION`. Applying needs an active tag; removing also works for an inactive one.
- `EXPORT_FIELDS`: a CSV through `toCsv` (formula-safe). Needs `VIEW_REPORTS` and `VIEW_SENSITIVE_DATA`, and each field has its own permission (`EXPORT_FIELDS` in `domain.ts`). A field the person may not use is refused, never dropped. Health, medical, consent, restricted-note and insurance information has no field and cannot be requested.

Requesting information and queueing a message are later slices. Adding one is a new key in `BULK_ACTION_KEYS` and the catalog, a `BulkActionKey` value in the schema, and a new handler in `repository.ts`; the framework does the rest.

## Privacy

Runs store keys, ids, versions and counts. They never store a registrant's name, email or phone number, or the exported file. The run's query string can hold the search text staff typed while the run is PREVIEWED; it is replaced with `[text]` as soon as the run is confirmed or expires. The audit metadata always uses the replaced form. The summaries list non-completed records by confirmation code and a reason code only.

`domain.ts` is pure; `repository.ts` is server-only; `http.ts` maps errors to responses.
