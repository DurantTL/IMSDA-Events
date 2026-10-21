# Public calendar: make crowded days lead to the complete dated agenda

Tracking: [#1117](https://github.com/DurantTL/IMSDA-Events/issues/1117).

Parent: #107; context: #1114. Build on delivered #444/#445/#1086 and phone accessibility correction #996.

## Current behavior and design gap

In month view, a day renders the first three entries and then a plain `<li>` saying `+N more`; the day number is a span. It does not lead to that day's full list. All in-month entries remain available in the agenda below, so this is a discovery/navigation improvement, not data loss. At 760px and below chips intentionally become inaccessible decorative dots while the full agenda supplies real links; preserve that fix.

Evidence: [month overflow and current agenda](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/app/%28public%29/calendar/page.tsx#L145), [phone chip contract](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/calendar-month-chip.tsx), [agenda destinations and status](https://github.com/DurantTL/IMSDA-Events/blob/72a6cb214185cd7b74696f8913535f85330b690f/components/calendar-agenda-item.tsx).

## Proposed bounded behavior

- A crowded date offers a real labelled action such as **View all 5 events for April 24, 2027**. It navigates/focuses a complete dated agenda section or accessible day detail using the existing public projection.
- Preserve selected month/category in navigation and state. Clearly identify selected full date, total public item count, empty date and return to month/agenda.
- If adjacent-month dates become actionable, open the correct date/month; do not leave an overflow control pointing to a list that excludes those items.
- Month chips, dated results and Upcoming keep the same item/status/destination contract. Deadline, office closure, cancellation/postponement, informational offsite entry, published registration event and several dates linked to one event remain distinct.
- Phone dots remain decorative/non-focusable. Expose a visible labelled date/day action or easy agenda path with at least 44px target; never add invisible one-pixel links to the tab order.
- Date headings, focus movement and return are understandable by keyboard/screen reader; counts need no color-only interpretation.

## Acceptance criteria

- [ ] Synthetic date with 0, 1, 3 and 5+ items demonstrates clear discoverability and full dated results; multi-day overlaps use the existing date semantics.
- [ ] Current category remains applied, count agrees with the complete authorized dated set, and Clear category/return controls are usable.
- [ ] Adjacent months, long titles, repeated dates, closures/deadlines and cancelled/postponed records retain correct labels and links.
- [ ] Several calendar items linking one registration event retain their individual dates and the same correct event destination.
- [ ] No draft/private/hidden/archived event is exposed through a day shortcut beyond the existing public repository contract.
- [ ] Check desktop, 360/390px, tablet, keyboard, 200% zoom and focus return. Existing agenda and subscription/feed behavior remain usable.

This adds no calendar/search service, ICS semantics, recurrence change, date synchronization, automatic event linking or new event-directory layer. #106 remains searchable event-directory ownership. Layout proposal follows normal #98 scheduling; no automatic `codex-ready`.
