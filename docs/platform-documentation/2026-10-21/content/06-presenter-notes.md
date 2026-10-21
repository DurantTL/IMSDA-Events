# IMSDA Events: getting started — presenter notes

Use this spoken guide with the 31-slide presentation for club directors and Area Coordinators. Introduce why the system helps, show how to sign in, then follow the tasks for the audience's role. The technical review, code checks and future planning remain in the separate reports.

**Suggested route:** slides 1–10 introduce the system and sign-in; 11–19 cover directors; 20–27 cover Area Coordinators; 28–31 cover routines, help and finishing safely. For a single-role group, use its section after the common introduction.

**Before presenting:** check the current website labels and use an approved training account with fictitious records. The numbered task illustrations are teaching aids, not product screenshots or proposed menus. Keep live invitations, setup keys, recovery codes, private links and member information out of the demonstration. Stop before a real submission, erasure or approval unless it is part of an authorized training exercise.

**How to use the notes:** read or adapt the Say paragraph. Show or demonstrate gives an optional screen action. Ask the group is an optional check for understanding. Preparation references support the trainer and do not need to be read aloud.

## 1. IMSDA Events Getting started

### Say

IMSDA Events is our shared place for club records and event participation. Today we will follow the tasks you are most likely to need: signing in, keeping a club's information up to date, registering for an event and reviewing clubs as a coordinator. You do not need to understand the software behind it. Start with your own account and the job you are doing.

### Show or demonstrate

Open events.imsda.org. For demonstrations, use an approved training account and fictitious records. The step illustrations in this deck are teaching aids, not screenshots or proposed menus.

### Preparation references — not spoken

- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/page.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/portal-nav.ts)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-subnav.tsx)

## 2. Why we use IMSDA Events

### Say

The purpose is to make ongoing club work and event work easier to connect. A director maintains the club's information. When an event opens, that roster is available for choosing who will attend. Coordinators use the same recorded work to understand progress and offer help. Returning to the saved record is more useful than keeping several different versions of a list.

### Ask the group

Which task currently makes you re-enter information or ask for another copy of a record?

### Preparation references — not spoken

- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/page.tsx)
- [docs/CLUB-MINISTRY-AND-HONORS-WEEKEND-PLAN.md](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/docs/CLUB-MINISTRY-AND-HONORS-WEEKEND-PLAN.md)

## 3. Know which job you are doing

### Say

These ideas are related, but they answer different questions. Putting someone on the roster does not register that person for every event. A report being submitted does not mean an event registration is paid or checked in. Your account connects you to the responsibilities assigned to you. If you are both a director and a coordinator, choose the workspace for the task you are doing.

### Ask the group

If a new member is on the roster, are they automatically registered for Honors Weekend? The answer is no.

### Preparation references — not spoken

- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/portal-nav.ts)
- [modules/club-reports/area-summary-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-reports/area-summary-domain.ts)

## 4. Begin at the same website

### Say

Everyone can start at events dot imsda dot org. Use the Sign in button on the website; it takes you to the sign-in page available on the system. You do not need a special director or coordinator login address. If you are already signed in, the page can show My account instead. Use the account that received your invitation or was assigned your coordinator access.

### Show or demonstrate

Point to Sign in, My account and My club on the current homepage. A configured passkey may also be offered. Do not teach a fixed /login or /sign-in path.

### Preparation references — not spoken

- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/page.tsx)
- [components/public-header-links.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/public-header-links.tsx)
- [components/attendee-sign-in-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/attendee-sign-in-form.tsx)

## 5. New director? Accept the club invitation

### Say

The invitation is what connects your account to a club. Creating an account by itself does not complete that connection. If you already have an account at the invited address, sign in to it. If you are new, create and verify the account first. On your account page, find You're invited to manage a club, check the club name and role, and choose Accept. If the invitation is missing, ask the office to check the address rather than making another account or applying to create the club again.

### Show or demonstrate

Point out the invitation card and Accept label using a training example. Do not accept a real invitation as a general demonstration.

### Preparation references — not spoken

