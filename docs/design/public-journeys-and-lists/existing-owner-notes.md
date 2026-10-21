# Detailed additions to existing owners

These notes were added to the live issues during the #1114 review. They capture proposed refinements and preserve each issue’s existing domain scope and decisions.

## [#181](https://github.com/DurantTL/IMSDA-Events/issues/181)

### Registration/roster columns and truthful scope — October 21 review

Review: #1114. Keep delivered #180 query/filtering, #784 attendee listing/CSV, #490 director export formats and #811 table alignment. These are foundations; this issue still owns stable saved filter/sort/column/group/display configuration and exact drilldowns.

### Proposed default priorities

| Surface | Default lead information | Secondary task information |
|---|---|---|
| Registration hub | Current cards: registrant, confirmation, people count, lifecycle state, location, submitted time | Permitted details/history; optional compact display is a saved-view choice, not a forced table conversion. |
| General attendee table | Name, status, confirmation link, attendee type, group/church | Meal/dietary flag, childcare, volunteer and contact fields in authorized task views. |
| Meal-planning view | Name, meal preference, dietary-needs indicator, group/church, confirmation | Free-text dietary details remain under the existing health access checks; a preset never grants them. |

The current attendee list renders 13 fields from `LISTING_COLUMNS`. Use stable column keys for visibility/order, human labels and Reset to default; never persist translated labels/array indexes as identity. Missing/retired/unauthorized fields must be explained on restored views without querying or revealing their values. Phone cards retain corresponding labels and independent sort controls. Long text wraps, and essential identity remains readable at 200% zoom.

### Query, selection and export meaning

The registration hub has a server search plus a local filter of loaded rows; during paginated search it already labels that page scope. Its selection is by ID and can retain rows hidden by the local filter; preserve visible selected/in-this-view counts and Select all N shown. An off-page record opened in detail is not a search row or selection.

The generic registrations CSV URL currently carries location only, while the attendee CSV serializes the attendee-list query. Do not describe every Export as matching the visible list or selection. Label the actual current export population first. Later matching-query export must use #181/#182's canonical query, authorization and reviewed-action contract, not client-visible IDs alone. Director saved export formats remain their delivered, separate feature.

#1116 independently corrects the current false result-order note. It must not wait for saved-view persistence. Counts name registrations versus attendees versus members; a task profile is neither a permission bundle nor an approval/readiness definition.

Acceptance additions: demonstrate the same permitted field keys across table/card/CSV where a matching export is offered; denied/stale fields, long content, duplicate names, page versus full-result selection, actual export scope, and keyboard/phone sort controls. Do not add protected fields to resolve duplicate names.

