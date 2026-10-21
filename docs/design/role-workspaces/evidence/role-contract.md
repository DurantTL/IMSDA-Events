# Role-accurate workspace contract

Prepared for the replacement four-role design examples, 20 October 2026 (America/Chicago). Source baseline: `8eb81d7d510b5225c9d70d5cd3ecf1f721515484`, with prior status refresh through `72a6cb21`. This is a source-boundary check, not a production deployment check or permission change.

## Shared visual language, separate jobs

Use the same IMSDA identity, typography, accessible controls, meaningful status vocabulary and form/error patterns. Give each persona its own information hierarchy, navigation and record scope. The attendee's own account and the club/coordinator portals currently live in the public/account shell; the system administrator uses the staff/system shell. A new example should make that difference visible rather than put every role into an administrator dashboard.

The gallery can link four examples **outside** the product mockup. Do not place a global role picker, admin sidebar or review-sample navigation inside every persona's application. A real context switch only offers workspaces the signed-in person already has authority to enter.

## 1. Attendee — personal registration portal

**Example identity:** an ordinary attendee account, with no club, coordinator or staff grant.

**Current destinations:** `/account` (Overview), `/account/registrations` (My registrations), `/account/profile` (Profile; security is reached through account/profile controls), and `/account/events/[eventSlug]` for an accessible event hub. Current header actions own sign-out and genuinely authorized other workspaces. A plain attendee gets no Clubs or Waitlists tab merely because other personas have them.

**What the screen can show:** only registrations matched to this authenticated account's verified email and the existing access rules; their event, confirmation code, included attendee names, registration status, payment/billing meaning, permitted next action and support. It can show a multi-person registration without inventing a permanent household or granting guardians authority over every related person.

**Permitted task links:** open an own registration/event hub, continue permitted payment, edit permitted contact/answers and request cancellation through the existing service when available. A request is distinct from staff approval/refund issuance. Past/cancelled/waitlisted records need their actual status and payment meaning.

**Proposed visual treatment:** a welcoming personal portal, compact top navigation, readable event cards, one clear next action and a phone-first layout. No system-wide metrics, staff queues, all-event picker, directory search, refund controls or role administration.

**Billing example:** a synthetic **direct-billing Family Retreat**, with only the contact's own registration. Waitlisted/cancelled amounts must not appear as currently payable; the example demonstrates the correction tracked in #1100 rather than claiming it is deployed.

