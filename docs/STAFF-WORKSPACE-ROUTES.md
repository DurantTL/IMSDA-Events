# Staff workspace route ownership (#1565)

Generated with `npx tsx docs/generate-staff-workspace-map.ts`. This is the staff-only subset for #1558, not a second runtime registry or a decision to build a whole-system site-map page.

Workspace columns show the existing System and Clubs view policies for a system administrator. Shared destinations keep their contextual workspace; this choice never grants access. Every route retains its server guard, and menu/search visibility retains the existing role/grant/module predicates. Record pages open through their existing parent links. Help follows the current workspace. Query filters, club year and the selected event are preserved by the existing link helpers.

| Route | Previously reached from | System view | Clubs view | Section / contextual entry | Source |
| --- | --- | --- | --- | --- | --- |
| `/admin` | System management | system | system | Contextual page: `/admin` | `app/(workspace)/admin/page.tsx` |
| `/admin/accounts` | System management | system | system | Contextual page: `/admin/people` | `app/(workspace)/admin/accounts/page.tsx` |
| `/admin/analytics` | System management | system | system | Catalogs and settings: `/admin/analytics` | `app/(workspace)/admin/analytics/page.tsx` |
| `/admin/background-checks` | System management | system | system | Contextual page: `/admin/organizations/background-checks` | `app/(workspace)/admin/background-checks/page.tsx` |
| `/admin/calendar` | System management | system | system | Events: `/admin/calendar` | `app/(workspace)/admin/calendar/page.tsx` |
| `/admin/club-forms` | System management | system | clubs | Forms: `/admin/club-forms` | `app/(workspace)/admin/club-forms/page.tsx` |
| `/admin/club-forms/[templateKey]` | System management | system | clubs | Forms: `/admin/club-forms` | `app/(workspace)/admin/club-forms/[templateKey]/page.tsx` |
| `/admin/club-supplies` | System management | system | clubs | Catalogs and settings: `/admin/club-supplies` | `app/(workspace)/admin/club-supplies/page.tsx` |
| `/admin/clubs` | Page link | clubs | clubs | Contextual page: `/admin/clubs` | `app/(workspace)/admin/clubs/page.tsx` |
| `/admin/clubs/applications` | System management | system | clubs | Clubs: `/admin/clubs/applications` | `app/(workspace)/admin/clubs/applications/page.tsx` |
| `/admin/clubs/health-import` | Page link | system | clubs | Clubs: `/admin/organizations` | `app/(workspace)/admin/clubs/health-import/page.tsx` |
| `/admin/clubs/import` | Page link | system | clubs | Clubs: `/admin/organizations` | `app/(workspace)/admin/clubs/import/page.tsx` |
| `/admin/clubs/invites` | System management | system | clubs | Clubs: `/admin/clubs/applications` | `app/(workspace)/admin/clubs/invites/page.tsx` |
| `/admin/clubs/leaders` | System management | system | clubs | Clubs: `/admin/clubs/leaders` | `app/(workspace)/admin/clubs/leaders/page.tsx` |
| `/admin/clubs/reports` | System management | system | clubs | Clubs: `/admin/clubs/reports` | `app/(workspace)/admin/clubs/reports/page.tsx` |
| `/admin/clubs/reports/[organizationId]/[month]` | System management | system | clubs | Clubs: `/admin/clubs/reports` | `app/(workspace)/admin/clubs/reports/[organizationId]/[month]/page.tsx` |
| `/admin/clubs/reports/year-end` | Page link | system | clubs | Clubs: `/admin/clubs/reports` | `app/(workspace)/admin/clubs/reports/year-end/page.tsx` |
| `/admin/clubs/summary` | System management | system | clubs | Clubs: `/admin/clubs/summary` | `app/(workspace)/admin/clubs/summary/page.tsx` |
| `/admin/clubs/transfers` | System management | system | clubs | Clubs: `/admin/clubs/transfers` | `app/(workspace)/admin/clubs/transfers/page.tsx` |
| `/admin/email` | System management | system | system | Catalogs and settings: `/admin/email` | `app/(workspace)/admin/email/page.tsx` |
| `/admin/event-templates` | System management | system | system | Events: `/admin/event-templates` | `app/(workspace)/admin/event-templates/page.tsx` |
| `/admin/event-templates/[templateId]` | System management | system | system | Events: `/admin/event-templates` | `app/(workspace)/admin/event-templates/[templateId]/page.tsx` |
| `/admin/event-templates/from-event` | Page link | system | system | Events: `/admin/event-templates` | `app/(workspace)/admin/event-templates/from-event/page.tsx` |
| `/admin/feature-requests` | System management | system | system | Contextual page: `/admin` | `app/(workspace)/admin/feature-requests/page.tsx` |
| `/admin/form-templates` | System management | system | system | Forms: `/admin/form-templates` | `app/(workspace)/admin/form-templates/page.tsx` |
| `/admin/form-templates/[templateKey]` | System management | system | system | Forms: `/admin/form-templates` | `app/(workspace)/admin/form-templates/[templateKey]/page.tsx` |
| `/admin/forms` | System management | system | system | Forms: `/admin/forms` | `app/(workspace)/admin/forms/page.tsx` |
| `/admin/honors` | System management | system | clubs | Catalogs and settings: `/admin/honors` | `app/(workspace)/admin/honors/page.tsx` |
| `/admin/information-forms` | System management | system | system | Forms: `/admin/information-forms` | `app/(workspace)/admin/information-forms/page.tsx` |
| `/admin/information-forms/[formId]` | System management | system | system | Forms: `/admin/information-forms` | `app/(workspace)/admin/information-forms/[formId]/page.tsx` |
| `/admin/information-forms/[formId]/responses` | System management | system | system | Forms: `/admin/information-forms` | `app/(workspace)/admin/information-forms/[formId]/responses/page.tsx` |
| `/admin/master-award-rules` | System management | system | system | Catalogs and settings: `/admin/master-award-rules` | `app/(workspace)/admin/master-award-rules/page.tsx` |
| `/admin/notifications` | System management | system | system | Catalogs and settings: `/admin/email` | `app/(workspace)/admin/notifications/page.tsx` |
| `/admin/organizations` | System management | system | system | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/page.tsx` |
| `/admin/organizations/[organizationId]/billing` | System management | system | system | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/billing/page.tsx` |
| `/admin/organizations/[organizationId]/club` | System management | system | clubs | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/club/page.tsx` |
| `/admin/organizations/[organizationId]/club/honors` | System management | system | clubs | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/club/honors/page.tsx` |
| `/admin/organizations/[organizationId]/directors` | System management | system | clubs | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/directors/page.tsx` |
| `/admin/organizations/[organizationId]/location` | System management | system | system | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/location/page.tsx` |
| `/admin/organizations/[organizationId]/pastor` | System management | system | system | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/pastor/page.tsx` |
| `/admin/organizations/[organizationId]/profile` | System management | system | clubs | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/[organizationId]/profile/page.tsx` |
| `/admin/organizations/background-checks` | System management | system | clubs | Catalogs and settings: `/admin/organizations/background-checks` | `app/(workspace)/admin/organizations/background-checks/page.tsx` |
| `/admin/organizations/directory` | Page link | system | system | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/directory/page.tsx` |
| `/admin/organizations/import` | Page link | system | system | Clubs: `/admin/organizations` | `app/(workspace)/admin/organizations/import/page.tsx` |
| `/admin/organizations/map-locations` | Page link | system | system | Clubs: `/admin/organizations/directory` | `app/(workspace)/admin/organizations/map-locations/page.tsx` |
| `/admin/pauses` | System management | system | system | Catalogs and settings: `/admin/pauses` | `app/(workspace)/admin/pauses/page.tsx` |
| `/admin/people` | System management | system | clubs | People: `/admin/people` | `app/(workspace)/admin/people/page.tsx` |
| `/admin/people/[kind]/[id]` | System management | system | clubs | People: `/admin/people` | `app/(workspace)/admin/people/[kind]/[id]/page.tsx` |
| `/admin/question-library` | System management | system | system | Forms: `/admin/question-library` | `app/(workspace)/admin/question-library/page.tsx` |
| `/admin/readiness` | System management | system | system | Catalogs and settings: `/admin/readiness` | `app/(workspace)/admin/readiness/page.tsx` |
| `/admin/settings` | System management | system | system | Catalogs and settings: `/admin/settings` | `app/(workspace)/admin/settings/page.tsx` |
| `/admin/site-content` | System management | system | system | Catalogs and settings: `/admin/site-content` | `app/(workspace)/admin/site-content/page.tsx` |
| `/admin/site-content/preview` | Page link | system | system | Catalogs and settings: `/admin/site-content` | `app/(workspace)/admin/site-content/preview/page.tsx` |
| `/admin/system-report` | System management | system | system | Catalogs and settings: `/admin/system-report` | `app/(workspace)/admin/system-report/page.tsx` |
| `/admin/team` | System management | system | system | Contextual page: `/admin/people` | `app/(workspace)/admin/team/page.tsx` |
| `/archived-events` | System management | events | events | Events: `/archived-events` | `app/archived-events/page.tsx` |
| `/check-in` | Event sidebar | events | events | daily: `/check-in` | `app/(workspace)/check-in/page.tsx` |
| `/check-in-station` | Existing page link | events | events | Contextual page: `/check-in-station` | `app/check-in-station/page.tsx` |
| `/check-in/assets` | Page link | events | events | daily: `/check-in` | `app/(workspace)/check-in/assets/page.tsx` |
| `/check-in/badges` | Page link | events | events | daily: `/check-in` | `app/(workspace)/check-in/badges/page.tsx` |
| `/check-in/passes` | Page link | events | events | daily: `/check-in` | `app/(workspace)/check-in/passes/page.tsx` |
| `/communications` | Event sidebar | events | events | daily: `/communications` | `app/(workspace)/communications/page.tsx` |
| `/communications/scheduled` | Page link | events | events | daily: `/communications` | `app/(workspace)/communications/scheduled/page.tsx` |
| `/community` | More directory | events | events | Contextual page: `/community` | `app/(workspace)/community/page.tsx` |
| `/event-setup` | System management | system | system | Events: `/event-setup` | `app/(workspace)/event-setup/page.tsx` |
| `/event-setup/copy` | System management | system | system | Events: `/event-setup/copy` | `app/(workspace)/event-setup/copy/page.tsx` |
| `/event-setup/from-template` | Page link | system | system | Events: `/event-setup` | `app/(workspace)/event-setup/from-template/page.tsx` |
| `/events-admin` | Page link | events | events | Contextual page: `/events-admin` | `app/(workspace)/events-admin/page.tsx` |
| `/finance` | Event sidebar | events | events | daily: `/finance` | `app/(workspace)/finance/page.tsx` |
| `/finance/attendance-reconciliation` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/attendance-reconciliation/page.tsx` |
| `/finance/billing-responsibility` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/billing-responsibility/page.tsx` |
| `/finance/cancellation-policy` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/cancellation-policy/page.tsx` |
| `/finance/cancellation-requests` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/cancellation-requests/page.tsx` |
| `/finance/church-owed` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/church-owed/page.tsx` |
| `/finance/invoices` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/invoices/page.tsx` |
| `/finance/invoices/[invoiceId]` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/invoices/[invoiceId]/page.tsx` |
| `/finance/invoices/[invoiceId]/send` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/invoices/[invoiceId]/send/page.tsx` |
| `/finance/invoices/statements` | Page link | events | events | daily: `/finance/invoices` | `app/(workspace)/finance/invoices/statements/page.tsx` |
| `/finance/invoices/statements/[partyId]` | Page link | events | events | daily: `/finance/invoices` | `app/(workspace)/finance/invoices/statements/[partyId]/page.tsx` |
| `/finance/scholarship-fund` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/scholarship-fund/page.tsx` |
| `/finance/square-payments` | Page link | events | events | daily: `/finance` | `app/(workspace)/finance/square-payments/page.tsx` |
| `/help` | Page link | system | clubs | Contextual page: `/help` | `app/(workspace)/help/page.tsx` |
| `/help/[guideId]` | Page link | system | clubs | Contextual page: `/help` | `app/(workspace)/help/[guideId]/page.tsx` |
| `/help/glossary` | Page link | system | clubs | Contextual page: `/help` | `app/(workspace)/help/glossary/page.tsx` |
| `/imports` | More directory | events | events | Contextual page: `/imports` | `app/(workspace)/imports/page.tsx` |
| `/information-forms` | More directory | events | events | Contextual page: `/information-forms` | `app/(workspace)/information-forms/page.tsx` |
| `/information-forms/responses` | Page link | events | events | Contextual page: `/information-forms` | `app/(workspace)/information-forms/responses/page.tsx` |
| `/more` | Event sidebar | events | events | Contextual page: `/more` | `app/(workspace)/more/page.tsx` |
| `/more/attendee-configuration` | Event sidebar | events | events | setup: `/more/attendee-configuration` | `app/(workspace)/more/attendee-configuration/page.tsx` |
| `/more/club-assignments` | More directory | events | events | Contextual page: `/more/club-assignments` | `app/(workspace)/more/club-assignments/page.tsx` |
| `/more/club-forms` | More directory | events | events | Contextual page: `/more/club-forms` | `app/(workspace)/more/club-forms/page.tsx` |
| `/more/club-forms/[submissionId]` | More directory | events | events | Contextual page: `/more/club-forms` | `app/(workspace)/more/club-forms/[submissionId]/page.tsx` |
| `/more/clubs` | More directory | events | events | Contextual page: `/more/clubs` | `app/(workspace)/more/clubs/page.tsx` |
| `/more/clubs/[organizationId]` | More directory | events | events | Contextual page: `/more/clubs` | `app/(workspace)/more/clubs/[organizationId]/page.tsx` |
| `/more/clubs/reports` | Page link | events | events | Contextual page: `/more/clubs` | `app/(workspace)/more/clubs/reports/page.tsx` |
| `/more/clubs/reports/[organizationId]/[month]` | Page link | events | events | Contextual page: `/more/clubs` | `app/(workspace)/more/clubs/reports/[organizationId]/[month]/page.tsx` |
| `/more/emergency-plan` | More directory | events | events | Contextual page: `/more/emergency-plan` | `app/(workspace)/more/emergency-plan/page.tsx` |
| `/more/emergency-plan/print` | Page link | events | events | Contextual page: `/more/emergency-plan` | `app/(workspace)/more/emergency-plan/print/page.tsx` |
| `/more/event-content` | More directory | events | events | Contextual page: `/more/event-content` | `app/(workspace)/more/event-content/page.tsx` |
| `/more/event-health` | More directory | events | events | Contextual page: `/more/event-health` | `app/(workspace)/more/event-health/page.tsx` |
| `/more/event-patches` | More directory | events | events | Contextual page: `/more/event-patches` | `app/(workspace)/more/event-patches/page.tsx` |
| `/more/event-settings` | Event sidebar | events | events | setup: `/more/event-settings` | `app/(workspace)/more/event-settings/page.tsx` |
| `/more/features` | Event sidebar | events | events | Contextual page: `/more/features` | `app/(workspace)/more/features/page.tsx` |
| `/more/health` | Event sidebar | events | events | reports: `/more/health` | `app/(workspace)/more/health/page.tsx` |
| `/more/health-records/[organizationId]/[memberId]` | Event sidebar | events | events | Contextual page: `/more` | `app/(workspace)/more/health-records/[organizationId]/[memberId]/page.tsx` |
| `/more/honors` | More directory | events | events | Contextual page: `/more/honors` | `app/(workspace)/more/honors/page.tsx` |
| `/more/honors/instructors` | Page link | events | events | Contextual page: `/more/honors` | `app/(workspace)/more/honors/instructors/page.tsx` |
| `/more/honors/rosters` | Page link | events | events | Contextual page: `/more/honors` | `app/(workspace)/more/honors/rosters/page.tsx` |
| `/more/honors/schedule` | Page link | events | events | Contextual page: `/more/honors` | `app/(workspace)/more/honors/schedule/page.tsx` |
| `/more/issued-assets` | More directory | events | events | Contextual page: `/more/issued-assets` | `app/(workspace)/more/issued-assets/page.tsx` |
| `/more/issued-assets/closeout` | Page link | events | events | Contextual page: `/more/issued-assets` | `app/(workspace)/more/issued-assets/closeout/page.tsx` |
| `/more/kitchen-report` | Page link | events | events | Contextual page: `/more/reports` | `app/(workspace)/more/kitchen-report/page.tsx` |
| `/more/kitchen-report/closeout` | Page link | events | events | Contextual page: `/more/kitchen-report` | `app/(workspace)/more/kitchen-report/closeout/page.tsx` |
| `/more/kitchen-report/counts` | Event sidebar | events | events | daily: `/more/kitchen-report/counts` | `app/(workspace)/more/kitchen-report/counts/page.tsx` |
| `/more/kitchen-report/scanner-import` | Page link | events | events | Contextual page: `/more/kitchen-report` | `app/(workspace)/more/kitchen-report/scanner-import/page.tsx` |
| `/more/ledger-health` | Page link | events | events | Contextual page: `/finance` | `app/(workspace)/more/ledger-health/page.tsx` |
| `/more/lodging` | More directory | events | events | Contextual page: `/more/lodging` | `app/(workspace)/more/lodging/page.tsx` |
| `/more/lodging/assignments` | More directory | events | events | Contextual page: `/more/lodging/assignments` | `app/(workspace)/more/lodging/assignments/page.tsx` |
| `/more/lodging/requests` | More directory | events | events | Contextual page: `/more/lodging/requests` | `app/(workspace)/more/lodging/requests/page.tsx` |
| `/more/meals` | More directory | events | events | Contextual page: `/more/meals` | `app/(workspace)/more/meals/page.tsx` |
| `/more/merchandise` | More directory | events | events | Contextual page: `/more/merchandise` | `app/(workspace)/more/merchandise/page.tsx` |
| `/more/program-assignments` | More directory | events | events | Contextual page: `/more/program-assignments` | `app/(workspace)/more/program-assignments/page.tsx` |
| `/more/program-assignments/[runId]` | More directory | events | events | Contextual page: `/more/program-assignments` | `app/(workspace)/more/program-assignments/[runId]/page.tsx` |
| `/more/promo-codes` | More directory | events | events | Contextual page: `/more/promo-codes` | `app/(workspace)/more/promo-codes/page.tsx` |
| `/more/reports` | Event sidebar | events | events | reports: `/more/reports` | `app/(workspace)/more/reports/page.tsx` |
| `/more/reports/clubs` | Page link | events | events | reports: `/more/reports` | `app/(workspace)/more/reports/clubs/page.tsx` |
| `/more/reports/clubs/check-in-book` | Page link | events | events | reports: `/more/reports/clubs` | `app/(workspace)/more/reports/clubs/check-in-book/page.tsx` |
| `/more/reports/clubs/packet/[organizationId]` | Page link | events | events | reports: `/more/reports` | `app/(workspace)/more/reports/clubs/packet/[organizationId]/page.tsx` |
| `/more/reports/clubs/team-form` | Page link | events | events | reports: `/more/team-results` | `app/(workspace)/more/reports/clubs/team-form/page.tsx` |
| `/more/reports/clubs/team-form/[registrationId]` | Page link | events | events | reports: `/more/team-results` | `app/(workspace)/more/reports/clubs/team-form/[registrationId]/page.tsx` |
| `/more/reports/clubs/team-form/level` | Page link | events | events | reports: `/more/team-results` | `app/(workspace)/more/reports/clubs/team-form/level/page.tsx` |
| `/more/reports/packets` | Page link | events | events | reports: `/more/reports` | `app/(workspace)/more/reports/packets/page.tsx` |
| `/more/tags` | Event sidebar | events | events | setup: `/more/tags` | `app/(workspace)/more/tags/page.tsx` |
| `/more/team-results` | Page link | events | events | Contextual page: `/more/clubs` | `app/(workspace)/more/team-results/page.tsx` |
| `/overview` | Event sidebar | events | events | daily: `/overview` | `app/(workspace)/overview/page.tsx` |
| `/people` | Event sidebar | events | events | daily: `/people` | `app/(workspace)/people/page.tsx` |
| `/people/attendees` | More directory | events | events | Contextual page: `/people/attendees` | `app/(workspace)/people/attendees/page.tsx` |
| `/people/directory-review` | Page link | events | events | daily: `/people` | `app/(workspace)/people/directory-review/page.tsx` |
| `/people/duplicates` | Page link | events | events | daily: `/people` | `app/(workspace)/people/duplicates/page.tsx` |
| `/people/matches` | Page link | events | events | daily: `/people` | `app/(workspace)/people/matches/page.tsx` |
| `/people/pending-teams` | Page link | events | events | daily: `/people` | `app/(workspace)/people/pending-teams/page.tsx` |
| `/people/responsible-adults` | Page link | events | events | daily: `/people` | `app/(workspace)/people/responsible-adults/page.tsx` |
| `/people/staff-invitations` | Page link | events | events | daily: `/people` | `app/(workspace)/people/staff-invitations/page.tsx` |
| `/people/staff-invitations/approvals` | Page link | events | events | daily: `/people/staff-invitations` | `app/(workspace)/people/staff-invitations/approvals/page.tsx` |
| `/registration-builder` | Event sidebar | events | events | setup: `/registration-builder` | `app/(workspace)/registration-builder/page.tsx` |
| `/select-event` | Existing page link | events | events | Contextual page: `/select-event` | `app/select-event/page.tsx` |
| `/staff` | More directory | events | events | Contextual page: `/staff` | `app/(workspace)/staff/page.tsx` |

147 staff page definitions. Dynamic patterns count once. Alias routes remain aliases. The table does not enumerate query states, permissions or approved data fields; those remain with each owning issue and page guard.
