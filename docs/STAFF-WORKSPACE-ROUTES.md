# Staff workspace route matrix (#1565)

Generated with `npx tsx docs/generate-staff-workspace-map.ts`. This is the staff-only subset for #1558, not a second runtime registry or a decision to build a whole-system site-map page.

The staff shell is a branded header, an icon rail of the areas a person can reach (Home, Events, Clubs, People, Reports, Admin), and below it that area's one row of tabs, or inside an event the event's tabs (Event home, Registrations, Check-in, Communications, Money, Reports, Event setup). Views inside a tab are a button strip. Below 1024px, or when a row would not fit, a row is a menu line ("<Area> menu" or "Event menu"). There is no sidebar. Each page belongs to exactly one place for the "where you are" marking; a page that two tabs list is the same page, and the area named here owns the marking.

A role's tab row lists only the pages that role may open; every route keeps its server guard, and menu and search visibility keep their existing role, grant and module predicates. Record pages open through their existing parent links. Help and Profile light Home on the rail and no tab. No URL changes: aliases and redirects stay as they were.

| Route | Previously reached from | Rail area | Tab | View | Phone | Menu line | Note | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin` | System management | Admin | System administration | - | More, Areas | Admin menu | - | `app/(workspace)/admin/page.tsx` |
| `/admin/accounts` | System management | People | People & access | - | More, Areas | People menu | - | `app/(workspace)/admin/accounts/page.tsx` |
| `/admin/analytics` | System management | Reports | Public analytics | - | More, Areas | Reports menu | - | `app/(workspace)/admin/analytics/page.tsx` |
| `/admin/background-checks` | System management | Clubs | Club administration | Sterling Volunteers | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/background-checks/page.tsx` |
| `/admin/calendar` | System management | Events | Conference calendar | - | bar: Events | Events menu | - | `app/(workspace)/admin/calendar/page.tsx` |
| `/admin/club-forms` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/club-forms/page.tsx` |
| `/admin/club-forms/[templateKey]` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/club-forms/[templateKey]/page.tsx` |
| `/admin/club-forms/public-page` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/club-forms/public-page/page.tsx` |
| `/admin/club-forms/public-page/preview` | Page link | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/club-forms/public-page/preview/page.tsx` |
| `/admin/club-supplies` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/club-supplies/page.tsx` |
| `/admin/clubs` | Page link | Clubs | Club administration | Overview | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/page.tsx` |
| `/admin/clubs/applications` | System management | Clubs | New club applications | Applications | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/applications/page.tsx` |
| `/admin/clubs/health-import` | Page link | Clubs | Club administration | Import health records | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/health-import/page.tsx` |
| `/admin/clubs/import` | Page link | Clubs | Club administration | Import clubs | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/import/page.tsx` |
| `/admin/clubs/invites` | System management | Clubs | New club applications | Club invites | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/invites/page.tsx` |
| `/admin/clubs/leaders` | System management | Clubs | Club leaders | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/leaders/page.tsx` |
| `/admin/clubs/reports` | System management | Clubs | Monthly Records | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/reports/page.tsx` |
| `/admin/clubs/reports/[organizationId]/[month]` | System management | Clubs | Monthly Records | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/reports/[organizationId]/[month]/page.tsx` |
| `/admin/clubs/reports/year-end` | Page link | Reports | Club Year-End Reports | - | More, Areas | Reports menu | - | `app/(workspace)/admin/clubs/reports/year-end/page.tsx` |
| `/admin/clubs/summary` | System management | Clubs | Club summary | All clubs | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/summary/page.tsx` |
| `/admin/clubs/transfers` | System management | Clubs | Club member transfers | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/clubs/transfers/page.tsx` |
| `/admin/email` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/email/page.tsx` |
| `/admin/event-templates` | System management | Events | Event templates | - | bar: Events | Events menu | - | `app/(workspace)/admin/event-templates/page.tsx` |
| `/admin/event-templates/[templateId]` | System management | Events | Event templates | - | bar: Events | Events menu | - | `app/(workspace)/admin/event-templates/[templateId]/page.tsx` |
| `/admin/event-templates/from-event` | Page link | Events | Event templates | - | bar: Events | Events menu | - | `app/(workspace)/admin/event-templates/from-event/page.tsx` |
| `/admin/feature-requests` | System management | Admin | Events | - | More, Areas | Admin menu | - | `app/(workspace)/admin/feature-requests/page.tsx` |
| `/admin/form-templates` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/form-templates/page.tsx` |
| `/admin/form-templates/[templateKey]` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/form-templates/[templateKey]/page.tsx` |
| `/admin/forms` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/forms/page.tsx` |
| `/admin/health-access` | System management | People | Break-glass and legal holds | - | More, Areas | People menu | - | `app/(workspace)/admin/health-access/page.tsx` |
| `/admin/honors` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/honors/page.tsx` |
| `/admin/hubs/catalogs` | Page link | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/hubs/catalogs/page.tsx` |
| `/admin/hubs/clubs` | Page link | Admin | Clubs | - | More, Areas | Admin menu | - | `app/(workspace)/admin/hubs/clubs/page.tsx` |
| `/admin/hubs/events` | Page link | Admin | Events | - | More, Areas | Admin menu | - | `app/(workspace)/admin/hubs/events/page.tsx` |
| `/admin/hubs/forms` | Page link | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/hubs/forms/page.tsx` |
| `/admin/hubs/people` | Page link | Admin | People | - | More, Areas | Admin menu | - | `app/(workspace)/admin/hubs/people/page.tsx` |
| `/admin/information-forms` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/information-forms/page.tsx` |
| `/admin/information-forms/[formId]` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/information-forms/[formId]/page.tsx` |
| `/admin/information-forms/[formId]/responses` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/information-forms/[formId]/responses/page.tsx` |
| `/admin/master-award-rules` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/master-award-rules/page.tsx` |
| `/admin/notifications` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/notifications/page.tsx` |
| `/admin/organizations` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/page.tsx` |
| `/admin/organizations/[organizationId]/billing` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/billing/page.tsx` |
| `/admin/organizations/[organizationId]/club` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/club/page.tsx` |
| `/admin/organizations/[organizationId]/club/honors` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/club/honors/page.tsx` |
| `/admin/organizations/[organizationId]/directors` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/directors/page.tsx` |
| `/admin/organizations/[organizationId]/location` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/location/page.tsx` |
| `/admin/organizations/[organizationId]/pastor` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/pastor/page.tsx` |
| `/admin/organizations/[organizationId]/profile` | System management | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/[organizationId]/profile/page.tsx` |
| `/admin/organizations/background-checks` | System management | Clubs | Club administration | Sterling Volunteers | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/background-checks/page.tsx` |
| `/admin/organizations/directory` | Page link | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/directory/page.tsx` |
| `/admin/organizations/import` | Page link | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/import/page.tsx` |
| `/admin/organizations/map-locations` | Page link | Clubs | Clubs and churches | - | bar: Clubs | Clubs menu | - | `app/(workspace)/admin/organizations/map-locations/page.tsx` |
| `/admin/pauses` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/pauses/page.tsx` |
| `/admin/people` | System management | People | People & access | - | More, Areas | People menu | - | `app/(workspace)/admin/people/page.tsx` |
| `/admin/people/[kind]/[id]` | System management | People | People & access | - | More, Areas | People menu | - | `app/(workspace)/admin/people/[kind]/[id]/page.tsx` |
| `/admin/question-library` | System management | Admin | Forms | - | More, Areas | Admin menu | - | `app/(workspace)/admin/question-library/page.tsx` |
| `/admin/readiness` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/readiness/page.tsx` |
| `/admin/settings` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/settings/page.tsx` |
| `/admin/site-content` | System management | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/site-content/page.tsx` |
| `/admin/site-content/preview` | Page link | Admin | Catalogs and settings | - | More, Areas | Admin menu | - | `app/(workspace)/admin/site-content/preview/page.tsx` |
| `/admin/system-report` | System management | Reports | System report | - | More, Areas | Reports menu | - | `app/(workspace)/admin/system-report/page.tsx` |
| `/admin/team` | System management | People | People & access | - | More, Areas | People menu | - | `app/(workspace)/admin/team/page.tsx` |
| `/archived-events` | System management | Events | Archived events | - | bar: Events | Events menu | - | `app/archived-events/page.tsx` |
| `/check-in` | Event sidebar | Events (inside an event) | Check-in | Arrivals | bar: Check-in | Event menu | - | `app/(workspace)/check-in/page.tsx` |
| `/check-in-station` | Existing page link | Home | none (Help, Profile and pages no tab lists light Home and no tab) | - | More | Home menu | - | `app/check-in-station/page.tsx` |
| `/check-in/assets` | Page link | Events (inside an event) | Check-in | Keys and items | bar: Check-in | Event menu | - | `app/(workspace)/check-in/assets/page.tsx` |
| `/check-in/badges` | Page link | Events (inside an event) | Check-in | Name badges | bar: Check-in | Event menu | - | `app/(workspace)/check-in/badges/page.tsx` |
| `/check-in/passes` | Page link | Events (inside an event) | Check-in | Attendee passes | bar: Check-in | Event menu | - | `app/(workspace)/check-in/passes/page.tsx` |
| `/communications` | Event sidebar | Events (inside an event) | Communications | Announcements and reminders | More, This event | Event menu | - | `app/(workspace)/communications/page.tsx` |
| `/communications/scheduled` | Page link | Events (inside an event) | Communications | Scheduled emails | More, This event | Event menu | - | `app/(workspace)/communications/scheduled/page.tsx` |
| `/community` | More directory | Events (inside an event) | Communications | Attendee community | More, This event | Event menu | - | `app/(workspace)/community/page.tsx` |
| `/event-setup` | System management | Events | Create an event | - | bar: Events | Events menu | - | `app/(workspace)/event-setup/page.tsx` |
| `/event-setup/copy` | System management | Events | Copy from a past event | - | bar: Events | Events menu | - | `app/(workspace)/event-setup/copy/page.tsx` |
| `/event-setup/from-template` | Page link | Events | Create an event | - | bar: Events | Events menu | - | `app/(workspace)/event-setup/from-template/page.tsx` |
| `/events-admin` | Page link | Events | Event administration | - | bar: Events | Events menu | - | `app/(workspace)/events-admin/page.tsx` |
| `/finance` | Event sidebar | Events (inside an event) | Money | Payments | More, This event | Event menu | - | `app/(workspace)/finance/page.tsx` |
| `/finance/attendance-reconciliation` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/attendance-reconciliation/page.tsx` |
| `/finance/billing-responsibility` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/billing-responsibility/page.tsx` |
| `/finance/cancellation-policy` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/cancellation-policy/page.tsx` |
| `/finance/cancellation-requests` | Page link | Events (inside an event) | Money | Refunds | More, This event | Event menu | - | `app/(workspace)/finance/cancellation-requests/page.tsx` |
| `/finance/church-owed` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/church-owed/page.tsx` |
| `/finance/invoices` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/invoices/page.tsx` |
| `/finance/invoices/[invoiceId]` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/invoices/[invoiceId]/page.tsx` |
| `/finance/invoices/[invoiceId]/send` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/invoices/[invoiceId]/send/page.tsx` |
| `/finance/invoices/statements` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/invoices/statements/page.tsx` |
| `/finance/invoices/statements/[partyId]` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/invoices/statements/[partyId]/page.tsx` |
| `/finance/scholarship-fund` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/scholarship-fund/page.tsx` |
| `/finance/square-payments` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/square-payments/page.tsx` |
| `/finance/tools` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/finance/tools/page.tsx` |
| `/help` | Page link | Home | none (Help, Profile and pages no tab lists light Home and no tab) | - | More | Home menu | - | `app/(workspace)/help/page.tsx` |
| `/help/[guideId]` | Page link | Home | none (Help, Profile and pages no tab lists light Home and no tab) | - | More | Home menu | - | `app/(workspace)/help/[guideId]/page.tsx` |
| `/help/glossary` | Page link | Home | none (Help, Profile and pages no tab lists light Home and no tab) | - | More | Home menu | - | `app/(workspace)/help/glossary/page.tsx` |
| `/home` | Page link | Home | Needs you | - | bar: Home | Home menu | - | `app/(workspace)/home/page.tsx` |
| `/home/coming-up` | Page link | Home | Coming up | - | bar: Home | Home menu | - | `app/(workspace)/home/coming-up/page.tsx` |
| `/imports` | More directory | Events (inside an event) | Registrations | Imports | More, This event | Event menu | - | `app/(workspace)/imports/page.tsx` |
| `/information-forms` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/information-forms/page.tsx` |
| `/information-forms/responses` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/information-forms/responses/page.tsx` |
| `/more` | Event sidebar | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/page.tsx` |
| `/more/attendee-configuration` | Event sidebar | Events (inside an event) | Event setup | Attendee setup | More, This event | Event menu | - | `app/(workspace)/more/attendee-configuration/page.tsx` |
| `/more/club-assignments` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/club-assignments/page.tsx` |
| `/more/club-forms` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/club-forms/page.tsx` |
| `/more/club-forms/[submissionId]` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/club-forms/[submissionId]/page.tsx` |
| `/more/clubs` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/clubs/page.tsx` |
| `/more/clubs/[organizationId]` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/clubs/[organizationId]/page.tsx` |
| `/more/clubs/reports` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/clubs/reports/page.tsx` |
| `/more/clubs/reports/[organizationId]/[month]` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/clubs/reports/[organizationId]/[month]/page.tsx` |
| `/more/emergency-plan` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/emergency-plan/page.tsx` |
| `/more/emergency-plan/print` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/emergency-plan/print/page.tsx` |
| `/more/event-content` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/event-content/page.tsx` |
| `/more/event-health` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/event-health/page.tsx` |
| `/more/event-patches` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/event-patches/page.tsx` |
| `/more/event-settings` | Event sidebar | Events (inside an event) | Event setup | Event settings | More, This event | Event menu | - | `app/(workspace)/more/event-settings/page.tsx` |
| `/more/features` | Event sidebar | Events (inside an event) | Event setup | Event features | More, This event | Event menu | - | `app/(workspace)/more/features/page.tsx` |
| `/more/health` | Event sidebar | Events (inside an event) | Reports | Operational health | More, This event | Event menu | - | `app/(workspace)/more/health/page.tsx` |
| `/more/health-records/[organizationId]/[memberId]` | Event sidebar | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/health-records/[organizationId]/[memberId]/page.tsx` |
| `/more/honors` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/honors/page.tsx` |
| `/more/honors/instructors` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/honors/instructors/page.tsx` |
| `/more/honors/rosters` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/honors/rosters/page.tsx` |
| `/more/honors/schedule` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/honors/schedule/page.tsx` |
| `/more/issued-assets` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/issued-assets/page.tsx` |
| `/more/issued-assets/closeout` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/issued-assets/closeout/page.tsx` |
| `/more/kitchen-report` | Page link | Events (inside an event) | Reports | Kitchen report | More, This event | Event menu | - | `app/(workspace)/more/kitchen-report/page.tsx` |
| `/more/kitchen-report/closeout` | Page link | Events (inside an event) | Reports | Kitchen report | More, This event | Event menu | - | `app/(workspace)/more/kitchen-report/closeout/page.tsx` |
| `/more/kitchen-report/counts` | Event sidebar | Events (inside an event) | Reports | Kitchen counts | More, This event | Event menu | - | `app/(workspace)/more/kitchen-report/counts/page.tsx` |
| `/more/kitchen-report/scanner-import` | Page link | Events (inside an event) | Reports | Kitchen report | More, This event | Event menu | - | `app/(workspace)/more/kitchen-report/scanner-import/page.tsx` |
| `/more/ledger-health` | Page link | Events (inside an event) | Money | More money tools | More, This event | Event menu | - | `app/(workspace)/more/ledger-health/page.tsx` |
| `/more/lodging` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/lodging/page.tsx` |
| `/more/lodging/assignments` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/lodging/assignments/page.tsx` |
| `/more/lodging/requests` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/lodging/requests/page.tsx` |
| `/more/meals` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/meals/page.tsx` |
| `/more/merchandise` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/merchandise/page.tsx` |
| `/more/program-assignments` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/program-assignments/page.tsx` |
| `/more/program-assignments/[runId]` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/program-assignments/[runId]/page.tsx` |
| `/more/promo-codes` | More directory | Events (inside an event) | Money | Promo codes | More, This event | Event menu | - | `app/(workspace)/more/promo-codes/page.tsx` |
| `/more/reports` | Event sidebar | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/page.tsx` |
| `/more/reports/clubs` | Page link | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/clubs/page.tsx` |
| `/more/reports/clubs/check-in-book` | Page link | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/clubs/check-in-book/page.tsx` |
| `/more/reports/clubs/packet/[organizationId]` | Page link | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/clubs/packet/[organizationId]/page.tsx` |
| `/more/reports/clubs/team-form` | Page link | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/clubs/team-form/page.tsx` |
| `/more/reports/clubs/team-form/[registrationId]` | Page link | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/clubs/team-form/[registrationId]/page.tsx` |
| `/more/reports/clubs/team-form/level` | Page link | Events (inside an event) | Reports | Operational reports | More, This event | Event menu | - | `app/(workspace)/more/reports/clubs/team-form/level/page.tsx` |
| `/more/reports/packets` | Page link | Events (inside an event) | Reports | Printouts | More, This event | Event menu | - | `app/(workspace)/more/reports/packets/page.tsx` |
| `/more/tags` | Event sidebar | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/tags/page.tsx` |
| `/more/team-results` | Page link | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/more/team-results/page.tsx` |
| `/overview` | Event sidebar | Events (inside an event) | Event home | Dashboard | More, This event | Event menu | - | `app/(workspace)/overview/page.tsx` |
| `/people` | Event sidebar | Events (inside an event) | Registrations | All registrations | More, This event | Event menu | - | `app/(workspace)/people/page.tsx` |
| `/people/attendees` | More directory | Events (inside an event) | Registrations | Attendee list | More, This event | Event menu | - | `app/(workspace)/people/attendees/page.tsx` |
| `/people/directory-review` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/directory-review/page.tsx` |
| `/people/duplicates` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/duplicates/page.tsx` |
| `/people/matches` | Page link | Events (inside an event) | Registrations | All registrations | More, This event | Event menu | - | `app/(workspace)/people/matches/page.tsx` |
| `/people/pending-teams` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/pending-teams/page.tsx` |
| `/people/responsible-adults` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/responsible-adults/page.tsx` |
| `/people/review-queues` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/review-queues/page.tsx` |
| `/people/staff-invitations` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/staff-invitations/page.tsx` |
| `/people/staff-invitations/approvals` | Page link | Events (inside an event) | Registrations | Review queues | More, This event | Event menu | - | `app/(workspace)/people/staff-invitations/approvals/page.tsx` |
| `/registration-builder` | Event sidebar | Events (inside an event) | Event setup | Registration forms | More, This event | Event menu | - | `app/(workspace)/registration-builder/page.tsx` |
| `/select-event` | Existing page link | Home | none (Help, Profile and pages no tab lists light Home and no tab) | - | More | Home menu | - | `app/select-event/page.tsx` |
| `/staff` | More directory | Events (inside an event) | Event setup | All event tools | More, This event | Event menu | - | `app/(workspace)/staff/page.tsx` |

159 staff page definitions. Dynamic patterns count once. Alias routes remain aliases. The table does not enumerate query states, permissions or approved data fields; those remain with each owning issue and page guard.

## Query states that move a page to another tab or view

| Route and query | Rail area | Tab | View |
| --- | --- | --- | --- |
| `/admin/clubs/summary` | Clubs | Club summary | All clubs |
| `/admin/clubs/summary?view=events` | Clubs | Club summary | Club events |
| `/admin/clubs/summary?view=records` | Clubs | Monthly Records | - |
| `/admin/clubs/summary?view=points` | Reports | Points | - |
| `/finance` | Events (inside an event) | Money | Payments |
| `/finance?filter=BALANCE` | Events (inside an event) | Money | Balances due |

## Home (#1568)

Home is on the rail for every staff viewer and has two tabs. **Needs you** (`/home`) is the work waiting for the person, one section per admin role they hold, built from the same reads as the role pills so the numbers agree; every item links to the page that does the work, a read that failed says "Unavailable" (never zero or "Nothing waiting"), and "Nothing needs you right now" shows only when every read worked and found nothing. The tab's count is the held roles' counts added up, shown only when every held role's count was read. **Coming up** (`/home/coming-up`) lists the upcoming events the person can open, soonest first, each linking to its event home. Help and Profile also light Home but no tab. The phone bar's Home slot opens `/home`; where people land after sign-in is unchanged (the role switcher's decision, #108).

## Club administration (#1568)

`/admin/clubs` keeps its key numbers, with Review applications as the one main action, and lists every destination of the Clubs area as a card with its own status, in card groups (Clubs, Records and points, Applications, Club events and forms, People, Catalogs and imports). A card is a link only and is drawn only for a page the person can open; a number that cannot be read shows "Unavailable". Below the cards the page keeps New clubs (with its approve buttons), Registered clubs, Club events and Quick actions as they were. The Clubs tab Club administration overview lights as before.

## Admin hub pages (#1569)

Each Admin tab (Events, Clubs, People, Forms, Catalogs and settings) opens its own hub page under `/admin/hubs/`: a few key numbers, one main action, then a card for each destination with its own status. A card is a link only and is drawn only for a destination the person can open; a number that cannot be read shows "Unavailable", never zero. The hub lists every destination of its group, so the Forms and Catalogs tabs have no view buttons. The pages a hub links to keep their own area for the marking (for example Create an event is in Events); the Admin pages with no hub of their own light the Forms or Catalogs and settings tab. System administration (`/admin`) keeps the task directory and the Common tasks. Break-glass and legal-hold counts are not shown on the People hub: that page asks for the health privacy acknowledgment first.

## Pages that used to be reached only through other pages

| Page | Home now |
| --- | --- |
| Check-in passes, badges and keys (`/check-in/passes`, `/check-in/badges`, `/check-in/assets`) | Views of the Check-in tab: Attendee passes, Name badges, Keys and items |
| `/finance` sub-pages (Owed by churches, Billing responsibility, Attendance reconciliation, Scholarship fund, Invoices, Cancellation rules and requests, Unmatched Square payments, Ledger check) | Money > Payments owns them for the marking, and the Payments page keeps its tool links; the "More money tools" grouped page waits for #1575 and is not listed until it exists |
| `/people` sub-pages (Find duplicates, Directory review, Teams waiting for a club, Responsible adults, Staff invitations) | Registrations > Review queues owns them (#1574): the grouped page lists each one the person can open as a card, with a count where its own page already has one. `/people/matches` stays with All registrations |
| Imports, Attendee list | Views of the Registrations tab |
| Honors Weekend classes, instructors, rosters and schedule (`/more/honors/**`) | Event setup > All event tools (the `/more` directory) lists the classes card, and the classes page links the other three |
| Event features (`/more/features`) | A view of Event setup |
| Event module requests (`/admin/feature-requests`) | The Event module requests section of the System administration dashboard (`/admin`); it is the page's own title now |
| Club invites, Import clubs, Import health records, Sterling Volunteers | Views of the Clubs tabs New club applications and Club administration |
| Archived events (`/archived-events`) | Events tab for system administrators and Event Administrators, and the event bar's link for everyone else |

## Left out until built

- Events > All events: there is no in-shell list of all events yet. Staff open an event from the Events row's "Open an event" picker or the dashboards, and switch from the event bar.
- Money > Refunds and More money tools (#1575), Event setup groups (#1571 and the setup issues), the reserved event tabs Operations and Safety (no feature or route exists, so none is listed).
