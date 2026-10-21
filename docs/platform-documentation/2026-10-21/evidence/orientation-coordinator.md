# Coordinator orientation — source-verified training copy

Reviewed October 21, 2026 against the current application source. Main `47cd5c00` adds the merged documentation pack; the application baseline remains `5e367b7c`. This is training-source evidence for the revised presentation, not an application change or a production session.

## Audience goal and simple explanation

**Plain-language purpose:** “As an Area Coordinator, you can see how clubs are doing, read their Monthly Records, follow points and event participation, and identify where a director may need help. You use the same club records the director maintains, so you do not need another copy of every spreadsheet or report.”

**Why the system helps:** one place to find a club; one view of submitted records and points; clear event participation; a way to identify follow-up before asking a director to resend information. Do not promise automatic follow-up emails, a universal approvals queue, or editing of every club record.

## Verified current entry and menu

After signing in to the person's own account and completing the required second step, the account Overview can show an **Area coordinator** card. Its action labels are **Clubs overview**, **Club event registrations** and **Event health information**. The normal training entry is **Clubs overview**; health is not a prerequisite for the ordinary coordinator workflow.

The account's top navigation also has **Clubs** for coordinators. This opens `/account/clubs`, the **All clubs** view. The coordinator sub-navigation is exactly:

| Visible label | Current destination | Main purpose |
|---|---|---|
| All clubs | `/account/clubs` | Find a club by club name, church or city and open it. |
| Overview | `/account/area-clubs/overview` | Roster, reports, points and Sterling Volunteers summary counts across active clubs. |
| Monthly Records | `/account/area-clubs/reports` | See each month's status and points; open a submitted month to read it. |
| Points | `/account/area-clubs/points` | Read totals and chart; sort by points or club name. |
| Club events | `/account/area-clubs/events` | Check each club's registration status and headcount for the year. |
| Team approvals | `/account/area-clubs/team-permissions` | Make only the specific permitted team-member decisions for the coordinator's own event locations. |
| New clubs | `/account/area-clubs/applications` | Review new-club applications; approval/decline remains the system administrator's job. |

The cross-club views display the club year in their heading. The year is parsed from the URL when supplied and carried through searches/downloads. **There is no visible year dropdown in these page components.** Training should say “check the year shown,” not “choose a year from the dropdown.” If the displayed year is not the one needed, ask the trainer/office for the correct link rather than inventing a control.

Current source lists **every active club**. Do not teach an enforced “my area” or “my ministry” filter as a current capability. Future ministry scoping is separate work. A coordinator who is separately a director of one club can open their own club with that director role; other clubs open view-only. This is actual additional authority, not a mode every coordinator can turn on.

## Recommended eight practical slides

Each visible slide below uses at most three action lines. Natural notes are written for a presenter speaking to users, rather than reading code or issue numbers aloud.

### 1. Your job as an Area Coordinator

**Visible copy**

1. See how clubs are doing.
2. Read their records and event participation.
3. Help directors follow up on what is missing.

**Suggested spoken notes:** “The coordinator side is an overview of the clubs' work. Directors keep their own club records up to date. You use those records to see progress, find a missing item and offer help. Most club information is view-only here, so you are not taking over the director's work.”

**Show:** the account Overview's **Area coordinator** card, then **Clubs overview**. The card can show **Your locations**, **Upcoming club events** and **Clubs needing attention**. Do not say that selecting or reading an item clears its underlying task.

### 2. Find a club and open its information

**Visible copy**

1. Open **Clubs → All clubs**.
2. Search by club, church or city.
3. Choose **Open** beside the club.

**Suggested spoken notes:** “Start here when you know which club you want. The All clubs search accepts the club name, sponsoring church or city. The list tells you whether you have a role at that club or whether it will open view-only. When you are reviewing another club, the page says View only. It shows ages rather than full birth dates, and the club makes its own changes.”

**Show:** search with a fictitious club such as Riverton Pathfinders. No real member or contact data is needed for the demonstration. The individual club menu offers **Home**, **Roster**, **Honors**, **Events**, **Club forms**, **Monthly Records** and **Earned awards**; roster/events/records may move to sections on that club's Home page. Do not show director-only **Class tracking**, **Club settings**, **Health** or **Orders** as coordinator actions.

