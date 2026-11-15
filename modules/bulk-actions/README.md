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
- The handler itself stopping: the confirmation is already in the audit log, the run still ends APPLIED, and every record not reached is FAILED ("interrupted"; if the apply failed before anything was written the reason is "Nothing was changed for this one."). Outcomes are saved as the run goes (every 25 records), so a stall or crash keeps what was done.
- A run left in APPLYING for more than 10 minutes is ended by one atomic recovery that stamps a fresh time, so only one caller takes it. It is run by a retry with the run's key and by the page load. Only the request whose status update changes the row audits the end; the original request, if it is still running, finds it no longer owns the run at its next check (every 25 records) and stops.

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

- `QUEUE_MESSAGE` and `REQUEST_INFORMATION`: queue a message for approval (below). Both need `MANAGE_COMMUNICATIONS` on top of the base access, and cover at most 250 registrations (the selected-registration send's own cap). `QUEUE_MESSAGE` picks one of the selected-registration templates (balance reminder, event announcement, custom message, send confirmation again); an announcement has its own title (up to 120) and text (up to 4000), and any other template must not. `REQUEST_INFORMATION` has a title and a "what is missing" text and is sent with the event announcement template, so it carries each person's private registration link and people who opted out of announcements are skipped.

Adding an action is a new key in `BULK_ACTION_KEYS` and the catalog, a `BulkActionKey` value in the schema, and a new handler in `repository.ts`; the framework does the rest.

## Messages wait for approval

Bulk communications are human-gated (Caleb, Oct 27): **confirming a message action never sends and never writes the message outbox.** Apply reads `getSelectedAudiencePreview` over the eligible registrations, records COMPLETED ("Queued for approval" in the summary and history, so nobody reads it as sent) for those who would receive it and SKIPPED with a reason code for the rest (`NOT_ELIGIBLE_STATUS`, `NO_BALANCE_DUE`, `NO_VALID_EMAIL`, `ORGANIZATION_BILLED`, `OPTED_OUT`, `NOT_A_REGISTRATION`), and creates one `BulkMessageApproval` (the run id is unique, so one run is one approval). The audit log gets `BULK_MESSAGE_QUEUED` with counts and keys only.

`message-approvals.ts` is the only place a queued message becomes a send, behind `GET .../bulk-actions/messages` (pending and the last ten decided), `GET .../messages/[approvalId]` (a fresh review: counts, skips by reason, the text, delivery mode, a few confirmation codes and the fingerprint), `POST .../approve` and `POST .../decline`. All need `MANAGE_COMMUNICATIONS`, resolved fresh on each request and checked again inside the service, so a permission removed after queueing stops the send. Every query is scoped by the event. The same person who queued it may approve it, as with scheduled emails (#177).

- **Approve** takes the fingerprint the person was shown. The claim from PENDING_APPROVAL to SENDING is one conditional update; the send is `enqueueSelectedAudienceBatch` with the approval id as the batch id. If the review changed (a balance paid, a template republished, delivery switched off) the approval goes back to PENDING_APPROVAL, nothing is marked sent, and the person reviews again. Approving a SENT one returns the stored counts; a SENDING one older than 10 minutes may be tried again with the same batch id, which the send treats as a replay.
- **Decline** moves PENDING_APPROVAL to DECLINED. Nothing is sent.
- **Withdrawn.** When a run that queued a message does not finish (the handler or saving its outcomes fails, or a recovery ends it with nothing recorded as done), the waiting approval is removed and a `BULK_MESSAGE_WITHDRAWN` audit row says so.
- **Reserved batch ids.** A queued message's id is the batch id its approval sends with, so the direct selected-registration send refuses that id (409 `BATCH_ID_IN_USE`).

## Ticked rows

The People list's "Bulk actions for selected" writes the ticked registration ids to `sessionStorage` (`bulk-selection:<eventId>`) and opens this page with `selection=ticked`. The ids are never in the URL. The panel sends them as `selectedIds`; the server still narrows the filter to them and never widens it. If storage is empty the page says so and uses the whole filter, and "Use the whole filter instead" drops the selection.

## Privacy

Runs store keys, ids, versions and counts. A message approval also keeps the title and text staff wrote for the message and the queued registration ids; the audit log keeps only keys and counts. They never store a registrant's name, email or phone number, or the exported file. The run's query string can hold the search text staff typed while the run is PREVIEWED; it is replaced with `[text]` as soon as the run is confirmed, and previews past their time are expired in bulk (on the page load and on each new preview) with the same replacement. The audit metadata always uses the replaced form. The summaries list non-completed records by confirmation code and a reason code only.

`domain.ts` is pure; `repository.ts` is server-only; `http.ts` maps errors to responses.