Sources: [account shell](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/layout.tsx), [own registration cards/actions](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/registrations/page.tsx), [verified-email matching](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/attendee-accounts/registrations-repository.ts#L67), [existing payment status meaning](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/public-access/domain.ts#L161).

## 2. Director — one club and its working year

**Example identity:** active `DIRECTOR` for a synthetic Pathfinder club. A deputy has the same capability set. A registrar/reporter must not be represented as equivalent to the director.

**Current destinations for the director:** club Home, Roster, Honors, Class tracking, Club events, Forms, Health, Monthly Records, Orders and Club settings. Each is capability-gated. Team/profile work is grouped into Club settings. Supplies live inside Orders. The director's full club navigation is not a reason to expose system-wide settings.

**Current role distinctions:** the registrar maintains the roster and registers the club, sees ages rather than full birth dates, and lacks guardian/team/profile/report authority. The reporter has Home/Monthly Records rather than roster/event access. Directors/deputies can manage the club's registrar/reporter grants; conference staff control the other grant authorities.

**What the screen can show:** the selected club, sponsoring church, director role and club year; next task/deadline; roster counts and own members; own event registration/draft states; permitted reports/forms/honors. The current home already places the next task before statistics. Preserve this as an existing strength.

**Proposed visual treatment:** a focused club portal with persistent club/year identity and club-specific task navigation. A roster view can include name search, a selected-year control and dirty-edit protection as proposed refinements; these should not be presented as already implemented everywhere. Avoid a large platform dashboard, global health, all-events finances or unrelated staff tools.

**Billing example:** Pathfinder **Spring Camporee billed to the sponsoring church**. The director can review the club's people and registration, but this example must not offer an attendee-style online Pay balance action. Annual club records, new-club application, club forms and event registration are distinct workflows; do not call every enabled form required or turn their counts into readiness certification.

Sources: [club capabilities](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/organizations/director-grants-domain.ts), [club navigation](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/club-rosters/portal-nav.ts#L11), [club shell](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/layout.tsx), [current task-first home](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/page.tsx).

## 3. Area Coordinator — oversight, with narrow exceptions

**Example identity:** the coordinator's own account with an active coordinator grant and completed second sign-in step. Staff act-as is a distinct temporary mechanism and must not inherit decision authority from a simulated coordinator account.

**Current overview destinations:** All clubs, Overview, Monthly Records, Points, Club events, Team approvals and New clubs. Account Waitlists is present only for the current coordinator account and its applicable event/location scope.

**Important scope distinction:** current source queries every active `CLUB`; there is no ministry/area filter in `listClubsForArea` or `getAreaClubsSummary`. The later #840 October 8 direction says coordinators see their **whole ministry for now** when ministry expansion is implemented. An accurate sample can use Pathfinder examples, but should label the scope “All active clubs available to this role” and avoid pretending a ministry/area selector or restricted-area enforcement already exists. No Adventurer rollout is established by this example.

**Overview data:** club/director names, selected year, roster/report/points/event status and screening **counts**. The summary is an oversight view, not a person-level medical or screening dashboard. Label exports as full-year when they ignore a visible name search.

**One-club view:** view-only roster (ages, not dates), Honors, Events, Club forms, Monthly Records and Earned awards. No club Orders, Class tracking, Club settings or director editing controls. Authorized individual-club access already has its own screening-note and guardian-contact rules; omitting those details from the sample does not claim coordinators never have legitimate access.

**Specific decision exception:** Team approvals lets a real coordinator approve/decline qualifying team requests at the coordinator's own event locations, using that event's team/age rules. A staff act-as view cannot decide there. New club applications are **view-only** to coordinators; system administrators approve/decline. Monthly Records/report status is not a generic approval queue.

**Proposed visual treatment:** a coordination workspace showing clubs, report follow-up and permitted review tasks, with table/filter/report context. This can have a denser oversight layout than the attendee portal without adopting platform administration. Safe primary actions are Open club, View record and Open Team approvals; no generic Approve all, bulk send, refund or role-management controls.

Sources: [coordinator grants and current all-club query](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/organizations/area-coordinators.ts), [overview navigation](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/components/area-clubs-subnav.tsx), [summary query](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/club-reports/area-summary-repository.ts#L17), [one-club navigation](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/modules/club-rosters/portal-nav.ts#L46), [specific Team approvals](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/area-clubs/team-permissions/page.tsx), [new applications view-only](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/app/%28public%29/account/%28portal%29/area-clubs/applications/page.tsx), [ministry direction](https://github.com/DurantTL/IMSDA-Events/issues/840#issuecomment-6069919551).

## 4. System administrator — platform workbench

**Example identity:** a staff account with `globalRole === SYSTEM_ADMIN`. This is not a default attendee permission and not automatically granted by directing/coordinating clubs.

**Current system domains:** Events (create/copy/calendar/templates/archive); Clubs (directory/reports/summary/applications/transfers); People (Team/Accounts); Catalogs and settings (club forms, supplies/honors/award rules, central Email, Platform settings, System readiness). The system navigation registry is the source for visible destinations, while each page/API still authorizes independently.

**Proposed visual treatment:** the fullest workbench of the four: grouped persistent navigation, cross-event review queues, measured system/email health, global setup and access. Keep System / All events context explicit and link deliberately into a selected event. A cross-event summary must not imply every financial or protected-data action is available through a generic bulk endpoint.

Sources: [system navigation registry](https://github.com/DurantTL/IMSDA-Events/blob/8eb81d7d510b5225c9d70d5cd3ecf1f721515484/components/system-navigation.ts), [existing admin design epic](https://github.com/DurantTL/IMSDA-Events/issues/1073).

## Sample accuracy checklist

- Four distinct persona identities and workspaces; the gallery's comparison navigation stays outside the product screens.
- Attendee gets personal registration cards, not organization/platform metrics.
- Director sees one club/year and its own work, with Camporee church billing accurately explained.
- Coordinator sees available clubs and view-only report/club detail; only the specific existing Team approvals workflow can decide.
- Current all-club access and planned ministry scope are labelled separately; no fictional area filter or rollout claim.
- Admin alone gets platform setup/access/system controls. Other workspace links require actual authority.
- Proposed layout improvements are labelled as design proposals; synthetic counters are not operational evidence.
- All mockups preserve existing permission, money, screening, protected-data and publication contracts.

No production code, permissions, issues or configuration were changed by this boundary review.