- [modules/club-imports/invites.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-imports/invites.ts)
- [components/club-invite-accept.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/club-invite-accept.tsx)

## 6. Creating an account: verify your email

### Say

Create an account asks for your name, email and a password that meets the checklist. The system emails a six-digit code. Keep the same browser open, then return to enter that code and choose Verify and continue. The current email code expires after twenty minutes. This confirms that you control the address. It is not the authenticator code we will use for the club's extra sign-in protection.

### Show or demonstrate

Explain the same-browser verification step without displaying a real code or inbox. After verification, return to the club invitation and accept it.

### Preparation references — not spoken

- [components/attendee-sign-up-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/attendee-sign-up-form.tsx)

## 7. Returning users: sign in and continue

### Say

When you return, use the account you already set up. Sign in, then complete Confirm it's you if asked. That might be your authenticator code or a supported passkey. An unused recovery code can help if you cannot use the authenticator. Once the system has confirmed you, open the club or coordinator tools for the work you need to do.

### Show or demonstrate

Point to the actual sign-in labels. Explain a passkey as the device fingerprint, face or PIN prompt when the system offers that option.

### Preparation references — not spoken

- [components/attendee-sign-in-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/attendee-sign-in-form.tsx)
- [app/(public)/account/two-step/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/two-step/page.tsx)

## 8. Why the extra sign-in step matters

### Say

The extra step protects club information if someone learns a password. You only need one supported method. An authenticator app generates a short code. A passkey asks your device for a fingerprint, face or PIN. The email verification code confirms the email address; the authenticator or passkey protects access to the club and coordinator tools. Saving recovery codes now can prevent a lost phone from becoming a long interruption later.

### Ask the group

Which code comes from your email, and which comes from your authenticator app?

### Preparation references — not spoken

- [app/(public)/account/two-step/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/two-step/page.tsx)
- [components/two-step-setup.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/two-step-setup.tsx)

## 9. Set up an authenticator when prompted

### Say

Choose Set up an authenticator. The help link explains suitable apps, including Google Authenticator and Microsoft Authenticator. Follow the screen to add the account to your app using the setup information shown. Then enter the code from the app and choose Confirm and turn on. Save the recovery codes somewhere private and choose I've saved these codes. Continue when setup is complete. A passkey is another method if the site offers it; you do not have to set up both.

### Show or demonstrate

Use the help page to explain adding an account. The current setup component shows a text key; do not promise a QR image on every setup screen. Never display a usable setup key or recovery code in a presentation.

### Preparation references — not spoken

- [components/mfa-manager.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/mfa-manager.tsx)
- [components/two-step-setup.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/two-step-setup.tsx)
- [app/(public)/account/help/authenticator/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/help/authenticator/page.tsx)

## 10. Open the workspace for your responsibility

### Say

The tools follow your actual responsibilities. A director works inside the club. An Area Coordinator has a Clubs section and a Clubs overview link on the account card. Your personal registrations are separate from running a club. Someone with both responsibilities may see both sets of tools. If the expected option is missing, check which email is signed in and ask the office about access; making a duplicate account is unlikely to solve it.

### Show or demonstrate

Explain My club/My clubs versus the coordinator Clubs navigation. Current club and coordinator headings show the working year; do not invent a year dropdown.

### Preparation references — not spoken

- [app/(public)/account/(portal)/layout.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/layout.tsx)
- [modules/club-reports/area-card-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-reports/area-card-domain.ts)

## 11. Directors: start at your club Home

### Say

Home is the starting point for the club's work. It is not another form to complete. Check the club name and year at the top, especially if you manage more than one club. The next-task card and summaries help you decide where to go. Our example club is Riverton Pathfinders. A deputy has the director's capabilities; registrar and reporter roles are narrower, so their menus can correctly look different.

### Show or demonstrate

Point to the current club header, next task and Open roster/Open Monthly Records links. These are current labels, not the separate accepted redesign.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/page.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/portal-nav.ts)

## 12. Add a member to the roster

### Say