### 3. Use Overview to decide where to follow up

**Visible copy**

1. Open **Overview** and check the year.
2. Review reports submitted, points and reminder counts.
3. Open the club before following up.

**Suggested spoken notes:** “Overview helps you decide what deserves a closer look. It lists the club, its directors and church, roster count, reports submitted, total points and last report. Sterling Volunteers is summarized as counts here. A count is a signal to look at the relevant club, not an explanation of every person. Contact the director through the normal conference process after you understand which item needs attention.”

**Important:** no general “Send reminder” button is established by this view. Do not instruct users to click one. Summary counts can include different kinds of reminders; they are not one undifferentiated approval status.

### 4. Read Monthly Records and identify a missing month

**Visible copy**

1. Open **Monthly Records**.
2. Find the club and read the month status.
3. Select a submitted month's points to read its report.

**Suggested spoken notes:** “This grid is useful during your regular follow-up. A number links to a submitted report; a late submission is labelled late. Draft means the club started a record but has not submitted it. Due is not the same as Missing: Missing means the due date has passed and no submitted report is on file. Future months are not yet due. If Riverton's October record says Missing, contact its director about that month rather than entering a report on the club's behalf.”

**Trainer detail:** the current page explains that the due date is the **10th of the next month**. A saved draft continues to display **Draft** even after a due date; do not say every overdue draft becomes the word Missing. The coordinator cannot edit the director's submitted report from this overview.

### 5. Understand Points and use the download correctly

**Visible copy**

1. Open **Points** and check the year.
2. Sort by **points** or **club name**.
3. Use **Download points CSV** when needed.

**Suggested spoken notes:** “Points shows a chart and the same information in a table. Total points combine submitted-report points with 1,500 points for an on-time yearly registration. The table separates those parts, which helps explain a total to a director. Searching narrows the rows you see, but the ranking is calculated across the full club list. A CSV download includes the whole year's authorized list, not just the club-name search on screen.”

**Trainer detail:** **Overview** also has **Download summary CSV** and **Download points CSV**; **Monthly Records** has **Download summary CSV**. Search on these cross-club tabs matches club name, whereas **All clubs** also matches church/city. A typed query does not change the actual club scope.

### 6. Check who is registered for an event

**Visible copy**

1. Open **Club events**.
2. Find the event and review each club's status.
3. Follow up with the director about missing or unfinished participation.

**Suggested spoken notes:** “A roster tells us who belongs to a club. This page tells us which clubs are registered for a particular event and how many people are included. Not registered, Draft, Waitlisted, Cancelled and Registered are different states. Event totals count registered clubs; a search can narrow the displayed club rows while the event total remains the total for that event. You are checking participation here, not submitting every club's registration.”

**Trainer detail:** the current page also has a **Kitchen report** link per event. This does not create registration editing, refund or general health-record authority. It need not be included in introductory training.

### 7. Know the two review pages: Team approvals and New clubs

**Visible copy**

1. **Team approvals:** decide only the requests assigned to your event locations.
2. Read the event's rules before choosing **Approve** or **Decline**.
3. **New clubs:** review applications; the conference administrator decides.

**Suggested spoken notes:** “Team approvals is the narrow exception to the usual view-only coordinator work. For team events such as PBE, an older team member can need your review at your event location. The page explains the event's current age and eligibility rules. Approval keeps that person on the team; a decline tells the director what to correct. It does not remove the person automatically. New club applications are different: you may review their information, but a system administrator approves or declines them.”

**Trainer detail:** current Team approvals concerns team members aged 18 or older, not coaches; the maximum age and age-as-of date come from each event. The criteria include active/good-standing inducted Pathfinder or TLT and not graduated from high school. A staff “act as coordinator” support view is not the real coordinator account and cannot make the decision. These details belong in spoken notes, not a new generic safeguarding policy. Keep application contacts and attachments within their authorized use.

### 8. A simple coordinator routine

