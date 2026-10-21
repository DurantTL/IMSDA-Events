# IMSDA Events: accessibility and usability review

Prepared October 21, 2026. Source baseline: main `5e367b7c4d1b3c173d37c0415e335be76170b300`.

## Assessment and evidence

IMSDA Events has useful accessibility foundations: shared keyboard-aware dialogs, named actions, sortable table semantics, dirty-navigation handling, status announcements and responsive rules. The largest remaining usability risks are inconsistent recovery and meaning across screens. Someone can lose an unfinished edit, copy an unsaved public address, misunderstand an amount due, or believe a report action includes more records than it does. Fixing those inconsistencies will help experienced operators and new users more than another broad redesign.

This document consolidates the earlier source and visual reviews into a practical accessibility handoff. It rechecks representative current components, connects findings to existing issues, and identifies the remaining browser and assistive-technology evidence needed. It does not duplicate the project's completed event rehearsals, decision register or import/sample-output work.

**Evidence labels used here:**

- **Source-confirmed:** behavior is present in the pinned source; the finding does not claim a production-data incident.
- **Recorded layout finding:** an existing audit reports the width/overflow behavior; it was not remeasured in a browser for this document.
- **Accepted design direction:** reviewed visual direction with implementation still tracked separately.
- **Proposal:** a possible presentation improvement with an existing owner; it is not a delivered capability.
- **Manual verification outstanding:** behavior such as screen-reader announcement quality, real-device focus and printer output still needs observation in the relevant release.

No production session, private record, live payment or real message was used. No application code or test was changed. This is not a WCAG conformance statement; the criteria references below identify relevant checks, not certified passes or failures.

## Preserve the existing strengths

The shared [dialog helper](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/use-accessible-dialog.ts) moves focus into an open dialog, contains Tab movement, makes the top dialog own Escape, and restores prior focus when the dialog closes. A confirmation over an editor can therefore have a predictable keyboard path. This is a reusable foundation; the remaining work is applying it consistently and making dismissal preserve changes.

The shared [Actions menu](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/actions-menu.tsx) uses a native disclosure, closes on Escape/outside interaction and returns focus to a visible trigger. [Sortable headers](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/list-sort.tsx) expose `aria-sort`, use named buttons, hide decorative arrows from assistive technology and provide a readable order note. Retain those semantics when tables become cards or gain optional columns.

The current event-settings editor also has valuable recovery behavior: a failed save can open the relevant section and focus the first invalid control; later error clearing does not repeatedly move focus. Saving settings, publishing and unpublishing are distinct actions. The [responsive guidance](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/RESPONSIVE.md) and global styles establish type floors, phone target rules and visible focus treatment. These are implementation conventions to preserve, not proof that every rendered state conforms.

## Four workspaces, one understandable visual language

