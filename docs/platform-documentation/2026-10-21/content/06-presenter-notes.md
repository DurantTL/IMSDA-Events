# IMSDA Events: see it, try it — presenter notes

A visual orientation for club directors and Area Coordinators. The presentation follows fictional Riverton Pathfinders through ordinary tasks, then changes to a coordinator's view of the same records. These are screenshots of an isolated local copy of the current app, populated only with invented training records. They show implemented behavior at the source version recorded below; production configuration may affect which tools appear.

**Optional closing section:** slides 25–30 show other current tools, planned design/form-builder work and longer-term possibilities. These are capability illustrations, not application screenshots. Each slide labels its status; they do not promise a delivery date. Slide 31 finishes the session. For a task-only orientation, use slides 1–24 and 31.

**How to present:** show the screenshot, point to the numbered controls or visible result, then use the Say paragraph in your own words. Keep the detailed steps in these notes instead of reading long lists on screen. Pause for the question or a short practice task. For a single-role group, use the shared opening and its role section.

**Our fictional story:** Jordan Ellis directs Riverton Pathfinders. Morgan Reed is a fictional roster member. Alex Morgan is an Area Coordinator reviewing several fictional clubs. The program year is 2026–27. September records illustrate past submissions and unfinished work; October illustrates the director's current task. All names, contacts, counts and event registrations are examples, not real ministry records.

**Training setup:** screenshots were captured locally with synthetic accounts and records. No real invitations, emails, submissions or approvals were sent. Authentication examples exclude usable passwords, setup keys, recovery codes and private links. A saved draft is not a submitted report or confirmed event place. The coordinator's ordinary club oversight remains view only.

**Source version:** [7f77c1df](https://github.com/DurantTL/IMSDA-Events/commit/7f77c1dfeadd004deb51f91e2bae1b6c4754638b). See the screenshot capture register for individual routes, states and any crops. Crops enlarge the app's own pixels; annotations belong to the presentation and do not change app controls.

## 1. Follow a club through a real task

### Say

Today we are going to follow two people rather than read a list of features. Jordan directs Riverton Pathfinders. Alex is an Area Coordinator. We will see Jordan update the club, prepare a Monthly Record and choose who is going to Fall Camporee. Then we will see how Alex uses those saved records to offer help. Every person, club and event record in these screenshots is fictional. These are teaching examples from the current application, and your own assigned tools may differ.

### Point to or demonstrate

Point to the role labels on the two real application views. Keep the fictional-data label visible throughout the presentation.

### Visual example

- Jordan’s club Home: Riverton Home before the story:9active people,1report filed, FallCamporee open to register.
- Alex’s coordinator Overview: 2026–27 summaries for four fictional clubs after Jordan’s roster/report work.

### Preparation references — not spoken

- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/page.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-rosters/portal-nav.ts)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/area-clubs-subnav.tsx)

## 2. Keep the people. Choose the trip.

### Say

The first useful idea is the difference between belonging to the club and going to an event. Morgan appears on Riverton's roster. Jordan can choose Morgan for Fall Camporee without typing the same person again. Jordan still has to decide who is actually going and complete the event's choices. Adding someone to the roster does not register them for every event. Reports, forms and achievements also stay with their own saved records, so we can return to the information instead of asking for another copy.

### Ask the group

If Morgan is on the roster but not selected for Fall Camporee, is Morgan registered for the event?

### Visual example

- Club roster · who belongs: Actual roster after Add to roster saved Morgan Reed:10activepeople.
- Fall Camporee · who is going: Six fictional club members selected for Fall Camporee; actual Draft saved state.

### Preparation references — not spoken

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-roster-workspace.tsx)
- [components/club-registration-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-registration-workspace.tsx)

## 3. One website, several useful starting points

### Say

Everyone can begin at events dot imsda dot org. The homepage brings together the calendar, Find a club, My account and My club. You can look for an upcoming date without opening the director's workspace. When you need your own registrations or club tools, use Sign in on the page. The website chooses the available sign-in route, so you do not need to remember a special director or coordinator login address. A signed-in person may see My account instead.

### Point to or demonstrate

Optional: open Find a club from the homepage. Do not make a new club application for an already-established invited club.

### Visual example

- events.imsda.org: Public home in the current local application; fictional training records.
- Conference calendar: Public calendar in the current local application; fictional training records.

### Preparation references — not spoken

- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/page.tsx)
- [components/public-header-links.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/public-header-links.tsx)
- [app/(public)/calendar/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/calendar/page.tsx)

## 4. Use the account you already have

### Say

Jordan already has an account, so Jordan enters the existing email address and password and chooses Sign in. If you received a club invitation, use the account with that same address. If you have forgotten the password, choose Forgot password, request a code and keep this browser open while you check your email. Return here to enter the email code and new password. A passkey may also be offered if one is configured. Making a second account does not restore a missing club assignment.

### Point to or demonstrate

