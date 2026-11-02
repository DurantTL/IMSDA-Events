# Site rules

Every rule Caleb has approved for how the site looks and behaves, one line each,
in his wording where he gave it. Reviews and builds check changed pages against
this list (see `AGENTS.md` → Checks and `.agents/skills/imsda-review/`).

- **Adding a rule:** a newly approved rule is added here in the same PR that
  builds it, with its issue number.
- **Guard test:** a code check (Vitest or a `scripts/` check) that fails when
  the rule is broken. "planned (#1440)" means it does not exist yet.
- **Browser test:** a check that uses the page in a real browser.
  "planned (#1439)" means it does not exist yet. The mobile layout audit is
  `npm run test:mobile-layout` (`scripts/verify-mobile-layout.ts`). The role
  journeys suite is `npm run test:club-journeys` (`scripts/verify-club-journeys.ts`,
  the required CI check "Club journeys (real browser)"): club directors and area
  coordinators use the site in Chromium at 1280 and 390 px wide, and every page
  they visit is checked against the rules listed here for it.
- **Rule IDs** (G1, S1, …) are what a review report names when it lists the
  rules it checked.

## General

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| G1 | Make every part of the same kind look and work the same, and fix it in one place. Don't make a new version of something that already exists elsewhere. | planned (#1440) | planned (#1439) | #1342 |
| G2 | Mockups first: a new design (borders, outlines, spacing, colors, layout, new shared components) needs a mockup Caleb approves before it's built. Consistency fixes that only make something match the existing shared design can be built without waiting for mockup approval; send screenshots for review. | none (review step) | none (review step) | #1342; Caleb, Nov 1 (#1438) |
| G3 | Everything that's the same kind of thing looks and works the same and is styled from one shared place (tokens, shared components), so one change updates it everywhere. Color variations are allowed only as named token variants, never as one-off styles. | planned (#1440) | planned (#1439) | Caleb, Nov 1 (#1438) |

