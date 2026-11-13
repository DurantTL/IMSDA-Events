# Site map (#1558)

Every page in the system, who can open it, and where it is in the menus. Staff workspace pages are in the generated
[staff workspace route matrix](STAFF-WORKSPACE-ROUTES.md); every other page is in a table below.

`tests/site-map-1558.test.ts` fails when a page (`page.tsx` under `app/`) has no row here or in the staff matrix, when a
page has two rows, or when a row names a page that no longer exists. When you add a page:

- a staff workspace page (`app/(workspace)/...`, `/archived-events`, `/select-event`, `/check-in-station`): rerun
  `npx tsx docs/generate-staff-workspace-map.ts`;
- any other page: add a row to the matching table below.

This is documentation only. A menu entry is never permission: every page keeps its own server-side check, and a menu
shows only the items the viewer may open. How menus and back links work is in [NAVIGATION.md](NAVIGATION.md);
`tests/page-reachability-1731.test.ts` proves every staff and portal page can be reached from a menu or a parent page.

Columns: **Route** is the address, with `[name]` for a part that changes. **Who** is who the page is for. **In the
menus** is the menu item, or the page or message that links to it. "Old address" pages only send people on to the
page that replaced them.

## Menus at a glance

| Area | Menu | Items | Source |
| --- | --- | --- | --- |
| Public site | Header | Home, Events, Calendar, Club ministry; then Sign in, or My account / Staff workspace for a signed-in person. Staff can add header and footer links on the site content page. | `components/public-explore-nav.tsx`, `components/public-header-links.tsx` |
| Your account | Account tabs | Overview, My registrations, Profile, My club / My clubs, Club coordination, Leader directory, Help | `components/account-portal-nav.ts` |
| Club portal | Club tabs (a menu line on narrow screens, a phone bar with More) | Home, Roster, Forms, Club events, Honors, Class tracking, Monthly Records, Orders, Health, Club settings | `modules/club-rosters/portal-nav.ts` |
| Club coordination (Area Coordinator) | Coordinator tabs | Overview, Clubs, Monthly Records, Points, Club events, Team approvals, New clubs, Waitlists; TLT directory for the TLT director; Master Guide approvals when a club uses it | `components/area-clubs-subnav.tsx` |
| A club an Area Coordinator is viewing | Club tabs (view only) | Home, Roster, Honors, Events, Club forms, Monthly Records, Earned awards | `modules/club-rosters/portal-nav.ts` (`areaViewedClubNavItems`) |
| Staff workspace | Rail, area tabs, event tabs | See the [staff workspace route matrix](STAFF-WORKSPACE-ROUTES.md) | `components/staff-areas.ts`, `components/staff-event-tabs.ts` |

## Public site

| Route | Who | In the menus | What it is for |
| --- | --- | --- | --- |
| `/` | Anyone | Header: Home | The public front page |
| `/events` | Anyone | Header: Events | Events open for registration |
| `/events/[eventSlug]` | Anyone (published events) | An event card on Events | An event's public page |
| `/events/[eventSlug]/forms/[slug]` | Anyone (public events) | A link the conference shares, or an embed | An event information form |
| `/calendar` | Anyone | Header: Calendar | The conference calendar |
| `/clubs` | Anyone | Header: Club ministry | The club ministry page |
| `/clubs/forms` | Anyone | Club forms on Club ministry | Public list of club forms |
| `/clubs/forms/apply/[templateKey]` | Anyone | A form on the club forms list | An open club application |
| `/clubs/register` | Anyone | Register a new club on the club forms list | Apply to start a new club |
| `/clubs/register/[token]` | The person the invitation was emailed to | Link in an invitation email | New club application from an invitation |
| `/club-forms/[token]` | The person given the private link | Private link from the club | Fill in a club form |
| `/health-records/[token]` | The person given the private link, when health records are on | Private link from the club | Fill in a Health Record |
| `/forms/[slug]` | Anyone | A link the conference shares, or an embed | A general information form |
| `/register/[eventSlug]` | Anyone | Event address; goes to the event page when it has one | Registration entry for an event |
| `/register/[eventSlug]/[formSlug]` | Anyone, while registration is open | The register button on the event page | An event registration form |
| `/register/[eventSlug]/general` | Anyone, while registration is open | The event's general registration link | General registration link (`docs/GENERAL-REGISTRATION-LINK.md`) |
| `/register/[eventSlug]/group` | Anyone, while registration is open | The event's group registration link | Register a group |
| `/event-preview/[token]` | The person given the private link, until it expires or is turned off | Preview link made on the event page editor | Preview of an event page with its unpublished changes |
| `/manage/[token]` | The person given the registration's private link | Link in registration emails | Manage one registration |
| `/recover-registration` | Anyone | "Find a registration made with another email" | Find a registration or get its link again |
| `/pay/square/return/[returnId]` | The person who just paid | Square sends people back here after checkout | Payment status after card checkout |
| `/staff-invite/[token]` | The person the invitation was emailed to | Link in a staff invitation email | Accept a staff invitation |
| `/unsubscribe/[token]` | The person the email was sent to | Link in an event announcement email | Event email preferences |
| `/embed/[eventSlug]/[formSlug]` | Anyone | Embedded on another website | An embedded registration form |
| `/embed/calendar` | Anyone | Embedded on another website (`docs/CALENDAR-WIDGET.md`) | Embedded upcoming events |