The accepted role separation remains authoritative. Later calendar, roster and public-page mockups do not add further System menu changes. Reuse the destination registry and navigation agreed in [#1073](https://github.com/DurantTL/IMSDA-Events/issues/1073) and [#1074](https://github.com/DurantTL/IMSDA-Events/issues/1074), with the role contract in [#1109](https://github.com/DurantTL/IMSDA-Events/issues/1109).

| Person | Context the page must communicate | Usability boundary |
|---|---|---|
| Attendee | Own registrations, their event/status and permitted next action | No administrator sidebar or global metrics. Several people on a registration do not establish permanent household or guardian authority. |
| Director/deputy | Selected club and club year; own roster, forms, reports and events | Registrar and reporter remain narrower roles. A sponsoring-church bill must not look like the attendee's personal Pay now task. |
| Area Coordinator | Clubs available to the current grant; oversight and permitted review | Current source selects all active clubs. Planned ministry scope is a separate project. Club views stay read-only, with the specific existing own-location Team approval exception. |
| Event staff | Selected event and only the functions that the actual permission set permits | A kitchen-only worker must not gain registration/report navigation through a redesigned overview. |
| System administrator | Explicit System or selected Event context, with a clear return | Platform access is not a reason to collapse protected-domain guards or combine unrelated financial, screening and arrival statuses. |

The existing [role reference](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/role-workspaces/README.md) provides accepted examples. Its sample counts are illustrative. A real context switch lists only workspaces the signed-in person can enter; a gallery's persona switcher is review navigation rather than a product requirement.

## Findings that most affect confidence and task completion

Priority below describes user impact within this review. It does not reorder [#98](https://github.com/DurantTL/IMSDA-Events/issues/98), remove a gate or add `codex-ready`.

### 1. Keep unfinished work through every dismissal path

**Source-confirmed; high impact. Owners: [#1101](https://github.com/DurantTL/IMSDA-Events/issues/1101), [#1104](https://github.com/DurantTL/IMSDA-Events/issues/1104).** The roster editor's close callback immediately clears the open editor; Close, Cancel, Escape and backdrop do not share a dirty-state review. Announcement and schedule editors have similar gaps beyond the fields already covered by communications dirty tracking.

Someone fixing a member's contact details or composing arrival instructions can lose that work even though another editor elsewhere preserves it. Reuse the shared dialog and unsaved-navigation patterns: Keep editing or Discard changes, one baseline after successful save, retained values after validation/network failures, and no dismissal while a save is unresolved. A nested confirmation should own Escape and return focus to the editor, not close both layers.

**Observable acceptance:** type a synthetic change; try each close path; choose Keep editing; the exact text remains. A failed save leaves it editable. A successful save or deliberate discard is the only reset. Saving an announcement never publishes, approves or queues email by itself.

### 2. Show payable amounts and upcoming participation accurately

**Source-confirmed; high impact. Owner: [#1100](https://github.com/DurantTL/IMSDA-Events/issues/1100).** Account summaries use the raw registration balance for non-deferred records, while the public payment view already has lifecycle-aware meaning. The account home chooses its upcoming list by event end date, allowing a cancelled record to compete for “Your next event.”

A cancelled paid-and-refunded record can appear to owe money through raw arithmetic even though checkout correctly treats it as not payable. Reuse the existing payment/lifecycle projection. Keep original charges, payments and refunds available as history, give a waitlisted request its explicit state, and label the population of any account-wide amount. This is clarity in an existing account, not a new financial policy.

**Observable acceptance:** active, waitlisted, cancelled unpaid, cancelled paid/refunded, past and church-billed examples agree with the existing management/payment view. A cancelled earlier event does not displace the next eligible participation. No historical money is erased to make the display look correct.

### 3. Public sharing must describe the saved address

**Source-confirmed; high impact. Owner: [#1115](https://github.com/DurantTL/IMSDA-Events/issues/1115).** The sharing panel and embed builder read the editable draft slug/name even though the component separately maintains successfully saved state. An organizer can therefore copy or open an address that has not been saved, including after a failed save.

Generate public URLs and embed code from persisted settings. A draft preview must be labelled as a preview and remain distinct from public sharing. Copy event link, Copy form link and Copy embed code are different actions. Announce success/failure and reset copied feedback when its source changes.

**Observable acceptance:** changing the slug without saving does not alter public outputs; a failed save leaves the old address intact; a successful save updates the address. A browser clipboard failure has a usable fallback. No private management token or staff-only preview URL is presented as public sharing.

### 4. Show the true scope before communicating with a report audience

**Source-confirmed; high impact. Owner: [#1103](https://github.com/DurantTL/IMSDA-Events/issues/1103).** The report-to-email button deduplicates registration IDs and slices the list to 250 before recipient review. The current action does not explain the omitted remainder.

Keep the current server limit and reviewed send path, but state matched, selected and omitted counts. Let the person review an explicit bounded set. Distinct registrations sharing an email address may still require registration-specific messages; global address deduplication is not the correction.

**Observable acceptance:** 250 and 251 distinct-registration examples make the difference visible. The recipient review exactly matches the selection, including after refreshing a stale preview. No message is queued just by opening or closing the review.

### 5. Repair keyboard behavior in the merchandise editors and preview states

**Source-confirmed; medium impact. Owner: [#1108](https://github.com/DurantTL/IMSDA-Events/issues/1108).** Product/variant editors have dialog roles and labels but do not apply the shared dialog focus behavior. Audience preview changes update the selected audience before fetching; failed or out-of-order responses can leave old cards under a new audience label.

Reuse the existing focus/Tab/Escape/return behavior and dirty-edit protection. Tie preview results to the audience actually evaluated, with loading, failed/retry and empty-success states. This corrects editor interaction and preview truthfulness; it does not establish a public authorization failure or implement the held purchase/stock engine.

**Observable acceptance:** a keyboard user can enter, complete and close each editor without losing focus. Rapid audience changes cannot mislabel stale cards, and a failure is not presented as an empty successful result.

## Everyday discoverability and responsive improvements

| Finding and evidence class | Existing owner | Practical acceptance example |
|---|---|---|
| Source-confirmed: the registration result-order note always describes newest submitted first, even when the canonical search uses name or oldest-first order. | [#1116](https://github.com/DurantTL/IMSDA-Events/issues/1116) | Name ascending produces a matching readable order note; the query remains authoritative. |
| Source-confirmed: an offline arrival row can say Not saved while the same item is saved in the device queue. Nearby operational guidance retains obsolete screening wording. | [#1102](https://github.com/DurantTL/IMSDA-Events/issues/1102) | Row, queue and announcements agree on Saved on this device / Queued—not confirmed / Needs review / Confirmed. Only server-confirmed arrivals enter confirmed totals. |
| Source-confirmed: month cells show three items and plain +N more text. The agenda contains the remaining in-month items. | [#1117](https://github.com/DurantTL/IMSDA-Events/issues/1117) | View all 5 events for the full date takes the user to all five items while preserving category and month. Phone dots stay noninteractive; the agenda remains the accessible route. |
| Source-confirmed: club search supports town, ZIP, club and church, but describes only town/ZIP and lacks explicit result/map coverage feedback. | [#1118](https://github.com/DurantTL/IMSDA-Events/issues/1118) | Clear search, N publicly listed clubs found, M on map, no-match recovery and an honest map-unavailable state. Unmapped clubs remain usable in the list. |
| Recorded width finding: invitation tables overflow intermediate tablet containers at 861px without a scroll cue. | [#1045](https://github.com/DurantTL/IMSDA-Events/issues/1045) | Either usable cards at the affected width or a visible, keyboard-usable horizontal-scroll wrapper; long names and actions remain reachable. |
| Proposal: attendee task columns, roster density and visibly labelled row actions can reduce scanning and memorization. Current named icons already have assistive labels. | [#181](https://github.com/DurantTL/IMSDA-Events/issues/181), [#1112](https://github.com/DurantTL/IMSDA-Events/issues/1112) | Resettable stable-ID columns; a readable Edit or named Actions control; phone cards preserve labels and sort controls. No new protected column access. |
| Accepted direction/proposal: task help, System/Event context and settings impact need a consistent presentation across the accepted workspace shells. | [#1074](https://github.com/DurantTL/IMSDA-Events/issues/1074)–[#1077](https://github.com/DurantTL/IMSDA-Events/issues/1077) | A new helper can name the current scope and change consequence, find the task guide, and return without losing an edit or requesting broader access. |
| Proposal: public content, form presentation and sharing need a connected organizer view; the full multi-page site builder remains future work. | [#448](https://github.com/DurantTL/IMSDA-Events/issues/448), [#283](https://github.com/DurantTL/IMSDA-Events/issues/283), [#284](https://github.com/DurantTL/IMSDA-Events/issues/284) | Distinguish saved public page, draft preview, form URL, embed and private management link. Do not add a new top-level System item from a mockup sidebar. |

The public club projection deliberately omits personal contact details, member records and precise meeting addresses. A friendlier finder must not add those fields casually. Likewise a meal column preset, health status badge or help screenshot must not enlarge health disclosure. Explain what is absent and offer the existing permitted help path.

## Accessibility checks to attach to the relevant existing work

These checks complement existing rehearsals and automated checks. Attach the result to the actual release and affected issue rather than create another whole-system rehearsal plan.

| Concern | What needs observation | Relevant WCAG 2.2 guidance |
|---|---|---|
| Keyboard and dialog order | Start from the trigger; reach every control; Tab stays in the top dialog; Escape affects the top layer; closing returns to a useful visible control. | 2.1.1 Keyboard; 2.1.2 No Keyboard Trap; 2.4.3 Focus Order; 4.1.2 Name, Role, Value |
| Focus visibility and sticky UI | Focus remains visible behind sticky Save bars, menus and the phone keyboard; error focus reveals its control without repeated jumps. | 2.4.7 Focus Visible; 2.4.11 Focus Not Obscured (Minimum) |
| Labels, sorting and status | Names convey the person/action; `aria-sort` matches displayed order; asynchronous counts/save/errors are announced without unnecessary focus movement. | 1.3.1 Info and Relationships; 2.4.6 Headings and Labels; 4.1.3 Status Messages |
| Errors and consequential changes | Errors identify the field and correction; entered values survive failure; review makes financial, deletion and recipient consequences explicit. | 3.3.1 Error Identification; 3.3.2 Labels or Instructions; 3.3.3 Error Suggestion; 3.3.4 Error Prevention |
| Reflow and magnification | At 320 CSS-pixel equivalent width, 200% text zoom and larger browser zoom, ordinary controls and text remain usable. Genuinely two-dimensional tables may scroll within a labelled, discoverable region. | 1.4.4 Resize Text; 1.4.10 Reflow; 1.4.12 Text Spacing |
| Touch and pointer | Dense controls have spacing/size appropriate to the task; a decorative icon's size is separate from its hit target. | 2.5.8 Target Size (Minimum); 2.5.3 Label in Name |
| Color, contrast and motion | Text, status and focus contrast are measured in actual states; status has words as well as color; reduced-motion preference is respected. | 1.4.1 Use of Color; 1.4.3 Contrast (Minimum); 1.4.11 Non-text Contrast |
| Authentication and timing | Real staff step-up, expired staff sessions, attendee fallback and permitted password-manager/passkey paths have clear recovery without granting access. | 3.3.8 Accessible Authentication (Minimum); applicable 2.2.1 Timing Adjustable exceptions/requirements need review |

The product's 44px phone target convention is stronger than WCAG 2.5.8's basic 24 CSS-pixel minimum/spacing conditions. The 14px staff text convention is a product readability choice, not a WCAG minimum font-size rule. Neither number alone proves conformance. Use real computed contrast and device/browser behavior, including long names, translated text, errors, disabled controls and loading states.

At minimum, observe representative keyboard use in a desktop browser and screen-reader use in a supported desktop/mobile combination. Record the browser, assistive technology, zoom, release and task. A source audit can find a missing hook; it cannot establish how VoiceOver or NVDA announces a live page.

## Help and communication content that improves the same tasks

Keep inline labels and concise errors beside the action. Task help should explain the workspace, prerequisite, consequence, verification and safe next step. Reading a guide does not grant permission, complete readiness, certify training or send a message. A help drawer needs an accessible title and close action, keyboard return and preservation of the unsaved work behind it.

Useful wording examples for the existing owners include:

- **Saved public sharing:** “These links use your saved event settings. Save address changes before sharing them.”
- **Device queue:** “Saved on this device. Check-in is not confirmed until it syncs successfully.”
- **Report audience:** “251 registrations matched. This review includes 250; 1 is outside the selection.” Use the final approved bounded-selection behavior rather than silently omit it.
- **Church billing:** “Billed to the sponsoring church.” Keep this distinct from a personal balance or a confirmation that the church has paid.
- **Finder feedback:** “6 publicly listed clubs found; 4 shown on the map.” Missing coordinates do not remove the other two list results.
- **Dirty editor:** “Keep editing” and “Discard changes,” with the affected task named where needed.
- **Unavailable action:** explain whether the cause is missing permission, an off/unavailable feature, missing configuration, a closed registration window or a save conflict. Avoid a generic disabled control with no explanation.

Do not put private registration links, medical values, credentials or production screenshots into general guides/support messages. A support-details action should collect only the approved route/release context and a description. The separate help/content document in this pack provides reusable user-facing copy and ownership detail.

## Visual references and what they establish

The accepted [four-role screenshots](https://github.com/DurantTL/IMSDA-Events/tree/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/role-workspaces/screenshots) establish presentation direction and persona separation. They are synthetic design examples, not screenshots of deployed features. The later [public-journey gallery](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/public-journeys-and-lists/mockups/README.md) is a set of proposals, including the roster phone card inspected for this review.

That roster phone proposal makes the club/year visible, labels Export roster and Add member, places search/sort/column controls in a single flow, and repeats labels within a person card. It illustrates discoverability, not a claim that search, column persistence or that exact phone shell has shipped. Its ordinary text and target spacing should still be checked in implementation rather than inferred from an image.

Screenshots under `docs/screenshots/issue-645` and similar historical folders are useful before/after evidence for those specific changes. Their dates and source releases matter; they should not be used as an unqualified tour of current behavior. New training screenshots should replace proposals only after the relevant implementation is verified, retaining the same role and synthetic-data discipline.

## Verification record and handoff

For this document, representative current source was read and compared with existing issue bodies, role contracts, visual references and validation records. The roster-phone proposal was visually inspected. No new automated accessibility scan, live-browser keyboard run, screen-reader session, physical print or unit-test execution was performed for this document.

The earlier [public-journey validation record](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/public-journeys-and-lists/validation.md) reports 137 existing tests across eight focused files against unchanged application source. Those tests support existing query/calendar/list/content contracts. They do not establish completion of these fixes, current production deployment or accessibility conformance. The broader technical-checks document in this pack records the CI and code evidence separately.

Use the existing issue owner for each correction; preserve the accepted menu and role boundaries; choose only the current approved work from #98. For each implemented slice, retain the source change, targeted test result, affected phone/tablet/zoom captures and applicable manual keyboard/assistive-technology observation. Existing detailed specifications are the starting point, so no duplicate broad accessibility or redesign epic is proposed here.

## Source index

- [Current source tree](https://github.com/DurantTL/IMSDA-Events/tree/5e367b7c4d1b3c173d37c0415e335be76170b300), [global styles](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/app/globals.css), [responsive conventions](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/RESPONSIVE.md).
- [Roster editor](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/club-roster-workspace.tsx), [communications editor](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/communications-workspace.tsx), [event settings/sharing](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/event-settings-workspace.tsx).
- [Account projection](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/modules/attendee-accounts/registrations-repository.ts), [report email handoff](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/email-registrations-button.tsx), [merchandise editor](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/merchandise-admin-workspace.tsx).
- [Calendar page](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/app/%28public%29/calendar/page.tsx), [club finder](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/components/public-club-directory.tsx), [strict public club projection](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/modules/organizations/public-club-directory.ts).
- [Role contract](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/role-workspaces/evidence/role-contract.md), [accepted help direction](https://github.com/DurantTL/IMSDA-Events/issues/1077), [lists/public-journeys review](https://github.com/DurantTL/IMSDA-Events/issues/1114).
- [WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/). Criterion mapping is explanatory; no external conformance assessment is claimed.