## Calculations and live data

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| P1 | Every calculation that matters (prices, fees, discounts, deposits, balances, capacity, eligibility) is done on the server from one shared function. The browser only shows a preview from that same function; the server never trusts a total the browser sends, and if the browser's scripts fail or are blocked, the amount charged and recorded is still correct. | planned (#1445) | planned (#1445) | Caleb, Nov 1 (#1445) |
| P2 | Live lists (the club roster above all, plus registrations, attendee lists, orders and monthly records) always show current data from the server, update right away after a change, are never cached by the browser, Cloudflare or the app, and still work with blockers and translation on. | planned (#1445) | `npm run test:live-roster` (roster); `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | Caleb, Nov 1 (#1445) |

## Search

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| S1 | Search boxes must work without typing anything, everywhere. Clicking or focusing a search box, or searching with it empty, shows the full list (sorted and paged as usual). Typing only narrows it. | `tests/search-field-consistency-1347.test.ts`, `tests/empty-server-search-1348.test.ts` (partial: only some of the boxes those issues fixed); rest planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1342, #1347, #1348 |
| S2 | No minimum number of characters and no "type to search" empty state; "type more to narrow" caps are replaced with paging. | `tests/search-field-consistency-1347.test.ts`, `tests/empty-server-search-1348.test.ts` (partial); rest planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1342, #1347, #1348 |
| S3 | The Sterling Volunteers name lookup also follows the empty-search rule, keeping its existing permission checks and audit logging. | planned (#1440) | planned (#1439) | #1348 |
| S4 | Every search box should search as you type, across the board. Empty shows the full list, typing narrows it, and no Enter is needed. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1431 |
| S5 | While results update, focus is kept and results are announced; Enter and no-JavaScript still work. | planned (#1440) | planned (#1439) | #1431 |

## Setup help

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| H1 | No row on the System report may say only "not configured", "not set up" or "unavailable" without a next step: each shows a **Set up** link or a **How to set this up** panel. | planned (#1440) | planned (#1439) | #1434 |
| H2 | Never show secret values, only the setting **names**. | planned (#1440) | planned (#1439) | #1434 |
| H3 | Anywhere an event admin or club admin sees something that's not set up, missing, blocked or incomplete, it shows either a **Set up** link straight to the page where they fix it, or a **How to do this** panel with plain steps. It never just says "not set up" or leaves a dead end. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1435 |
| H4 | If only someone else can fix it (for example a system admin), it says who to ask. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1435 |
| H5 | Club directors and area coordinators each get a short "Getting started" checklist and Help guide written for that role, in plain language: short steps, no jargon. They're linked from the role's home screen, from each related "not set up" state, and from the Help search. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1435 |

## Behavior: lists and tables

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| B1 | Every list can be sorted by clicking a column header, and uses the same paging control and "Showing 1–25 of 140" line. Every staff and admin table is sortable except short fixed or set-order lists, which go on an allowlist. | planned (#1440) | planned (#1439) | #1433; Caleb, Nov 1 |
| B2 | Filters live in the web address (Back and shared links keep them), and every filtered list has a "Clear filters" button. | planned (#1440) | planned (#1439) | #1433 |
| B3 | On a phone, every table turns into cards the same way. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1433 |
| B4 | Every empty list says why it's empty and offers the next step. | planned (#1440) | planned (#1439) | #1433 |

## Behavior: forms and saving

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| B5 | Every form either saves automatically or has one clear Save button, with the same "Saved" confirmation either way. Forms keep one Save button; autosave only where it already exists; the same "Saved" message everywhere. | planned (#1440) | planned (#1439) | #1433; Caleb, Nov 1 |
| B6 | Leaving a page with unsaved changes always warns first. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1433 |
| B7 | Errors show the same way everywhere: a short summary at the top, and each problem next to its field. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1433 |
| B8 | Phone numbers, emails and dates are checked and formatted the same way in every form. | planned (#1440) | planned (#1439) | #1433 |

## Behavior: actions and messages

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| B9 | Every delete or cancel asks for confirmation in the same style, and offers Undo where possible. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1433 |
| B10 | Buttons show "Saving…" while working, and success and error messages appear in the same place. | planned (#1440) | planned (#1439) | #1433 |
| B11 | Every Download or Export button works the same, with the same file naming. | planned (#1440) | planned (#1439) | #1433 |

## Behavior: words and display

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| B12 | The same status words mean the same thing everywhere (Pending, Confirmed, Waitlisted, Cancelled, …). The status words are exactly Draft, Submitted, Pending payment, Pending approval, Confirmed, Waitlisted, Cancelled, Refunded. Club forms and links, club applications, team permissions, invites, general links, club transfers and merchandise orders use the same words (#1479). Three things keep their own words because they describe something other than a record's status: email delivery states (Queued, Processing, Captured, Sent, Failed, Suppressed) describe delivery of a message; the area coordinator roll-ups "Registered" and "Not registered" describe whether an area has registered; check-in states describe arrival at the event. Words outside the eight that stay: Expired, Used, Attached to a club, Declined (transfers), Completed. | `tests/status-words-1453.test.ts` (#1440 for the page check) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1433; Caleb, Nov 1 |
| B13 | Names and times display the same way everywhere, with times in Central and labeled. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1433 |
| B14 | "You don't have access" pages all say the same thing and explain who to ask. | planned (#1440) | planned (#1439) | #1433 |

## Sign-in

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| A1 | Two-step sign-in is required only for club and medical pages. A new director can see their own registrations without it. | `tests/sign-in-step-1410.test.ts` | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1410 |
| A2 | Accounts with club or staff roles (club directors, coordinators, instructors, staff) that haven't set up two-step sign-in get a one-time **email code** after the password (two steps), so never password alone. Parents and attendees who only register keep today's sign-in. | `tests/sign-in-step-1410.test.ts` | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1410 |
| A3 | Make two-step setup easy and say plainly why it's needed (it protects youth and medical records), at the moment it's needed. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1410 |
| A4 | List passkey first, marked "Easiest", ahead of the authenticator app. | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1410 |
| A5 | One name on the gate page: "two-step sign-in". | planned (#1440) | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1410 |

## Privacy browsers and the Security check

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| T3 | When the Security check cannot load or complete (a privacy browser, ad blocker or VPN blocks it), the person is never stuck. Sign-in, sign-up and password reset offer **"Email me a code instead"**: a one-time code to the address they typed (10 minutes, single use, five tries, rate limited, audit logged with ids only) that satisfies the check for that one request. Every other public form sends without a token, only through a much stricter rate limit (3 per hour per source, 2 per hour per address), and is flagged for staff in the audit log, never shown to the person. | `tests/security-check-fallback-1480.test.ts`, `tests/security-check-fallback-limits-1480.test.ts`, `tests/security-check-fallback-ui-1480.test.ts`, `tests/turnstile-gated-routes-1399.test.ts` | planned (#1439) | Caleb, Nov 1 (#1480) |
| T4 | Next to the blocked-check message the office contact is shown (the footer help contact setting, default support@imsda.org and (515) 223-1197), with `translate="no"` on the email and phone. | `tests/security-check-fallback-ui-1480.test.ts` | planned (#1439) | Caleb, Nov 1 (#1480) |
| T5 | A token that is present but invalid is never bypassed: the fallback applies only when the check could not produce a token. The emailed-code answer never says whether an account exists (same status and words either way). | `tests/security-check-fallback-1480.test.ts` | planned (#1439) | Caleb, Nov 1 (#1480) |

## Look

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| L1 | One search field look: the `.search-field` wrapper draws the border with a 10px radius; the input inside draws nothing. Native clear "x" is hidden; clear buttons are 44px. | `tests/search-field-consistency-1347.test.ts` | planned (#1439) | #1342, #1347 |
| L2 | No focus glow (halo). Every field and search box shows one purple ring only (2px at 2px offset), gold on navy. | `tests/field-focus-ring-1349.test.ts` | mobile layout audit (focus rings); planned (#1439) | #1342, #1347, #1349 |
| L3 | A field with an error that has focus keeps the red border **and** gets the purple ring. | `tests/field-focus-ring-1349.test.ts` | planned (#1439) | #1349 |
| L4 | Status chips and badges use the shared `.status-chip` and `.count-badge`, colored from tokens. "Missing" and "Late" are coral; "To review" is purple; filter counts use the navy count badge. | `tests/status-chips-1351.test.ts` | planned (#1439) | #1351 |
| L5 | Buttons use the shared button classes. Main and light buttons have hover looks; disabled buttons use the "not allowed" cursor; check-in station buttons stay at 48px; the club finder list stays a pick-one row in app colors. | planned (#1440) | planned (#1439) | #1352 |
| L6 | Tabs use the one shared tabs component, with keyboard support. | `tests/tabs-shared-1353.test.ts` | planned (#1439) | #1353 |
| L7 | Dialogs use the shared `useAccessibleDialog` hook (focus trap, Escape, return focus). | `tests/dialogs-shared-hook-1354.test.ts` | `npm run test:club-journeys` (club director and area coordinator pages; other roles planned (#1439)) | #1354 |
| L8 | Identical radius and color values use the shared tokens in `app/globals.css`. Values that differ wait for a later mockup issue. | planned (#1440) | none (code rule) | #1350 |

## Page checks (AGENTS.md → Checks)

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| C1 | Staff headings and labels are at least 14px; use `max(var(--type-staff-floor, 0px), 0.875rem)`. An unstyled or undersized h1 or h2 is flagged. | partial: `tests/staff-ui-foundations-981.test.ts` (14px floor in CSS); rest planned (#1440) | mobile layout audit (flags undersized headings and labels) | AGENTS.md |
| C2 | Tap targets are at least 44px. | planned (#1440) | mobile layout audit | AGENTS.md |
| C3 | Hidden text uses the global `sr-only` class; visually hidden classes in CSS modules are flagged. | planned (#1440) | mobile layout audit | AGENTS.md |
| C4 | A fixed bar containing a `<button>` counts as an action bar and must not cover text. Use a link trigger when that isn't intended. | planned (#1440) | mobile layout audit | AGENTS.md |
| C5 | New feature styles go in a CSS module next to the component; new CSS in `app/globals.css` goes before the `/* Registration form builder editor shell (#1132)` marker, and no `:hover` rule after the `/* Form settings tab` (#1139) marker. | planned (#1440) | none (code rule) | AGENTS.md |
| C6 | `.field-help` has a negative top margin, so new layouts override it (for example `margin: 4px 0 0`). | planned (#1440) | mobile layout audit (text overlap) | AGENTS.md |
