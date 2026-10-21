# From event management to a full camp system

## Purpose and evidence boundary

Prepared October 21, 2026 for IMSDA leadership, camp operations and the development team. Repository baseline: main `5e367b7c4d1b3c173d37c0415e335be76170b300`. This report examines overnight youth/summer/residential camp, separately from Camp Meeting, camporees and adult retreats. It is discovery and documentation; it changes no roadmap, account, policy or production setting.

IMSDA Events already has a substantial reusable foundation. A camp system would add the continuous responsibility for an individual child across enrollment, housing, activities, supervision, care, money and release. A conference event with lodging and meal tickets does not establish all of those capabilities.

The next useful input from UltraCamp is a **written capability, data-access and contract packet tied to the camp's actual workflows**. It should identify what can be exported or exchanged, what remains authoritative in each system and what can be retained after an eventual exit. An API key alone cannot answer those questions.

Current implementation statements below are based on source and repository documentation, not a live camp or production inspection. Future work is mapped to existing issue owners where possible. UltraCamp facts rely on the dated official-source research recorded in [#71](https://github.com/DurantTL/IMSDA-Events/issues/71#issuecomment-5139058493) and the October 20 comparison. The enforced network policy excludes UltraCamp's sites, so their current content, commercial terms and customer-specific entitlements were not freshly verified in this review.

## 1. Reuse the work already completed

Keep the existing decision register, event rehearsal material and synthetic import/output examples as the starting references. This report does not create another generic rehearsal or rebuild JSON, CSV and PDF import preparation.

The current foundation includes registration/form versions, party and club registration, private management links, payments and fixed reservation deposits, adjustment/scholarship and church billing workflows, durable email, calendars, check-in, badges, lodging, meal selections/tickets, scanner imports, kitchen counts and issued assets. These are useful components of a camp system. Their specific permissions, historical records and financial meanings should survive any camp expansion.

Existing references:

- [Legacy event-system inventory](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/LEGACY-EVENT-SYSTEMS.md) explains Camp Meeting, camporee and retreat requirements. It is not a summer-camp parity specification.
- [Lodging](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/LODGING.md), [Meals](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/MEALS.md), [Issued assets](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/ISSUED-ASSETS.md) and [Staff invitations](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/STAFF-INVITATIONS.md) document delivered operational behavior.
- [ADR 0002](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/decisions/0002-unified-operations-platform.md) keeps IMSDA event operations independent of UltraCamp. [#98](https://github.com/DurantTL/IMSDA-Events/issues/98) remains the ordered roadmap; all UltraCamp exchange remains optional Phase 5 under [#71](https://github.com/DurantTL/IMSDA-Events/issues/71).

## 2. Camp capability map

“Foundation” means useful existing behavior, not full camp parity. “Later scope” identifies an existing backlog direction; it does not promise completion or a release date. A camp-specific requirement is not classified as absent merely because its exact name was not found in a search.

| Camp operation | Current IMSDA foundation | What a full camp scope must establish | Existing owner/reference |
|---|---|---|---|
| Family, camper and responsible adult | People/household structures, attendee accounts, party registration and narrow declared guardian evidence | Verified authority, separate parents/households, who may see/change which camper, disputed or revoked access and multiple-session history | #40, #43, #91; `modules/guardian-authority` |
| Enrollment and sessions | Event/form versions, capacity, waitlist and registration lifecycle | Camp season/session structure, age/grade cutoff, eligibility, transfers, repeat weeks, offers, cancellation and concurrent seats | #100, #207–#209; current registration services |
| Forms and consent | Published policy/form versions and acknowledgment evidence | Camp-specific required forms, responsible signer, re-consent, expiration and completion/readiness across sessions | #43, #130/#132; #71 only for approved external readiness |
| Cabins and beds | Camp Heritage/Sunnydale lodging templates, rooms/cabins/beds, nightly availability, holds, assignments, moves and waitlist | Whether assignment is to cabin, individual bed/bunk or cohort; counselor association, age/gender/sibling and separation rules, occupancy by session and turnover | `modules/lodging`; #89 grouping |
| Counselor supervision | Event staff permissions, club roles and staff invitation/approval | Which staff are responsible for each cabin/group and time period, coverage/ratios, handoff and substitute authority | #65/#201–#203; #93/#252–#256 |
| Activities and attendance | Delivered Honors scheduling, seats, waitlists, instructor rosters and attendance/completion | General camp activity periods, prerequisites, skill levels, daily/weekly picks, change windows and camper whereabouts; reuse Honors only where its domain fits | #100/#207–#209; #89 |
| Check-in and movement | Event check-in, passes, club check-in and issued-item history | Arrival versus attendance versus custody; offsite trips, late arrival, temporary departure, overnight whereabouts and final release | #78, #79, #96 |
| Registration finance | Square payments, partial balance, fixed registration deposit, adjustments, scholarships and church invoices | Camp charges, sibling/sponsor rules, session transfers and refunds, scheduled collection, processor/account ownership and treasury reconciliation | #74, #92/#229–#232, #101/#120 |
| Camp store and allowance | Merchandise catalog foundation; issued badge/wristband identifiers | Guardian-funded balances, spending limits, POS, returns, tax treatment, unspent funds and cash/card reconciliation | #94; #54/#146–#148 is a separate merchandise purchase scope |
| Food operations | Meal plans/selections/ledger, tickets, scanner results and append-only kitchen counts | Individual camp entitlement versus registration quantities, supervision of special meals and approved dietary disclosure; money closeout remains #212 | `modules/meals`; #81/#192/#212 |
| Health history and care readiness | Narrow encrypted Health Record, permissions, acknowledgment, event windows, sealed copies and break-glass foundations | Camp nurse scope, current authorization/consent, care-plan review, approved emergency availability and clear external/local source ownership | #389/#44/#189–#192; ADR 0005 by addendum |
| Medication administration and treatment | Health-information storage is a foundation, not an evidenced complete care-log workflow | Intake reconciliation, orders/instructions, dose/time/route, due/PRN administration, refusal/missed/error, inventory/disposal, corrections, clinical review and restricted signatures | Camp-specific scope must be defined with qualified operations under #44/#79; not a generic form/notes feature |
| Pickup and custody | Narrow declaration of a responsible adult | Approved pickup people, identity verification, restrictions, expiring/revoked authority, duplicate-safe release, overrides and transport handoff | #96/#215–#217; policy gate remains |
| Transportation | Registration/group identity and event context | Routes/legs, vehicles, driver/vehicle readiness, manifests, departure/arrival and controlled rider substitutions | #78/#204–#206 |
| Staff lifecycle | Event access, screening-date evidence and office invitations | Recruiting, references, offers, onboarding/training, qualification expiry, supervisors, offboarding and personnel-record boundaries | #93/#252–#256; #70; #65 |
| Incident and emergency operations | Event references and limited operational records | Dedicated cases, missing-person response, restricted timelines, escalation, reunification, evidence, retention and after-action review | #79/#257–#261; decisions remain with that policy owner |
| Parent communication | Transactional/segmented email, attachments, announcements and private account/management routes | Which authorized adult receives which update, communication preference, emergencies versus announcements, support and delivery evidence | #77/#178/#179; do not infer authority from shared email |
| Outage and records continuity | Printable/exportable operations, existing backup/security runbooks and some duplicate-safe offline-entry paths | Each critical camp task's permitted degraded behavior, current restricted reference copy, reconciliation and secure disposal; no blanket offline promise | Existing runbooks; #264 is later native offline scope |

Two distinctions matter immediately. A bunk recorded in facility inventory does not establish camper-to-bunk assignment or counselor supervision. A dietary/medication answer or a Health Record does not establish a medication administration record. Those require explicit operational scope and evidence before anyone markets the platform as a complete camp system.

The narrow guardian repository states that a declaration gives no access to health, incident or other registration data. Preserve that boundary; a camper's name on a family registration must not silently grant every adult authority over the child.

## 3. What to obtain from camp leadership first

Ask the camp director/registrar, nurse or designated health lead, treasurer, staffing lead and the authorized UltraCamp administrator for a demonstration using synthetic participants. This is an extension of existing discovery, not a replacement decision register.

Capture the camp's real session types, ages, household arrangements, resident/day-camp differences, cabins and activity periods. Identify which tasks are performed daily, who is permitted to perform them and which exact UltraCamp screens/reports are relied upon. Record seasonal peaks, concurrent arrival stations and poor-connectivity locations as measured inputs rather than guesses.

For each critical task, collect the approved expected outcome and the existing sample output: a session roster, cabin/counselor roster, arrival/release list, activity list, financial statement or restricted care record. Keep sensitive workflows in restricted review; put only metadata and synthetic examples in the project. The question is whether IMSDA can produce the right operational result with the right authority, not whether it resembles UltraCamp's screen.

Identify the intended boundary: does camp registration remain in UltraCamp, move to IMSDA, or differ by program? Does the camp want only consolidated references/readiness, an archive when exiting, or a future operational replacement? That choice determines which of the following vendor requests are necessary. The current roadmap does not already select a new summer-camp replacement project.

## 4. What we need from UltraCamp

### A. Access and permitted use

Request the current API documentation/version, API License Terms, applicable customer agreement, enabled camp/account scopes and an entitlement/fee statement. The existing discovery identifies a real public REST documentation site and camp/account-level keys. Do not repeat the older uploaded report's conclusion that no public API exists.

The July discovery reports a limited/revocable interoperability/internal-use license and restrictions concerning replication/replacement or competing services using the API. The full current terms were not retrieved for this report. These are reported constraints requiring written confirmation, not a verbatim quotation or a legal conclusion. Ask the vendor and conference contract owner to address the exact intended overlap or exit use, lawful export/retention, permitted writes and post-termination access before approving a connector.

### B. A capability-by-domain answer

The public REST review recorded accounts/people, sessions/seasons/locations, carts/reservations, session-option rosters, waitlists, cancellations and operational/financial reports. It did not clearly establish health, medication, treatment-log, form-answer or form-completion endpoints. UltraCamp's product/help documentation describes medical and required-form features; availability in a user interface is not proof of API access.

Obtain a table from UltraCamp naming the supported method for every requested domain: API endpoint, webhook, scheduled report, secure export, supported deep link, or unavailable. Ask for exact fields, read/write permissions and customer-plan restrictions. Specifically ask whether form required/started/complete/out-of-date/review state can be returned **without answers**, and whether restricted medical-form readiness has a separate entitlement. An unknown response stays “unsupported/unconfirmed” in IMSDA; it must not be guessed from a successful reservation or a missing report row.

### C. Stable identity, history and change semantics

Request camp/account/person/session/reservation/form/transaction IDs and their relationships. Learn what happens when accounts or people merge, a child moves household, a session transfer replaces a reservation, a cancellation is reversed or a source row is deleted. Ask for creation/modification timestamps, time zones, tombstones and a supported incremental-change cursor or report cutoff.

Names, shared family email, phone and birth date are matching evidence, not a universal synchronization key. Use stable external references plus reviewed ambiguous matches. A source merge must not silently merge IMSDA people or transfer guardian authority.

### D. Reliable exchange and operational support

Request a sandbox/test camp, least-privilege credentials, rotation/revocation procedure, published limits, pagination, 429/retry guidance, timeout/maintenance behavior and a support escalation contact. Confirm write idempotency and whether a lost response can be reconciled safely before retrying. Ask which fields are eventually consistent and what “export as of” means.

For reports/archives, confirm maximum rows, attachment inclusion, readable relationships, permanent-save behavior, complete audit/history export and the time available before contract termination. Existing research says stored report groups may be temporary without an explicit permanent save; verify the current behavior rather than treating a downloaded CSV or stored group as a full archive.

### E. Finance and protected records

Ask who is merchant of record, which processor owns payment tokens, which balances/fees/refunds/credits can be exported, and whether transaction references survive a transfer or cancellation. Do not assume saved card credentials are portable or copy card details. Avoid a second payment ledger for one obligation; source ownership and reconciliation belong to existing finance policy. Current fees/processor restrictions need a written quote, not reuse of an older research price.

Health history, medication administration, treatment, insurance, attachments and incident evidence need separate field/role/retention answers. Prefer approved source references/readiness or restricted deep links where sufficient. Existing #71 does not authorize bulk copying these into ordinary IMSDA forms, emails, rosters or archives. Any separately approved protected archive needs its own encrypted manifest, retention/hold handling, access audit and tested restoration.

## 5. Data-contract checklist for existing examples

Use the JSON/CSV/PDF examples already prepared. Add a contract addendum only where the following metadata is missing; do not generate another generic import format or request real camper exports for prompts.

| Contract section | Fields/behavior to confirm | Why it matters |
|---|---|---|
| Envelope | Source product/version, camp, schema/export version, generated-at and as-of time, time zone, filters, complete/partial flag, row/attachment totals | A partial report must not be interpreted as deletion or zero attendance |
| Identity | Stable account/person/session/reservation IDs, source merge/replacement aliases and relationship references | Prevent duplicates and preserve original history |
| Lifecycle | Status vocabulary, effective time, cancellation/transfer reference, deletion/tombstone and last-modified/cursor | Preserve transitions instead of overwriting the latest row |
| Money | Currency/minor-unit amounts, charge/payment/refund/credit IDs, processor reference and allocation relationships | Reconcile value without creating or losing money |
| Readiness | Exact form/version/person/session, required/completion/review/expiry meaning, source time and supported unknown/error state | Missing/stale/unconfirmed is not “cleared” |
| Restricted files | Opaque reference, classification, permitted recipient, checksum, MIME/size, version and retention/hold metadata | Make any approved archive verifiable without broad searchability |
| Reconciliation | NEW/UPDATE/NEEDS CHECK/SKIP/error meaning, source digest, reviewed preview, counts, retry identity and partial-failure result | A repeat apply or changed source file must not double-create |
| Audit/ownership | Data owner, allowed direction, operator/purpose, approval evidence, source IDs and execution result | An imported fact does not automatically become editable authority |

Request synthetic edge cases, not only one successful row: duplicate names, shared email, multiple guardians, separate households, repeated camp weeks, account merge, session transfer, cancellation after payment, split sponsorship, refunded deposit, changed health-form version, revoked authority, an attachment version and an unavailable/stale feed.

## 6. Three operating models to compare later

| Model | Appropriate outcome | Main dependency |
|---|---|---|
| Retain UltraCamp for camp; IMSDA runs its current event/club scope | Fewest new camp responsibilities. Link or exchange only a separately approved minimum set if it materially reduces work | Document clear boundaries; avoid duplicate entry/contradictory balances |
| Controlled coexistence with a narrow Phase 5 adapter | Approved operational references/readiness reduce manual reconciliation while each system has named authoritative domains | Written permission, supported data contract, stable matching, staleness and outage behavior |
| Independently build a full camp capability and exit UltraCamp | IMSDA eventually owns the selected camp workflows and approved historical record access | Camp-specific scope, operational/clinical/policy sign-off, parity evidence, support capacity and permitted export/exit plan |

An exit archive alone may be the right scope when there is no continuing integration need. Rebuilding every historical UltraCamp screen or implementing two-way synchronization by default is not necessary to preserve records. Conversely, replacing registration does not prove that medication, supervision, pickup and staff workflows are ready to leave UltraCamp.

This report recommends obtaining evidence for those models before choosing one. It does not select a model, create a new queue, promote #71 or undo existing ADR 0002 ownership.

## 7. Scope and evidence needed before claiming full camp coverage

Use the existing issue and decision owners. Sessions/activity assignments map to #100/#207–#209; grouping to #89; staffing to #65/#93; transport to #78; release to #96; incidents to #79; cashless store to #94; protected care boundaries to #44. Medication administration/treatment and counselor supervision need camp-specific scope rather than assumptions that those parents already supply complete operational requirements.

A future camp readiness statement should name the exact program and feature version, approved roles, source ownership and supporting evidence. It should distinguish repository implementation, tested behavior, authorized configuration, serving-release verification and trained operational use. A passing registration test cannot certify a nurse workflow or custody release.

Extend the existing rehearsals only for genuinely new camp workflows: simultaneous arrival, camper movement between weeks, caregiver change, medication correction, unauthorized pickup, missed transport and connectivity loss. Record which critical task has a safe operational fallback and how its later reconciliation prevents duplicate actions. These are additions to existing evidence, not a new generic rehearsal plan.

## 8. Vendor meeting agenda and prepared request

Suggested 45-minute agenda: 5 minutes to confirm the selected use case and account entitlement; 10 for supported resources/identifiers; 10 for forms/health-readiness versus protected details; 10 for historical/financial exports and exit rights; 5 for reliability, sandbox and support; 5 to assign written follow-up owners and dates. The camp director/operations lead and authorized UltraCamp administrator should bring a synthetic walkthrough. Involve the conference contract owner and health lead for their respective questions.

### Draft request — prepared for the authorized administrator; not sent

**Subject:** UltraCamp capability and data-access confirmation for IMSDA camp planning

Hello [ULTRACAMP CONTACT],

We are documenting how [CAMP/CONFERENCE] uses UltraCamp and whether a future, limited exchange or eventual export to our independently managed IMSDA platform is appropriate. We are requesting documentation and written clarification; we are not asking to enable production writes or send participant/medical data at this stage.

Please provide the current API documentation/version, API License Terms, applicable access fees, supported account/camp scopes, sandbox availability and credential/rotation process. Please confirm whether our described use—[RETAIN WITH REFERENCES / LIMITED COEXISTENCE / HISTORICAL EXPORT FOR EXIT]—is permitted, including use of exported records after the contract ends.

For accounts/people, sessions/reservations, options/activities/lodging, waitlists/transfers/cancellations, financial transactions, online-form readiness, restricted medical workflows, attachments and audit history, please identify the supported API, report/export, feed or secure-link method. We especially need to know whether required/started/complete/out-of-date/review states can be supplied without form answers, and whether that covers medically restricted forms.

Please include stable identifiers and merge/transfer/delete semantics; pagination/change tracking; limits, retries and write-idempotency guidance; export completeness/relationships/attachment manifests; termination export and retention/deletion provisions; and support/outage escalation. Synthetic schemas and examples are sufficient. Please do not send actual camper, health, payment credential or personnel data in response to this request.

We will review the proposed field scope and ownership with our camp, finance, health and contract leads before any production connection. Thank you, [AUTHORIZED ADMINISTRATOR].

## 9. Source and confidence notes

- **Current source, high confidence for repository behavior:** main SHA above; `modules/lodging`, `meals`, `issued-assets`, `guardian-authority`, `payments/deposit-domain.ts`, `health-records`, `coordinator-health`, and the linked operational documents. Deployment, enabled health flags and real camp operation were not inspected.
- **Current project direction:** [#71 owner decision](https://github.com/DurantTL/IMSDA-Events/issues/71#issuecomment-5139118475), #98 and current ADR 0002. The old roadmap/ADR conflict was already reconciled; it is not a newly open decision.
- **Dated official-source findings:** [public REST documentation](https://rest.ultracamp.com/developers/docs/index), [API License Terms](https://ultracampmanagement.com/api-license-terms/), [Health and Medical](https://help.ultracamp.com/hc/en-us/sections/7258663404308-Health-and-Medical), [Online Form Reports](https://help.ultracamp.com/hc/en-us/articles/7259296035988-Online-Form-Reports), [Session Roster](https://help.ultracamp.com/hc/en-us/articles/7259287896212-Session-Roster-Report), [Account Detail](https://help.ultracamp.com/hc/en-us/articles/7260056170132-Account-Detail-Page), [Activities or Options](https://help.ultracamp.com/hc/en-us/articles/8911704522644-Should-I-use-Activities-or-Options), and [Stored Groups/Exporting](https://help.ultracamp.com/hc/en-us/articles/7259298092436-Storing-Groups-and-Exporting). These links were reconciled from prior research, not re-fetched here.
- **Superseded research statement:** the uploaded integration report's unsuccessful search for public API documentation does not override the specific REST documentation identified in #71. Negative search results do not establish product or API absence.
- **Still unverified:** the camp's actual contracted entitlements, current API fields/limits, medical-readiness source, attachment/history coverage, post-termination rights, current pricing, supported authentication details and permitted replacement/coexistence use. Obtain written answers; no fee, compliance certification or vendor permission is asserted by this report.

The accompanying `evidence/ultracamp-sources.json` records the references, evidence dates and limitations so future updates can replace unknowns with verified answers without reopening decisions already made.