**Visible copy**

1. Start with **Overview** and **Monthly Records**.
2. Check **Club events** before the next event.
3. Contact the director or office for the specific follow-up.

**Suggested spoken notes:** “You do not need to open every club every day. Begin with the summary, then drill into an item that needs attention. Before an event, check participation and the requests actually assigned to you. When asking for help, name the club, year, month or event and the task. Share the visible error wording if needed, but leave out passwords, private links and member health details. If your Clubs section is missing, ask the conference office to check your account access rather than making a second account.”

**Simple example to narrate:** “Overview shows that Riverton needs a Monthly Record. I open Monthly Records and locate October. I check whether it is Draft or Missing, open a submitted report if one exists, then ask the director about that specific item. Next I open Club events to confirm the club's registration for Honors Weekend.” This is a training sequence, not an automated reminder workflow.

## Source proof for the trainer/author

These references support the instructions but should not clutter the visible end-user slides. Source links can go in speaker notes or a final trainer appendix.

| Contract | Source |
|---|---|
| Coordinator grant, own attendee session and required second step; every active club | `modules/organizations/area-coordinators.ts`: `currentAreaCoordinator`, `currentAreaCoordinatorViewerActive`, `listClubsForArea` |
| Account entry and coordinator card | `app/(public)/account/(portal)/page.tsx`; `components/area-coordinator-card.tsx`; `modules/club-reports/area-card-domain.ts`: `areaCardLinks` |
| Top account Clubs entry | `app/(public)/account/(portal)/layout.tsx`, lines 72–75 |
| Seven exact coordinator tab labels | `components/area-clubs-subnav.tsx`, lines 3–10 |
| All clubs search supports club/church/city; own club versus view-only other clubs | `app/(public)/account/(portal)/clubs/page.tsx`, coordinator branch |
| Overview columns/search/downloads and year | `app/(public)/account/(portal)/area-clubs/overview/page.tsx`; `components/area-clubs-views.tsx`: `AreaClubsOverview` |
| Monthly state meanings and report links | `app/(public)/account/(portal)/area-clubs/reports/page.tsx`, lines 20–25; `modules/club-reports/area-summary-domain.ts`, lines 13–19 and 53–64; `components/area-clubs-views.tsx`: `AreaMonthlyReportsTable` |
| Points components, sort and full-scope rank | `app/(public)/account/(portal)/area-clubs/points/page.tsx`; `components/area-clubs-views.tsx`: `AreaPointsChart` |
| Year parsed from URL; export ignores q/name filter | `modules/club-reports/area-export.ts`, `resolveAreaClubYear` and `areaExportResponse`; `AreaExportLinks` only adds report and year |
| Event states, headcounts and search versus total | `app/(public)/account/(portal)/area-clubs/events/page.tsx`; `components/area-clubs-views.tsx`: `AreaClubEvents`; `modules/club-reports/area-summary-domain.ts`: `eventStatusLabels` |
| Team requests, own coordinator session and canDecide | `app/(public)/account/(portal)/area-clubs/team-permissions/page.tsx`; `modules/club-teams/permission-domain.ts`: `teamPermissionsIntro` |
| New club review is view-only | `app/(public)/account/(portal)/area-clubs/applications/page.tsx`, `canDecide={false}` |
| Individual club view-only notice and permitted tabs | `app/(public)/account/(portal)/area/[organizationId]/layout.tsx`; `modules/club-rosters/portal-nav.ts`: `areaClubPortalNavItems` |

## Screenshot guidance

I found no committed current coordinator application screenshot set under `docs/screenshots`. The existing `docs/design/role-workspaces/screenshots/coordinator-*.png` assets are **accepted synthetic design references**, not current deployed screenshots. The `docs/screenshots/issue-645` images are historical director/public-page typography captures and do not illustrate the coordinator workflow.

For this introductory presentation, either capture authorized synthetic data from the actual current application, or use clearly labelled instructional diagrams of the steps and exact menu labels. Do not pass a proposed coordinator mockup off as the current interface. Do not use real club member, guardian, health or invitation information in a training capture.