Use a blank password field. Never put a password, usable email code or private registration link in the capture.

### Visual example

- Account sign-in: Account sign-in with Jordan Ellis’s fictional email entered; password blank; no sign-in attempt sent.

### Preparation references — not spoken

- [components/attendee-sign-in-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/attendee-sign-in-form.tsx)
- [components/attendee-password-reset-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/attendee-password-reset-form.tsx)

## 5. An invitation connects the account to the club

### Say

For a new director, there are two different jobs. Creating and verifying an account confirms the email address. Accepting the invitation connects that account to the club. Create an account only if you do not have one already. Keep the same browser open while checking the emailed six-digit code, then Verify and continue. On the account page, check the club and role beside You're invited to manage a club, then Accept. If the invitation is absent, ask the office to check the address; do not apply to create the established club again. The grey digits in the empty verification box are a placeholder. The real email code must come from the message sent to your own address.

### Point to or demonstrate

The verification field stays empty. The invitation shown is an isolated fictional local fixture, with no reusable token or live link visible.

### Visual example

- New account · verify your email: Actual new-account email verification step, six-digit-code field left empty. Development-only code panel excluded.
- Account Overview · club invitation: The current invitation card for Riverton, captured in a600px-wide local browser so its club name and Accept action can be read together. Fictional invitation; not accepted.

### Preparation references — not spoken

- [components/attendee-sign-up-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/attendee-sign-up-form.tsx)
- [components/club-invite-accept.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-invite-accept.tsx)
- [modules/club-imports/invites.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-imports/invites.ts)

## 6. The extra step protects club information

### Say

Club and coordinator tools can open information about young people. The extra step helps protect that information if someone learns a password. If setup is needed, choose Set up an authenticator and follow the displayed instructions. Enter Code from your authenticator, then Confirm and turn on. Save the recovery codes privately and choose I've saved these codes. One supported method is enough; a passkey can also meet the requirement when offered. The email-verification code proves your address. The authenticator code is the extra sign-in protection. Neither is an event confirmation code. The grey 123456 in the empty box is a placeholder, not a code to copy from this slide. Use the current code from your own authenticator.

### Point to or demonstrate

Capture the challenge or pre-secret setup introduction only. Do not capture a setup key, QR secret, recovery codes or populated authenticator field. Which app should I use? can be demonstrated separately.

### Ask the group

Where does the email-verification code come from? Where does the authenticator code come from?

### Visual example

- Two-step sign-in: Current two-step challenge with an empty authenticator or recovery-code field.

### Preparation references — not spoken

- [app/(public)/account/two-step/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/two-step/page.tsx)
- [components/two-step-setup.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/two-step-setup.tsx)
- [components/mfa-manager.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/mfa-manager.tsx)

## 7. Open the tools for the job you are doing

### Say

The system shows the tools assigned to the signed-in account. Jordan uses My club, or My clubs if more than one club is assigned. Alex uses Clubs overview on the Area coordinator card; Clubs in the account navigation opens the club list. A person who has both assignments can see both kinds of tools. The coordinator side is not the system administrator dashboard, and it does not give every coordinator editing access to every club. If the expected option is missing, check the signed-in email and ask the office to verify the assignment.

### Visual example

- Jordan · director: Director Jordan Ellis’s account entry into the Riverton club workspace.
- Alex · Area Coordinator: Alex Morgan’s fictional account overview and Area coordinator entry after the training tasks.

### Preparation references — not spoken

- [app/(public)/account/(portal)/layout.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/layout.tsx)
- [modules/club-reports/area-card-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-reports/area-card-domain.ts)

## 8. Jordan starts with the next task

### Say

Jordan checks Riverton Pathfinders and the year shown at the top before changing anything. Home is a starting point rather than another form to complete. It brings together the next task, deadlines and summaries, with links such as Open roster and Open Monthly Records. Jordan can go directly to the work that needs attention. A deputy has the director's capabilities; a registrar or reporter may correctly see fewer sections. There is no universal year dropdown to search for on every page.

### Visual example

- Riverton Pathfinders · Home: Riverton Home before the story:9active people,1report filed, FallCamporee open to register.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/page.tsx)
- [components/club-year-tiles.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-year-tiles.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-rosters/portal-nav.ts)

## 9. Add Morgan once, then check the saved row

### Say

A new member, Morgan Reed, joins Riverton. Jordan first checks that Morgan is not already on the roster, then opens Add to roster. Jordan enters the requested information and saves it with Add to roster. The important part of the second screenshot is the result: Morgan now appears in the saved list. The application also explains that this person can be chosen when the club registers for an event. That is our next use of the record later in the story; it is not automatic event enrollment.

### Point to or demonstrate

Use only the synthetic fixture. Birth-date and age presentation follow the actual account permissions. Do not replace the current row icons with proposed labelled actions.

### Visual example

- Add to roster · fictional member: Filled fictional Morgan Reed fields in the actual Add to roster dialog.
- Morgan Reed is now listed: Actual roster after Add to roster saved Morgan Reed:10activepeople.