## Sign-in and account access

| Route | Who | In the menus | What it is for |
| --- | --- | --- | --- |
| `/sign-in` | Anyone signed out | Header: Sign in (when the single sign-in is on) | One sign-in for staff and attendees |
| `/login` | Staff, signed out | Staff sign in; `/sign-in` is used instead when the single sign-in is on | Staff sign-in |
| `/forgot-password` | Staff | The password reset link on staff sign-in | Ask for a staff password reset |
| `/reset-password` | The person the email was sent to | Link in a password reset or account activation email | Choose a password |
| `/no-access` | A signed-in person with no event to open | Sent here after sign-in | Explains that no event is assigned yet |
| `/profile` | Staff | Staff account menu: Profile | Edit profile (staff and, when signed in, attendee) |
| `/profile/sign-in` | Anyone signed out | Sent here from `/profile` | Choose how to sign in to edit a profile |
| `/account/sign-in` | Attendees, signed out | Header: Sign in (when the single sign-in is off) | Attendee sign-in |
| `/account/sign-in/code` | Attendees during sign-in | A step of attendee sign-in | Sign in with an emailed code |
| `/account/sign-up` | Anyone signed out | Account link on registration forms | Create an attendee account |
| `/account/forgot-password` | Attendees, signed out | "Forgot password?" on attendee sign-in | Ask for an attendee password reset |
| `/account/two-step` | Attendees during sign-in | A step of attendee sign-in | Second sign-in step |
| `/account/two-step/recover` | Attendees during sign-in | A link on the second sign-in step | Recover a lost second step with an emailed code |
| `/account/verify-email` | The person the email was sent to | Link in an email | Confirm a changed email address |
| `/account/help/authenticator` | Anyone | "Which app should I use?" in two-step settings | Authenticator app help |

## Your account (attendees)

Every page below needs a signed-in account; each page checks again for its own audience.

| Route | Who | In the menus | What it is for |
| --- | --- | --- | --- |
| `/account` | Signed-in attendee | Account tabs: Overview | Account home: upcoming events and other roles |
| `/account/registrations` | Signed-in attendee | Account tabs: My registrations | The account's own registrations |
| `/account/profile` | Signed-in attendee | Account tabs: Profile | Profile, two-step and passkey settings |
| `/account/security` | Signed-in attendee | Old address; goes to Profile | - |
| `/account/events/[eventSlug]` | Signed-in attendee registered for the event; staff can preview | An upcoming event on Overview, account banners; staff preview links | The attendee's event page |
| `/account/help` | Any signed-in account | Account tabs: Help | Portal help guides for the person's roles |
| `/account/help/[guideId]` | Any signed-in account the guide is for | A guide on Help | One help guide |
| `/account/leader-directory` | Club directors, deputies and Area Coordinators, when the conference turns it on | Account tabs: Leader directory | Club leaders across the conference (`docs/LEADER-DIRECTORY.md`) |
| `/account/instructor` | Honors instructors | "Your other roles" on Overview | The instructor's classes (`docs/HONORS-INSTRUCTORS.md`) |
| `/account/instructor/[offeringId]` | The class's instructor | A class on the instructor's list | One class roster |
| `/account/visiting-club/[token]` | The account the private link was emailed to | Link in a visiting club email | Bring a visiting club (`docs/VISITING-CLUBS.md`) |