Add regular members to the roster so they are available for future event choices. For a demonstration, use a fictitious member such as Morgan Reed. First check that Morgan is not already there. Enter the requested details, choose Add to roster and check the saved row. This has put Morgan on the club's list; it has not registered Morgan for an event. If Morgan is already listed, correct the existing record instead of adding a duplicate.

### Show or demonstrate

Use an approved training roster only. Explain that age and birth-date fields follow the viewer’s permitted access; no real birth date is needed for the teaching example.

### Preparation references — not spoken

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/club-roster-workspace.tsx)

## 13. Update a member without losing their history

### Say

These actions have different purposes. Edit corrects the existing person. Deactivate keeps the person in your records but stops them being selected for new registrations. Show inactive lets you find that person, and Reactivate can bring them back. Remove is an erasure action. If someone may return, keeping the record is generally the useful path. Read the explanation before any removal and ask the office if you are unsure what should be retained.

### Show or demonstrate

Point out the pencil/Edit action, Save and Deactivate inside the editor. If showing Remove, stop at its explanation and cancel; do not erase a real person for training.

### Preparation references — not spoken

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/club-roster-workspace.tsx)
- [modules/club-rosters/repository.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/repository.ts)

## 14. Collect and find club forms

### Say

Forms keeps the club's enabled forms together. A director or deputy can fill in for a member from an appropriate approved source or use the available private-link process. Return to Filled forms to see what came back. Open continues a draft; View and print opens a submitted form. A link can be waiting, expired or submitted, and an email saying sent does not mean the form has been completed.

### Show or demonstrate

Use an empty or fictitious example without health content. Explain the link option without sending a real request during the presentation.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/forms/page.tsx)
- [modules/club-forms/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-forms/domain.ts)

## 15. After a meeting: record it while it is fresh

### Say

Short notes after a meeting are easier than rebuilding the whole month from memory. Open Monthly Records, choose the month and add a meeting note. Record the date and counts you know. People with roster access may also take name-by-name attendance; that is optional and is not promised to a reporter who cannot open the roster. Save the note so the information is there when you prepare the monthly report.

### Show or demonstrate

Show Add meeting note and the optional Take attendance control. Keep the distinction between head counts and a named attendance list clear.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/records/page.tsx)

## 16. Finish and submit the Monthly Record

### Say

Saving a draft and submitting are different actions. Open or continue the Monthly Record, review its details and check the month and due date. The current rule is the tenth of the following month. Meeting notes can help fill the record. If you have already saved the report, changing a note does not silently replace that saved report; use Refresh from meeting notes deliberately if offered. Once you are ready, Submit report and confirm the submitted result. Contact the office if a closed report needs attention.

### Show or demonstrate

Point out Save draft versus Submit report, and the displayed status. Do not submit a real report as a demonstration.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/records/page.tsx)
- [components/club-report-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/club-report-form.tsx)

## 17. Register the people who are going

### Say

This is where the roster saves time. Open Club events and use Register or Continue for the event. Choose the people attending rather than assuming everyone on the roster is going. The flow is Who's going, Each person's details and Review. Some draft choices save as you work, but the draft is not a confirmed registration. Review the final state and any full or waitlist explanation. Team events may use Your teams and an additional team form.

### Show or demonstrate

Use a fictitious training event. Stop at Review unless a training submission has been authorized. Point to the three current step labels.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/events/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/page.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/%5BeventId%5D/page.tsx)

## 18. Return to a registration you already made

### Say

Return to the saved registration instead of starting another one just to check it. The page shows what was recorded and whether changes are still permitted. If Save changes is offered, use it and check the result. If the edit window is closed, contact the event team. Church-billed events use the sponsoring church's office billing process; submitting as director does not make the director personally responsible for an online balance. The packet and PDF are useful authorized working copies; keep them within the intended audience.

### Show or demonstrate

Point out View, Save changes if available, Print club packet and Download registration PDF on a fictitious record.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/%5BeventId%5D/page.tsx)
- [docs/INVOICES.md](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/docs/INVOICES.md)