### Preparation references — not spoken

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-roster-workspace.tsx)

## 10. Correct the existing person

### Say

If Morgan's information changes, Jordan uses the person-specific Edit control rather than adding Morgan again. Save corrects the existing record. Deactivate has a different purpose: it keeps the person on file while omitting them from new registrations. Show inactive and Reactivate can bring that person back later. Remove is an erasure action with a warning that the birth date and details cannot be restored. It is not the ordinary way to mark someone absent or temporarily away.

### Point to or demonstrate

Show Edit and Deactivate. If explaining Remove, read the warning and cancel; the teaching story does not need to erase a person.

### Visual example

- Edit · Morgan’s existing record: Morgan Reed’s existing roster record, with current name, type and class visible.
- Finish · Save or Deactivate: Existing member dialog scrolled to Save and Deactivate actions; current member details are retained.

### Preparation references — not spoken

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-roster-workspace.tsx)
- [modules/club-rosters/repository.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-rosters/repository.ts)

## 11. A form can be started, sent or submitted

### Say

Forms shows the forms the conference has enabled for the club. A director or deputy can fill in for a member from the proper source or use the available private-link process. Jordan returns to Filled forms to see the result. Open continues a draft; View and print opens a submitted form. A sent request is not proof that the person submitted a response. Waiting, expired and submitted states mean different things. We are showing fictional names and state labels rather than personal health answers.

### Point to or demonstrate

Crop away any private URL or access token. Do not send a real request or show member health answers as part of the presentation.

### Visual example

- Start · choose the required form: Available club forms with a saved draft for Morgan Reed and a submitted transportation list.
- Return · read the saved state: Filled forms table distinguishes a Draft/Open permission slip from Submitted/View and print transportation list.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/forms/page.tsx)
- [modules/club-forms/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-forms/domain.ts)

## 12. Capture the October meeting while it is fresh

### Say

It is October in our example, and Jordan records a recent club meeting. From Monthly Records, Jordan opens October and chooses Add meeting note. The date, head counts and short notes are easier to enter while they are fresh. Take attendance is optional for someone who has roster access; a reporter with narrower access should not expect a named attendance list. Saving a meeting note does not by itself submit the month's report. October's current due date is November tenth, so Jordan can keep gathering notes before finishing it.

### Point to or demonstrate

Show the saved October seventeenth example in Edit meeting note. Point to the date, head counts, optional attendance and useful note. Explain that Add meeting note starts the same kind of record; Save is lower in the dialog.

### Visual example

- October · an existing meeting note: Fictional October17 meeting note: headcounts, Camping Skills I and a short activity note.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/records/page.tsx)
- [components/club-meeting-notes.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-meeting-notes.tsx)

## 13. Draft is a stopping point. Submitted is a result.

### Say

For this isolated training exercise, Jordan has complete fictional October records and an October report saved as a draft. A draft preserves unfinished work, but it has not been submitted. Jordan reviews the details and uses Submit report, then checks for the submitted result. This demonstrates the controls; it does not establish a policy to submit a real month before its records are complete. October is due November tenth. If meeting notes changed after the report was saved, Refresh from meeting notes is a deliberate action rather than a silent overwrite. September is already closed on our October twenty-first example date, so it is not the report to use for a submission demonstration.

### Point to or demonstrate

Both states must be captures of the same isolated fictional October report before and after submission. Mark this as an exercise with complete fictional records. Do not imply September can still be submitted after its closing date.

### Ask the group

Which screenshot proves that the report was submitted?

### Visual example

- October · draft still unfinished: Saved October draft; actual Save draft and Submit report ·410 points buttons.
- October · submitted result: Freshly loaded October record after actual submission:410 points,2320yearpoints and2submittedreports.

### Preparation references — not spoken

- [components/club-report-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-report-form.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/records/page.tsx)

## 14. Choose the people going to Fall Camporee

### Say

Now we use the roster for a different task. Jordan opens Club events and chooses Register or Continue for Fall Camporee. The current steps are Who's going, Each person's details and Review. Jordan selects the people attending, including Morgan if Morgan is going, then completes the location, class or other choices the event asks for. Some choices save automatically as a draft. That helps Jordan continue later, but it does not mean the registration is complete. Read full, waitlist and deadline messages before expecting a place.

### Visual example

- Fall Camporee · Who’s going: Six fictional club members selected for Fall Camporee; actual Draft saved state.

### Preparation references — not spoken

- [components/club-registration-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-registration-workspace.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/events/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/page.tsx)

## 15. Review, then return to the saved registration

### Say

The Review page is Jordan's chance to check the people and choices before submitting. The second view is the saved registration, reached again through View in Club events. Jordan checks the status rather than assuming every saved draft is registered. Save changes appears only when the event permits editing. Print club packet or Download registration PDF can provide an authorized working copy. For a church-billed event, the sponsoring church follows the office billing process; this is not a new personal payment obligation for the director. Keep copies within their intended audience.