Source baseline: [attendee columns](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/modules/registrations/attendee-listing.ts#L219), [registration cards/export/selection](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/people-workspace.tsx#L755). New column priorities are review recommendations, not an extra permission grant or queue change.

## [#283](https://github.com/DurantTL/IMSDA-Events/issues/283)

### Event-page customization continuity — October 21 review

Review #1114 found that Event settings, Public content and registration forms already offer different parts of the public experience. Keep their current records and renderers; do not make an event's landing page and its registration look like unrelated products or build a second theme store in #448.

Use a clear resolution chain in the organizer UI: platform fallback → event theme version → explicit supported form override. Name which channels consume each value and show when an override applies. Current hero/content/placement controls are delivered; versioned colors/fonts/spacing and cross-channel consistency remain this issue's scope. The existing systemadmin-only custom-HTML event-content contract is separate; this theme slice does not introduce arbitrary CSS/HTML or expand that privilege.

Review one representative event across public landing, ordinary registration, embed, review, confirmation and compatible private management. Show the same event identity with coherent controls, accessible status semantics and resilient long content. Keep lifecycle/payment/availability source data authoritative and historical artifact versions stable. Club-director/general-link/group entry routes retain their own behavior and billing meaning.

#1115 corrects current sharing outputs independently. #448 retains the public-setup entry decision. #284 owns composed device/state preview and mobile summary; #247–#251 own the full site builder. Add representative screenshots for the implemented channels, missing/invalid theme fallback, per-form override, waitlist/closed and church/group billing. No new queue priority or domain policy follows from this review.

## [#284](https://github.com/DurantTL/IMSDA-Events/issues/284)

### Composed preview and content/link review — October 21 review

Context #1114. The Public content editor already has per-block/per-card previews, accessible move controls, section placement and independent publication. Preserve those delivered controls; describe this issue's remaining preview work as **composition and state coverage**, not the first preview system.

A useful organizer review pairs an outline (section title/type, placement, saved/draft/public state) with the rendered event/form composition at phone/tablet/desktop widths. The actual landing renderer handles hero, resource tiles, registration choices and prose differently, so editor order alone is not proof of final visible order. Reuse source renderers/adapters; do not build a parallel registration renderer or turn the page editor into a second form builder.

Include draft/unpublished, published/open, not-yet-open, closed, full/waitlist and unavailable states; zero/one/multiple forms; ordinary, director, eligible general-link/group entry; direct payment versus deferred sponsoring-church/group billing; external details missing/present; revoked/missing asset; allowed/disallowed embedding; long text and validation errors. Synthetic preview must never publish, reserve, register, charge, send a live message or disclose private management tokens.

Each link action states whether it opens the saved public event, a specific form, an embed, an offsite resource or an authorized preview. #1115 fixes current unsaved share links separately. Preserve separate Save/Publish/Unpublish and server access checks. Draft preview must work through authorized preview semantics rather than briefly publishing the event. The full multi-page/redirect/domain/publication model remains #247–#251.

Evidence: [existing block/card previews](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-content-workspace.tsx#L689), [current public composition](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28public%29/events/%5BeventSlug%5D/page.tsx#L87).

## [#448](https://github.com/DurantTL/IMSDA-Events/issues/448)

### Current-source review and proposed bounded public-setup entry — October 21

Review index #1114. The current Step 3 already contains the optional IMSDA.org page URL, support contact, club tagline/subtitle/help email and attendee-hub copy. Public content separately owns assets, hero/text/resources/notices/blocks, placement and per-section publication. Settings sharing already exposes the public page and published-form embed code. Calendar creation/linking and many-dates-to-one-registration are delivered in #444/#445/#1086. Do not plan these as untouched or duplicate their stores.

Recommended first slice: a recognizable **Public page & links** overview that links to current owners and shows event identity, published/draft state, content outline, registration form choices and actual sharing destinations. Prefer progressive disclosure and deep links before moving persisted fields or building a parallel website-settings model. An outline should show section title/type, Public page/Form/Both placement, draft/public status and edit destination; it must reflect the actual composed page where hero/resources/form choices/prose have special placement, rather than promise a freeform canvas.

### Proposed destination inventory

- Saved public event URL: `/events/[eventSlug]`.
- Each permitted published form URL and its `/embed/[eventSlug]/[formSlug]` output, with purpose and embed-domain policy explained.
- Club/director, eligible general-link and group registration destinations remain distinct workflows, not aliases for the standard form.
- Optional external details URL and resources show their actual target/purpose; blank external details must not produce a dead card.
- Attendee account and private management remain authenticated/token-authorized destinations, never public share buttons.

#1115 independently fixes use of unsaved slug/name in current sharing outputs. That correction need not wait for the Step 3 decision. #283 owns constrained cross-channel theme versions, #284 synthetic device/state preview and mobile summary. #247–#251 retain multi-page site navigation, custom domains, redirects, scheduled publication and rollback; do not activate them through this overview.

The existing decision about final Step 3 contents remains explicit. This review recommends the above first slice; it does not claim Caleb already chose a complete new field migration. No roadmap reorder or automatic codex-ready.

Evidence: [Step 3 current fields](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L930), [sharing panel](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-settings-workspace.tsx#L1078), [content section controls/placement](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/event-content-workspace.tsx#L575).

## [#1074](https://github.com/DurantTL/IMSDA-Events/issues/1074)

### Shared icon and destination-language review — October 21

Related review #1114. Reuse existing Lucide/button primitives and labelled ActionsMenu; the opportunity is consistent meaning, not a global icon replacement. Pair unfamiliar row actions with visible Edit/View/Actions text. Keep icon-only controls where their meaning is obvious and accessible names/tooltips/focus remain useful.

Distinguish navigation, edit, destructive erase, download, copy link, copy embed and open-new-tab. An ExternalLink glyph is currently used both for offsite calendar destinations and same-site public pages opened in a new tab; labels should explain the actual destination/window behavior. Status colors never stand in for registration/payment/arrival/approval state. A 13–18px glyph may sit in a 44px phone target. Hidden labels alone do not teach sighted first-time users what an unfamiliar glyph does.

System navigation search/menu must preserve scope, authorized destinations and dirty-state guards. The attendee/director/coordinator shells keep their distinct roles; this shared vocabulary does not give them a system sidebar. Verify keyboard/phone/focus return with current shared components. Domain confirmations and privacy remain unchanged.

## [#1112](https://github.com/DurantTL/IMSDA-Events/issues/1112)

### Roster column and icon follow-up — October 21 review

Context: #1114. Keep the accepted club/year shell and existing authorization. The current table has Name, Age, Type, Current class, Role, Gender and Flags, plus capability-gated birth date, screening, Honors and Actions. The delivered #811/#1004 layout and missing-birth-date noise fixes remain the baseline; #490 already provides configurable roster exports.

Recommended daily hierarchy: lead with Name, Age, Type, Current class and a concise actionable status/missing-detail summary. Keep Role/Gender and currently permitted screening/Honors information discoverable in the appropriate task view or detail; do not remove access to an existing required task. Birth date remains behind its explicit authorized reveal and is never added to ordinary coordinator/registrar views merely for table symmetry. No new client permission registry.

Current Edit/Remove controls have person-specific accessible names, but only pencil/trash glyphs are visible. Improve sighted first-use discoverability: show **Edit** for the primary permitted row task and a labelled person-specific **Actions** disclosure for less frequent tools. Keep useful existing Honors/Health/Emergency contact destinations according to capability. Preserve the delivered ActionsMenu keyboard/Escape/focus-return pattern where appropriate; phone targets remain 44px even when glyphs are small.

Remove is consequential: the current confirmation states that birth date/details are erased and offers marking Inactive instead. Keep that exact domain meaning, authorization and confirmation. Do not move erasure into a one-click icon, treat Cancel as removal, or make read-only rows appear editable. Coordinator records and registrar/reporter/deputy differences retain the source contract.

Verify long/duplicate names; many Honors without rendering a pill wall; missing detail filter/reset and meaningful edit destination; horizontal intermediate widths; phone cards with matching labels; labelled primary/secondary actions; keyboard and 200% zoom. #1101 still independently owns unsaved edit recovery.

Source: [actual columns and row actions](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/club-roster-workspace.tsx#L486), [existing erase confirmation](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/club-roster-workspace.tsx#L373). These column/action refinements are proposed review detail; they do not change the already accepted role separation or #98 ordering.