## Club portal (club directors and club leaders)

Each club page is for that club's leaders. Some tabs are for certain club roles only: the club tabs show only what the
person's role allows. Print views open from the page named and have no tab of their own.

| Route | Who | In the menus | What it is for |
| --- | --- | --- | --- |
| `/account/clubs` | Club directors; staff acting as a director | Account tabs: My club / My clubs | The person's clubs; one club goes straight to it |
| `/account/clubs/choose` | Club directors | The club forms list, to pick a club | Choose which club a task is for |
| `/account/club-registration/[eventSlug]` | Club leaders who register for events | The club button on an event's public page | Register a club for an event |
| `/account/clubs/[organizationId]` | The club's leaders | Club tabs: Home | Club home: setup steps and section cards |
| `/account/clubs/[organizationId]/roster` | Director, deputy, registrar | Club tabs: Roster | The club roster |
| `/account/clubs/[organizationId]/roster/export` | Director, deputy, registrar | "Build a roster export" on Roster | Roster export |
| `/account/clubs/[organizationId]/roster/next-year` | Director, deputy | Club home and Roster | Start next year's roster |
| `/account/clubs/[organizationId]/roster/[memberId]/health` | Director, deputy, when health records are on | A member's Health tab on Roster | One member's Health Record |
| `/account/clubs/[organizationId]/roster-health` | Director, deputy, when turned on | Club home card; button on Roster | Roster health list |
| `/account/clubs/[organizationId]/staff-training` | Director, deputy, when turned on | Roster; Club settings | Staff certifications and workshops |
| `/account/clubs/[organizationId]/honors` | Director, deputy, registrar | Club tabs: Honors | Members' honors |
| `/account/clubs/[organizationId]/exports/honors` | Director, deputy, registrar | Print on Honors | Printable honors report |
| `/account/clubs/[organizationId]/class-tracking` | Director, deputy, registrar | Club tabs: Class tracking | Earned awards and class completions |
| `/account/clubs/[organizationId]/class-tracking/[personId]` | Director, deputy, registrar | A member on Class tracking | One member's class history |
| `/account/clubs/[organizationId]/exports/class-tracking` | Director, deputy, registrar | Print on Class tracking | Printable class tracking report |
| `/account/clubs/[organizationId]/events` | The club's leaders | Club tabs: Club events | The club's events |
| `/account/clubs/[organizationId]/events/[eventId]` | The club's leaders | An event on Club events | One event: registration, team list, actions |
| `/account/clubs/[organizationId]/events/[eventId]/packet` | The club's leaders | The event's page | Club packet for the event |
| `/account/clubs/[organizationId]/events/[eventId]/schedule` | The club's leaders | The event's page (print view) | Printable class schedule |
| `/account/clubs/[organizationId]/events/[eventId]/team-form` | The club's leaders | The event's page | The club's team form |
| `/account/clubs/[organizationId]/events/[eventId]/team-form/blank` | The club's leaders | The event's page (print view) | Blank team form |
| `/account/clubs/[organizationId]/forms` | Director, deputy | Club tabs: Forms | Club forms, filled forms and private links |
| `/account/clubs/[organizationId]/forms/[templateKey]/new` | Director, deputy | "Start a form" on Forms | Fill in a club form |
| `/account/clubs/[organizationId]/forms/submissions/[submissionId]` | Director, deputy | A filled form on Forms | One filled form |
| `/account/clubs/[organizationId]/forms/submissions/[submissionId]/roster` | Director, deputy | "Add to roster" on a filled form | Add a roster member from a form |
| `/account/clubs/[organizationId]/forms/outings/new` | Director, deputy | "New outing" on Forms | New outing permission slip |
| `/account/clubs/[organizationId]/forms/outings/[outingId]` | Director, deputy | An outing on Forms | One outing and its signatures |
| `/account/clubs/[organizationId]/forms/outings/[outingId]/print` | Director, deputy | Print on the outing (print view) | Outing binder page |
| `/account/clubs/[organizationId]/health` | Director, deputy | Club tabs: Health | The club's event health information |
| `/account/clubs/[organizationId]/records` | Director, deputy, reporter | Club tabs: Monthly Records | Monthly Records |
| `/account/clubs/[organizationId]/reports/year-end/[year]` | Director, deputy, reporter | Monthly Records | Year-End Report |
| `/account/clubs/[organizationId]/orders` | Director, deputy, registrar | Club tabs: Orders | Orders and supplies on hand |
| `/account/clubs/[organizationId]/orders/print` | Director, deputy, registrar | Print on Orders (print view) | Printable order list |
| `/account/clubs/[organizationId]/club-info` | Director, deputy | Club tabs: Club settings | Club profile, club admins and optional features |
| `/account/clubs/[organizationId]/letters` | Director, deputy, when turned on | "Open letters" in Club settings | Letters and certificates |
| `/account/clubs/[organizationId]/letters/[templateId]/print` | Director, deputy, when turned on | "Open print view" on Letters | Printable letters |
| `/account/clubs/[organizationId]/certificates` | Director, deputy, when turned on | "Open certificates" in Club settings | Class and honor certificates |
| `/account/clubs/[organizationId]/certificates/print` | Director, deputy, when turned on | "Print certificates" on Certificates | Printable certificates |
| `/account/clubs/[organizationId]/master-guide` | Director, deputy, when turned on | "Open Master Guide tracking" in Club settings | Master Guide candidates and approvals |
| `/account/clubs/[organizationId]/awards` | - | Old address; goes to Class tracking | - |
| `/account/clubs/[organizationId]/exports` | - | Old address; goes to Honors | - |
| `/account/clubs/[organizationId]/notes` | - | Old address; goes to Monthly Records | - |
| `/account/clubs/[organizationId]/profile` | - | Old address; goes to Club settings | - |
| `/account/clubs/[organizationId]/reports` | - | Old address; goes to Monthly Records | - |
| `/account/clubs/[organizationId]/reports/[month]` | - | Old address; goes to that month in Monthly Records | - |
| `/account/clubs/[organizationId]/supplies` | - | Old address; goes to Orders | - |
| `/account/clubs/[organizationId]/team` | - | Old address; goes to Club settings | - |