### Point to or demonstrate

Capture a local fictional event submission only. If a confirmation code is visible, it must belong solely to the isolated demo fixture; no private edit/manage link should appear.

### Visual example

- Before submitting · Review: Final current-app review for six fictional Fall Camporee attendees, with church invoice facts and Submit registration.
- After submitting · saved registration: Existing Fall Camporee registration after actual local submission, with six attendees and editing/printing controls. Published crop shows confirmation and billing text; the local check-in QR is excluded.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/%5BeventId%5D/page.tsx)
- [components/club-registration-editor.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-registration-editor.tsx)
- [docs/INVOICES.md](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/docs/INVOICES.md)

## 16. Turn club records into useful follow-up

### Say

Jordan can record a completed honor through Honors, including Add honors to several members when appropriate. Class tracking handles the supported earned class and award items; it is not a generic checklist for every curriculum requirement. Orders helps prepare supply lists, check stock and track hand-outs. It is not an online store checkout. For a roster file, Jordan uses Build a roster export, checks Preview and downloads the columns needed for the task. These are working copies of the records, so the recipient and fields still matter.

### Point to or demonstrate

If Honors and export cannot both fit legibly, use one large export preview and an optional Honors inset; keep menu references in the spoken notes.

### Visual example

- Honors · fictional earned records: Honor records with4completed and4inprogress entries across fictional members.
- Roster export · preview first: Real roster export Preview:first5of10fictionalrows, before DownloadCSV.

### Preparation references — not spoken

- [components/club-honors-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-honors-workspace.tsx)
- [components/roster-export-builder.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/roster-export-builder.tsx)
- [components/club-order-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-order-workspace.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/class-tracking/page.tsx)

## 17. Alex finds Riverton and opens a view-only record

### Say

Now we follow Alex. All clubs is the place to find a known club by its name, church or city. Alex searches for Riverton and chooses Open. The club view says View only and shows the information this role is permitted to read, such as ages instead of full birth dates. Coordinator access does not turn into a director's editing menu. Someone who separately directs their own club can have actual editing authority there, but that is a separate assignment. The current club list contains active clubs; do not expect an enforced my-area filter.

### Visual example

- All clubs · search by club, church or city: All clubs with four fictional club records.
- Riverton · coordinator view: Riverton Pathfinders opened in the coordinator’s view-only workspace after Jordan’s tasks.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/clubs/page.tsx)
- [app/(public)/account/(portal)/area/[organizationId]/layout.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area/%5BorganizationId%5D/layout.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-rosters/portal-nav.ts)

## 18. Use Overview to decide where help is needed

### Say

Overview helps Alex decide where to look first. Alex checks the year in the heading, then reads the roster counts, reports submitted, total points and last report. Different rows deliberately show different fictional clubs, so we can compare their situations. Sterling Volunteers appears as summary counts; a count by itself does not tell the whole person's story. Alex opens the relevant club before contacting its director. Clicking a summary does not clear the underlying task, and there is no general Send reminder action established by this screen.

### Visual example

- 2026–27 · club summaries: 2026–27 summaries for four fictional clubs after Jordan’s roster/report work.

### Preparation references — not spoken

- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/area-clubs-views.tsx)
- [app/(public)/account/(portal)/area-clubs/overview/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area-clubs/overview/page.tsx)

## 19. Read the status before asking for a report

### Say

Alex uses Monthly Records to identify a particular club and month. A points value links to a submitted report, which Alex can read rather than asking for another copy. Riverton's September report was submitted October eighth. Another fictional club's overdue September draft and a third club's missing September report show different follow-up situations. Draft means started but not submitted. Due is not the same as Missing: Missing means the due date has passed without submission. A saved draft can still say Draft after the due date. Future months are not yet due, and late submissions are labelled late. In our October twenty-first example, September was due October tenth; October is due November tenth. Read the actual state before asking the director what is missing.

### Point to or demonstrate

Use multiple fictional rows: at least one overdue draft, one missing prior month and one submitted/late month. Do not label October Missing on October21.

### Ask the group

Which club has already submitted the month? Which has started but still needs to finish?

### Visual example

- Monthly Records · compare club/month states: Monthly Records grid after Jordan submits October: Riverton September410 and October410.
- A submitted month · read the saved report: Riverton’s submitted September Monthly Record.

### Preparation references — not spoken

- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/area-clubs-views.tsx)
- [modules/club-reports/area-summary-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-reports/area-summary-domain.ts)
- [app/(public)/account/(portal)/area-clubs/reports/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area-clubs/reports/page.tsx)

## 20. Explain a total rather than guessing

### Say

The chart gives Alex a quick comparison, and the table explains the same totals. Submitted-report points and yearly registration points are shown separately. The current rule adds fifteen hundred points for an on-time yearly registration. Alex can sort by points or club name. A name search narrows the visible rows, while ranking is based on the full list. Download points CSV includes the whole year's authorized clubs, not just the name search on screen. Check the file before sharing it, especially if you expected one club's record.