## 19. Use achievements and supply tools when needed

### Say

These tools help turn the club's records into useful follow-up. Honors records supported earned honors. Class tracking covers the current class and award items, not a generic checklist of every possible curriculum requirement. Orders is a supply helper and stock/hand-out workflow, not an online store checkout. When you need a roster file, build the export, preview the selected columns and download only the information needed for the task. The options depend on the helper's actual role.

### Show or demonstrate

Point to Honors → Export CSV or Print report, Orders → Export list (CSV) or Printable list, and Roster → Build a roster export.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/[organizationId]/honors/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/honors/page.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/class-tracking/page.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/orders/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/orders/page.tsx)

## 20. Area Coordinators: see progress and offer help

### Say

The coordinator side helps you understand how clubs are doing and where a director may need support. You use the recorded information rather than requesting another copy of every spreadsheet. Most club detail is view-only. The director maintains their own club records; you review the work, understand the status and follow up on the specific item. Your coordinator tools are not the director's editing menu.

### Show or demonstrate

From the Area coordinator card choose Clubs overview. Health information is a separate restricted workflow and is not required for this introductory tour.

### Preparation references — not spoken

- [modules/club-reports/area-card-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-reports/area-card-domain.ts)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-subnav.tsx)

## 21. Find a club and open its information

### Say

All clubs is useful when you know the club you want. Search by the club name, church or city and choose Open. When you are reviewing another club, the page tells you it is view-only. It shows permitted information such as ages rather than full birth dates. If you are also a director of your own club, that separate director assignment can provide editing there; coordinator access by itself does not provide it. The current list contains active clubs rather than an enforced area-only filter.

### Show or demonstrate

Search for the fictitious Riverton Pathfinders. Do not show Orders, Club settings or other director-only tools as coordinator options.

### Preparation references — not spoken

- [app/(public)/account/(portal)/clubs/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/clubs/page.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/portal-nav.ts)

## 22. Use Overview to choose your follow-up

### Say

Overview is a starting point, not a list you have to clear by clicking. Check the year in the heading. Review submitted reports, points and the other summaries. Sterling Volunteers is shown as counts here; open the club to understand the permitted adult information. Follow up after you know which month, record or event needs attention. There is no visible year dropdown on these pages, so use the year shown or ask for the appropriate link if it is not the year you need.

### Show or demonstrate

Point to the year heading, a report count, last report and a club link. Do not invent a Send reminder button or area filter.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/overview/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/area-clubs/overview/page.tsx)
- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-views.tsx)

## 23. Read Monthly Records and spot unfinished work

### Say

The monthly grid shows what is on file. A points value links to a submitted report, and a late submission is labelled late. Draft means started but not submitted. Due is not the same as Missing: Missing means the due date has passed without a submitted record. A draft can still display Draft after that date. Future months are not yet due. Read a submitted record when you need the detail, and ask the director about the specific unfinished month rather than entering their report for them.

### Show or demonstrate

Use a fictitious club/month and contrast Draft with a submitted points link. Explain that the current due date is the tenth of the next month.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/reports/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/area-clubs/reports/page.tsx)
- [modules/club-reports/area-summary-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-reports/area-summary-domain.ts)

## 24. Understand points and the downloaded file

### Say

Points gives you a chart and a table. Submitted report points and the yearly registration points are shown separately so a total can be explained. Under the current rule, an on-time yearly registration contributes fifteen hundred points. Search can narrow what you see, while the rank is based on the full list. Download points CSV includes the whole year's authorized clubs. Do not send that file expecting it to contain only the name search shown on your screen.

### Show or demonstrate

Point out the separate points components, sort controls and Download points CSV. Overview also offers the summary and points downloads.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/points/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/area-clubs/points/page.tsx)
- [modules/club-reports/area-export.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-reports/area-export.ts)

## 25. Check which clubs are going to an event

### Say

Club events helps you see participation. The roster tells you who belongs to a club; this view tells you whether a club is registered for an event and the number included. Read the actual state. A draft is not a completed registration, a waitlist is not a confirmed place and a cancelled record is history. If you search the club rows, the event total can still describe the whole event. This is oversight of participation, not permission to submit every club's registration.