## Club coordination (Area Coordinators)

For Area Coordinators, and staff acting as one, for the clubs in their ministries. Pages marked TLT are for the TLT
director. The club pages under `/account/area/[organizationId]` are view only.

| Route | Who | In the menus | What it is for |
| --- | --- | --- | --- |
| `/account/area-clubs` | Area Coordinators | Old address; goes to Overview | - |
| `/account/area-clubs/overview` | Area Coordinators | Account tabs: Club coordination; coordinator tabs: Overview | Clubs at a glance |
| `/account/area-clubs/clubs` | Area Coordinators | Coordinator tabs: Clubs | Club list and search |
| `/account/area-clubs/reports` | Area Coordinators | Coordinator tabs: Monthly Records | Monthly Record status by club and month |
| `/account/area-clubs/reports/export` | Area Coordinators | "More export options" on Monthly Records and Points | Monthly Record exports |
| `/account/area-clubs/points` | Area Coordinators | Coordinator tabs: Points | Club points |
| `/account/area-clubs/roster-export` | Area Coordinators | "Export rosters" on Overview, Clubs and club pages | Roster export |
| `/account/area-clubs/events` | Area Coordinators | Coordinator tabs: Club events | Club events, with a button row per event |
| `/account/area-clubs/events/[eventId]` | Area Coordinators | Club events: Club teachers | Club teachers for an event |
| `/account/area-clubs/events/[eventId]/scoring` | Area Coordinators | Club events: Camporee scoring | Camporee scoring |
| `/account/area-clubs/events/[eventId]/inspections` | Area Coordinators | Club events: Inspections | Inspections |
| `/account/area-clubs/events/[eventId]/attendance-points` | Area Coordinators | Club events: Attendance points | Attendance points |
| `/account/area-clubs/events/[eventId]/debrief` | Area Coordinators | Club events: Event debrief | Event debrief |
| `/account/area-clubs/events/[eventId]/budget` | Area Coordinators | Club events: Budget sheet | Event budget sheet |
| `/account/area-clubs/events/[eventId]/staffing` | Area Coordinators | Club events: Event staffing | Event staffing |
| `/account/area-clubs/events/[eventId]/report` | Area Coordinators | A button on Club events | Attendee report for an event |
| `/account/area-clubs/kitchen/[eventId]` | Area Coordinators | Club events: Kitchen report | Kitchen counts for an event (`docs/MEALS.md`) |
| `/account/area-clubs/team-permissions` | Area Coordinators | Coordinator tabs: Team approvals | Team approval rules |
| `/account/area-clubs/applications` | Area Coordinators (and conference club staff) | Coordinator tabs: New clubs | New club applications, view only |
| `/account/waitlists` | Area Coordinators | Coordinator tabs: Waitlists | Clubs waitlisted per location (`docs/LOCATION-WAITLISTS.md`) |
| `/account/area-clubs/master-guide` | Area Coordinators | Coordinator tabs: Master Guide approvals | Master Guide approvals |
| `/account/area-clubs/tlt` | TLT director | Coordinator tabs: TLT directory | TLT directory |
| `/account/area-clubs/tlt/forms` | TLT director | "TLT forms" on TLT directory | TLT forms inbox |
| `/account/area-clubs/tlt/forms/[submissionId]` | TLT director | "Open" on a TLT form | One TLT form |
| `/account/area-clubs/tlt/lists` | TLT director | "Position types and tags" on TLT directory | Position types and help-area tags |
| `/account/area-clubs/tlt/move-up` | TLT director | "Year move-up" on TLT directory | Club-year move-up |
| `/account/area-clubs/tlt/staffing` | TLT director | "TLT staffing" on TLT directory | TLT staffing by event |
| `/account/area-clubs/tlt/staffing/[eventId]` | TLT director | "Assign TLTs" on TLT staffing | Assign TLTs to an event |
| `/account/area/health` | Area Coordinators | "Event health information" card on Overview | Event health sheets, view only |
| `/account/area-clubs/health/[eventId]/[organizationId]/[memberId]` | Area Coordinators | An attendee on an event health sheet | One attendee's Health Record, view only |
| `/account/area/[organizationId]` | Area Coordinators | A club name on Clubs, Monthly Records, Points or Overview; viewed club tabs: Home | A club's home, view only |
| `/account/area/[organizationId]/honors` | Area Coordinators | Viewed club tabs: Honors | The club's honors |
| `/account/area/[organizationId]/forms` | Area Coordinators | Viewed club tabs: Club forms | The club's forms |
| `/account/area/[organizationId]/forms/[submissionId]` | Area Coordinators | "View" on Club forms | One club form |
| `/account/area/[organizationId]/reports/[month]` | Area Coordinators | A cell on Monthly Records | One club's Monthly Record |
| `/account/area/[organizationId]/awards` | Area Coordinators | Viewed club tabs: Earned awards | The club's earned awards |
| `/account/area/[organizationId]/orders` | No one (not found) | None; club orders are not an Area Coordinator's (#918) | - |
| `/account/area/[organizationId]/supplies` | No one (not found) | None; club supplies are not an Area Coordinator's (#918) | - |

## Staff workspace

Staff pages, including `/archived-events`, `/select-event` (where staff pick an event after sign-in) and
`/check-in-station` (the check-in station screen), are listed with their rail area, tab, view and phone menu in the
[staff workspace route matrix](STAFF-WORKSPACE-ROUTES.md). It is generated from the menu registries, so it changes when
the menus do; rerun `npx tsx docs/generate-staff-workspace-map.ts` after adding or moving a staff page.