### Visual example

- Points · chart and table: Points chart and table after both Riverton reports are submitted.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/points/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area-clubs/points/page.tsx)
- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/area-clubs-views.tsx)
- [modules/club-reports/area-export.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-reports/area-export.ts)

## 21. Club membership is not event participation

### Say

Before Fall Camporee, Alex opens Club events. The useful question is which clubs are participating and how many people are included. The rows show deliberately varied fictional states. Draft is not a completed registration, waitlisted is not a confirmed place, and cancelled is historical. A search can narrow the club rows while the event total continues to describe all registered clubs. Alex uses the specific event state for follow-up; this page does not let every coordinator submit or edit every club's registration.

### Visual example

- Fall Camporee · clubs and headcounts: Fall Camporee club registrations: Registered, Draft, Waitlisted and Cancelled.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/events/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area-clubs/events/page.tsx)
- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/area-clubs-views.tsx)
- [modules/club-reports/area-summary-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-reports/area-summary-domain.ts)

## 22. Read a new-club application without approving it

### Say

Alex can read the fictional Harbor Adventurers application and understand what the applicant supplied. New clubs is a view-only review page for coordinators; a system administrator approves or declines the application. Team approvals is a separate, narrow exception: a coordinator may decide the eligible requests assigned to that coordinator under the event rules. Neither exception gives general editing rights to every club.

### Point to or demonstrate

Point to New clubs, the Harbor Adventurers application and the view-only heading. There is no coordinator approval action on this page. Mention Team approvals only if relevant to the audience; use its own event rules and permitted requests.

### Ask the group

Who makes the decision on this new-club application?

### Visual example

- New clubs · fictional pending application: Harbor Adventurers’ fictional pending application in the coordinator’s view-only New clubs page.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/team-permissions/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area-clubs/team-permissions/page.tsx)
- [modules/club-teams/permission-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/modules/club-teams/permission-domain.ts)
- [app/(public)/account/(portal)/area-clubs/applications/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/area-clubs/applications/page.tsx)

## 23. Make the follow-up specific

### Say

This is the practical connection between the two roles. Alex sees Riverton's October draft and asks Jordan a precise question: Riverton's October record is in progress; do you need help preparing it? October is not overdue on October twenty-first. In this exercise Jordan has complete fictional records, reviews the report and submits through the club workspace; Alex can then read that result. The conversation happens through the normal conference process. Opening Overview has not sent an automatic reminder, and Alex has not taken over the director's report. The screenshots represent before and after moments in the same fictional story. An older closed missing month needs follow-up with the director or office; do not promise Alex can reopen it.

### Point to or demonstrate

Mark the two screenshots Before follow-up and After director submission to avoid contradictory state expectations. Any speech bubble is an instructor caption, not an app messaging feature.

### Visual example

- Before · Alex sees October in progress: Before Jordan finishes October: coordinator grid shows Riverton September410points and OctoberDraft.
- After · Jordan submits the complete example: Freshly loaded October record after actual submission:410 points,2320yearpoints and2submittedreports.

### Preparation references — not spoken

- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/area-clubs-views.tsx)
- [components/club-report-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/club-report-form.tsx)

## 24. When something is missing, check the account first

### Say

If sign-in works but the club or Clubs section is missing, first check the signed-in email. The office can verify the invitation or coordinator assignment. If the password is the problem, use Forgot password instead. If an authenticator is unavailable, use a saved recovery code or configured passkey when offered; ask the office if neither is available. For a page or save problem, give support the club and year, or the event, the page, what you tried and the visible error. Do not include passwords, codes, private links or member health details in a screenshot. The existing quick-start guide can help you describe the exact step.

### Visual example

- Account Overview · signed-in identity: Director Jordan Ellis’s account entry into the Riverton club workspace.

### Preparation references — not spoken

- [components/attendee-password-reset-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/attendee-password-reset-form.tsx)
- [app/(public)/account/help/authenticator/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/help/authenticator/page.tsx)
- [app/(public)/account/(portal)/layout.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/%28public%29/account/%28portal%29/layout.tsx)

## 25. More club tools are already here

### Say

The walkthrough showed the tasks people often need first. There are other current club tools to use through the year. Class tracking records supported earned items, including class insignia and event patches; it is not a universal checklist for every curriculum requirement. Orders helps the club organize needed supplies, stock and hand-outs rather than taking an online payment. Year-end reports bring together the year's recorded work for review. Jordan should still check the club, year and actual saved information before making a change or submitting a report. The tools shown depend on the person's club role.

### Point to or demonstrate

Use this capability map to explain the purpose of Class tracking, Orders and the year-end report. These are infographic labels, not new app controls. Refer back to the current club navigation if someone wants to practice.

### Ask the group

Which of these tools would help your club avoid maintaining a second list?