### Show or demonstrate

Point out status, headcount and event total using fictitious records. Use the director’s normal process for corrections.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/events/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/area-clubs/events/page.tsx)
- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-views.tsx)

## 26. Know the two special review pages

### Say

Most coordinator work is view-only. Team approvals is a specific exception. It concerns the team-member requests for your event locations, with the current event's age and eligibility rules shown on the page. Read the request before approving or declining. A decline tells the director what needs correction; it does not automatically remove the person. New clubs is a different review page. You may read the application, but the conference administrator approves or declines it.

### Show or demonstrate

Use a fictitious team request and stop before a real decision. A staff support act-as view cannot substitute for the real coordinator’s decision authority.

### Preparation references — not spoken

- [app/(public)/account/(portal)/area-clubs/team-permissions/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/area-clubs/team-permissions/page.tsx)
- [app/(public)/account/(portal)/area-clubs/applications/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/%28portal%29/area-clubs/applications/page.tsx)

## 27. A coordinator example: follow one missing item

### Say

Imagine Overview suggests that Riverton needs attention. I open Monthly Records and find October. I check whether it is a draft, missing, or a submitted report I can read. Then I contact the director about that particular record and ask what help is needed. Before an event, I can use the same habit in Club events. This follow-up is a conversation through the normal conference process; the overview has not automatically sent a reminder or completed the report.

### Ask the group

If the record says Draft, what is the useful next question for the director?

### Preparation references — not spoken

- [components/area-clubs-views.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-views.tsx)
- [modules/club-reports/area-summary-domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-reports/area-summary-domain.ts)

## 28. Build a simple working rhythm

### Say

You do not need to explore every page every day. A director can keep the roster current, add notes while meetings are fresh and make time to finish the Monthly Record. Before an event, review who is going. A coordinator can begin with the summaries, open the item that needs attention and make a focused follow-up. These are suggested working habits, not a new reporting policy or an automatic schedule.

### Ask the group

Which part of this routine would be easiest to build into your normal club work?

### Preparation references — not spoken

- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/portal-nav.ts)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-subnav.tsx)

## 29. If something is missing or not working

### Say

If you cannot remember the password, use Forgot password and request the email code. Return in the same browser, enter the code and new password, then Set new password. If sign-in works but your club is missing, check the email shown and ask the office about the invitation or assignment; do not create another account. If you need support for a page, describe the task and visible error. Leave passwords, codes, private links and member health details out of screenshots and messages.

### Show or demonstrate

Point to Forgot password? and the authenticator help link. Use the conference’s existing support route; no new support address is introduced by this deck.

### Preparation references — not spoken

- [components/attendee-password-reset-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/attendee-password-reset-form.tsx)
- [app/(public)/account/help/authenticator/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/%28public%29/account/help/authenticator/page.tsx)

## 30. Finish safely and return next time

### Say

Before leaving, check the result of the task you were doing. A saved draft means you can continue; Submitted means the report was sent; an event registration has its own confirmation and status. Then choose Sign out, especially on a shared computer. Closing the browser tab is not the same action. Next time, return to the website and use the account you already have.

### Show or demonstrate

Point to Sign out without displaying another person’s session or credentials.

### Preparation references — not spoken

- [components/attendee-sign-out-button.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/attendee-sign-out-button.tsx)

## 31. The three things to remember

### Say

The goal is not to memorize every menu today. Remember your own account, the right club or coordinator context, and the result of the task. Directors keep the club's information up to date. Coordinators use that information to understand progress and offer help. You can come back to the guides when you need the exact steps.

### Ask the group

Invite questions about a task people need to do next. Use the quick-start handout for sign-in and role-specific reminders.

### Preparation references — not spoken

- [app/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/app/page.tsx)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/modules/club-rosters/portal-nav.ts)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/47cd5c00780d0c2dd9e618b56c32e2fbd04b041a/components/area-clubs-subnav.tsx)