### Capability status

CURRENT. The same club records support achievements, supplies and year-end reporting.

### Preparation references — not spoken

- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/club-rosters/portal-nav.ts)
- [modules/earned-awards/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/earned-awards/domain.ts)
- [modules/club-orders/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/club-orders/domain.ts)
- [modules/club-supplies/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/club-supplies/domain.ts)
- [modules/club-reports/year-end-repository.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/club-reports/year-end-repository.ts)
- [Roadmap / issue #41](https://github.com/DurantTL/IMSDA-Events/issues/41)
- [Roadmap / issue #184](https://github.com/DurantTL/IMSDA-Events/issues/184)
- [Roadmap / issue #185](https://github.com/DurantTL/IMSDA-Events/issues/185)

## 26. Event teams have tools before, during and after

### Say

IMSDA Events also supports the people running an event. Beforehand, authorized staff prepare its public information, publish a versioned form and manage registrations, capacity and waitlists. They can review event communications through the configured email service. On arrival, staff have pass, check-in, roster and badge tools. Financial staff have their permitted invoice, payment and reporting workflows. Lodging and meal tools can be used when the event's inventory, plans and settings are prepared. These capabilities belong to the appropriate event and staff permissions. A director or Area Coordinator assignment does not by itself provide the event team's administrative tools.

### Point to or demonstrate

Follow the map from preparation to arrival to follow-up. Explain that configured provider delivery, lodging inventory, meal setup and payment setup are separate from the existence of the tools. This overview is not a live production readiness claim.

### Ask the group

Which team owns each step at your next event?

### Capability status

CURRENT. Event staff use assigned permissions; available options depend on the event and its setup.

### Preparation references — not spoken

- [docs/STAFF-EVENT-WORKFLOW.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/STAFF-EVENT-WORKFLOW.md)
- [docs/EVENT-FEATURES.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/EVENT-FEATURES.md)
- [modules/forms/repository.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/forms/repository.ts)
- [modules/checkin/README.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/checkin/README.md)
- [modules/communications/effective-delivery.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/communications/effective-delivery.ts)
- [docs/BILLING-RESPONSIBILITY.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/BILLING-RESPONSIBILITY.md)
- [docs/LODGING.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/LODGING.md)
- [docs/MEALS.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/MEALS.md)
- [Roadmap / issue #73](https://github.com/DurantTL/IMSDA-Events/issues/73)
- [Roadmap / issue #75](https://github.com/DurantTL/IMSDA-Events/issues/75)
- [Roadmap / issue #77](https://github.com/DurantTL/IMSDA-Events/issues/77)
- [Roadmap / issue #194](https://github.com/DurantTL/IMSDA-Events/issues/194)
- [Roadmap / issue #197](https://github.com/DurantTL/IMSDA-Events/issues/197)
- [Roadmap / issue #212](https://github.com/DurantTL/IMSDA-Events/issues/212)
- [Roadmap / issue #779](https://github.com/DurantTL/IMSDA-Events/issues/779)

## 27. Planned: make the next task easier to find

### Say

One improvement is how people recognize the work already available. The accepted role-workspace direction gives the different roles a consistent visual language while keeping their own navigation, priorities and access. Other tracked work includes clearer list columns and icons, saved task views, public-page and link previews, calendar and club-finder refinements, and guidance near the task. These are improvements to the same jobs we practiced. The accepted layout direction is a reference for implementation, not a released interface. The public-page studies have their own review status. This overview does not add another administrator menu change or give broader permissions to a role. Two operational examples in the ordered roadmap are the administrator alert feed with read and unread states, and kitchen money closeout. Those belong to their respective staff responsibilities; they are not new coordinator or attendee permissions.

### Point to or demonstrate

Read the status attached to each track. Explain the difference between accepted design direction and proposed or planned work. No future app screen is pictured on this slide.

### Ask the group

Where do people most often hesitate or ask where to go next?

### Capability status

PLANNED. The aim is easier learning while each role keeps its own responsibilities and access.

### Preparation references — not spoken

- [docs/design/role-workspaces/README.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/design/role-workspaces/README.md)
- [docs/design/role-workspaces/evidence/role-contract.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/design/role-workspaces/evidence/role-contract.md)
- [docs/design/public-journeys-and-lists/review.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/design/public-journeys-and-lists/review.md)
- [docs/design/public-journeys-and-lists/existing-owner-notes.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/design/public-journeys-and-lists/existing-owner-notes.md)
- [Roadmap / issue #98](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Roadmap / issue #1109](https://github.com/DurantTL/IMSDA-Events/issues/1109)
- [Roadmap / issue #1111](https://github.com/DurantTL/IMSDA-Events/issues/1111)
- [Roadmap / issue #1112](https://github.com/DurantTL/IMSDA-Events/issues/1112)
- [Roadmap / issue #1113](https://github.com/DurantTL/IMSDA-Events/issues/1113)
- [Roadmap / issue #1074](https://github.com/DurantTL/IMSDA-Events/issues/1074)
- [Roadmap / issue #1077](https://github.com/DurantTL/IMSDA-Events/issues/1077)
- [Roadmap / issue #1103](https://github.com/DurantTL/IMSDA-Events/issues/1103)
- [Roadmap / issue #1115](https://github.com/DurantTL/IMSDA-Events/issues/1115)
- [Roadmap / issue #1117](https://github.com/DurantTL/IMSDA-Events/issues/1117)
- [Roadmap / issue #1118](https://github.com/DurantTL/IMSDA-Events/issues/1118)
- [Roadmap / issue #1033](https://github.com/DurantTL/IMSDA-Events/issues/1033)
- [Roadmap / issue #212](https://github.com/DurantTL/IMSDA-Events/issues/212)

## 28. Planned: make forms easier to build and maintain

### Say

Forms already have explicit drafts, preview and test tools, and published versions that keep older submissions tied to their original form version. The roadmap aims to make creating and maintaining those forms easier. Its ordered foundation work includes preparing the builder, app-editable form starters, and notices about changes to their source. Later visual work covers a clearer editing workspace, reusable questions, phone editing and combined visibility rules. Those later steps still require their own design review. A changed starter should not silently rewrite a form someone is already using. This is the planned direction, with no release date announced here.

### Point to or demonstrate

Begin with the takeaway so listeners know which controls already exist. Then follow the planned foundations and the later reviewed tools. Keep engineering extraction and build-queue details in preparation references rather than the spoken explanation.

### Ask the group

Would a clearer editor, reusable starter or reusable question save you the most work?

### Capability status

PLANNED. Drafts and publishing already exist. Planned tools make forms easier to build and maintain.

### Preparation references — not spoken

- [docs/STAFF-EVENT-WORKFLOW.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/STAFF-EVENT-WORKFLOW.md)
- [modules/forms/repository.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/forms/repository.ts)
- [modules/forms/seeded-templates.ts](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/modules/forms/seeded-templates.ts)
- [docs/design/public-journeys-and-lists/review.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/design/public-journeys-and-lists/review.md)
- [Roadmap / issue #98](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Roadmap / issue #1062](https://github.com/DurantTL/IMSDA-Events/issues/1062)
- [Roadmap / issue #1063](https://github.com/DurantTL/IMSDA-Events/issues/1063)
- [Roadmap / issue #1064](https://github.com/DurantTL/IMSDA-Events/issues/1064)
- [Roadmap / issue #1065](https://github.com/DurantTL/IMSDA-Events/issues/1065)
- [Roadmap / issue #1069](https://github.com/DurantTL/IMSDA-Events/issues/1069)
- [Roadmap / issue #1070](https://github.com/DurantTL/IMSDA-Events/issues/1070)
- [Roadmap / issue #1071](https://github.com/DurantTL/IMSDA-Events/issues/1071)
- [Roadmap / issue #1072](https://github.com/DurantTL/IMSDA-Events/issues/1072)

## 29. A full camp workflow could build on this foundation

### Say

A residential camp needs more than a registration and a bed assignment. The current lodging, meal, registration and check-in foundations could support future work. Camp operations would also need clear cabin and counselor responsibility, activity scheduling, guardian consent, appropriate care access, transport and authorized pickup. Those roles and policies must be designed deliberately. UltraCamp is a separate, optional discovery path in the later roadmap. Its allowed data, licensing and API coverage need confirmation, especially for protected forms and care information. We have a separate camp discovery document so this possibility can be assessed without claiming that a complete camp system or automatic synchronization is already available.

### Point to or demonstrate

Follow the diagram from existing foundations through camp responsibility gaps to the optional vendor boundary. Describe this as a capability discussion, not an announced replacement or integration plan.

### Ask the group

Which camp responsibility is hardest to manage reliably today?

### Capability status

POSSIBLE. A camp system adds care, supervision and release responsibilities beyond a lodging reservation.

### Preparation references — not spoken

- [docs/LODGING.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/LODGING.md)
- [docs/MEALS.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/MEALS.md)
- [docs/decisions/0005-protected-records-policy.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/decisions/0005-protected-records-policy.md)
- [docs/decisions/0011-personnel-pipeline-policy.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/decisions/0011-personnel-pipeline-policy.md)
- [docs/platform-documentation/2026-10-21/content/04-camp-system-and-ultracamp.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/platform-documentation/2026-10-21/content/04-camp-system-and-ultracamp.md)
- [Roadmap / issue #98](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Roadmap / issue #65](https://github.com/DurantTL/IMSDA-Events/issues/65)
- [Roadmap / issue #71](https://github.com/DurantTL/IMSDA-Events/issues/71)
- [Roadmap / issue #78](https://github.com/DurantTL/IMSDA-Events/issues/78)
- [Roadmap / issue #79](https://github.com/DurantTL/IMSDA-Events/issues/79)
- [Roadmap / issue #89](https://github.com/DurantTL/IMSDA-Events/issues/89)
- [Roadmap / issue #237](https://github.com/DurantTL/IMSDA-Events/issues/237)
- [Roadmap / issue #238](https://github.com/DurantTL/IMSDA-Events/issues/238)

## 30. Longer-term possibilities to develop

### Say

There are further possibilities beyond the changes to everyday screens. Adventurer ministry has its own program, materials and scope decisions. Wallet passes could build on the web passes that already exist; a native mobile experience would also need its own provider, privacy and offline rules. Merchandise checkout remains on hold, and a camp-store account would be a larger project than today's Orders helper. Surveys, certificates and recorded outcomes could improve follow-up after an event. These items have different levels of detail and different dependencies. They are possibilities on the longer roadmap, not an announcement that everything is approved, scheduled or available now. Donations, fundraising and designated funds are another later track, separate from current church invoicing and the Orders helper.

### Point to or demonstrate

Point to the different status labels. Ask for useful examples of need rather than presenting a delivery schedule. The canonical roadmap remains the source of implementation order.

### Ask the group

Which future outcome would solve a concrete problem for your club or event team?

### Capability status

POSSIBLE. Future scope follows the existing roadmap, decisions and event needs; no delivery dates are set.

### Preparation references — not spoken

- [docs/NEW-CLUB-APPLICATIONS.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/NEW-CLUB-APPLICATIONS.md)
- [docs/ATTENDEE-ACCOUNT-RELEASE.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/ATTENDEE-ACCOUNT-RELEASE.md)
- [docs/MERCHANDISE-LEDGER-MIGRATION.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/MERCHANDISE-LEDGER-MIGRATION.md)
- [docs/decisions/0011-personnel-pipeline-policy.md](https://github.com/DurantTL/IMSDA-Events/blob/2cac4150c2b237b02190495d931e6bffb2189184/docs/decisions/0011-personnel-pipeline-policy.md)
- [Roadmap / issue #98](https://github.com/DurantTL/IMSDA-Events/issues/98)
- [Roadmap / issue #840](https://github.com/DurantTL/IMSDA-Events/issues/840)
- [Roadmap / issue #841](https://github.com/DurantTL/IMSDA-Events/issues/841)
- [Roadmap / issue #842](https://github.com/DurantTL/IMSDA-Events/issues/842)
- [Roadmap / issue #843](https://github.com/DurantTL/IMSDA-Events/issues/843)
- [Roadmap / issue #53](https://github.com/DurantTL/IMSDA-Events/issues/53)
- [Roadmap / issue #91](https://github.com/DurantTL/IMSDA-Events/issues/91)
- [Roadmap / issue #226](https://github.com/DurantTL/IMSDA-Events/issues/226)
- [Roadmap / issue #227](https://github.com/DurantTL/IMSDA-Events/issues/227)
- [Roadmap / issue #228](https://github.com/DurantTL/IMSDA-Events/issues/228)
- [Roadmap / issue #54](https://github.com/DurantTL/IMSDA-Events/issues/54)
- [Roadmap / issue #146](https://github.com/DurantTL/IMSDA-Events/issues/146)
- [Roadmap / issue #147](https://github.com/DurantTL/IMSDA-Events/issues/147)
- [Roadmap / issue #148](https://github.com/DurantTL/IMSDA-Events/issues/148)
- [Roadmap / issue #90](https://github.com/DurantTL/IMSDA-Events/issues/90)
- [Roadmap / issue #233](https://github.com/DurantTL/IMSDA-Events/issues/233)
- [Roadmap / issue #234](https://github.com/DurantTL/IMSDA-Events/issues/234)
- [Roadmap / issue #235](https://github.com/DurantTL/IMSDA-Events/issues/235)
- [Roadmap / issue #95](https://github.com/DurantTL/IMSDA-Events/issues/95)

## 31. Check the result. Sign out. Return to the same place.

### Say

The aim is not to memorize every menu. Use your own account, choose the right club or coordinator view and check the result of the work. A saved draft, a submitted report and an event registration confirmation mean different things. Choose one realistic task to practice next: a director can find the roster or a Monthly Record; a coordinator can find a club and read one month. Then choose Sign out, especially on a shared device. Closing a tab is not the same action. Next time, return to events dot imsda dot org and sign in with the account you already have.

### Ask the group

Which one task will you practice first? Use the quick-start handout when you need the steps.

### Visual example

- Example · a saved registration: Existing Fall Camporee registration after actual local submission, with six attendees and editing/printing controls. Published crop shows confirmation and billing text; the local check-in QR is excluded.
- Use Sign out before leaving: Account Profile and the actual Sign out control in the portal header.

### Preparation references — not spoken

- [components/attendee-sign-out-button.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/components/attendee-sign-out-button.tsx)
- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/7f77c1dfeadd004deb51f91e2bae1b6c4754638b/app/page.tsx)
