# IMAdventist getting started: presenter notes

For club directors, deputies and Area Coordinators · November 2026

This orientation follows fictional Riverton Pathfinders through ordinary tasks, then switches to an Area Coordinator's view of the same records. The screenshots come from a local copy of the current app filled with invented training records. They show what the app does at the source version below; your own role decides which tools you see.

**Who this is for:** people who are seeing **IMAdventist** (Events & Club Ministry) for the first time. No earlier training is assumed. Slide 2 is a short orientation for everyone: what the system is, where directors and coordinators work, and a few habits that work the same on every page.

**How to present:** show the screenshot, point to the numbered outline, then use the Say paragraph in your own words. The numbered pink outlines are added for training; they are not part of the app.

**The fictional story:** Jordan Ellis directs Riverton Pathfinders at Riverton Community Church. Morgan Reed joins the roster. Alex Morgan is an Area Coordinator. The other clubs are Pine Grove, Lakeview and Cedar Hill Pathfinders. The club year is 2026–27 and the scenario date is November 5, 2026. Winter Camporee runs December 4–6; club registration closes November 25. All names, contacts, counts and registrations are invented.

**Training setup:** screenshots were taken on a local copy with synthetic data. No real email, invitation, registration or approval was sent. No usable password, code or private link appears.

**Source version:** main [ad9237d](https://github.com/DurantTL/IMSDA-Events/commit/ad9237d). The capture register (`evidence/screenshot-capture.json`) lists each route and state.

**Shorter sessions:** directors only: slides 1–21 and 31. Coordinators only: slides 1–6 and 22–31.

## 1. Follow a club through a real task

### Say

Today we follow two people instead of reading a list of features. Jordan Ellis directs Riverton Pathfinders. Alex Morgan is an Area Coordinator. We will watch Jordan update the roster, file the October Monthly Record and register the club for Winter Camporee. Then we will see how Alex uses those same saved records to offer help. Every person, club and record on these slides is invented for training. Your own tools depend on the role the conference office has given you.

### Point to

Point to the two role labels: Club portal for Jordan and Club coordination for Alex.

### On the slide

- Jordan's club Home (`assets/training/director-home.png`)
- Alex's Club coordination overview (`assets/training/coordinator-overview.png`)

### Key points

- For club directors, deputies and Area Coordinators
- Fictional training records · November 2026

### Preparation references (not spoken)

- [lib/brand.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/lib/brand.ts)
- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/club-rosters/portal-nav.ts)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/area-clubs-subnav.tsx)

## 2. What works the same on every page

### Say

Before we look at any one task, here is what works the same on every page. The system is called IMAdventist: Events & Club Ministry. It keeps club records and event registrations together, and you start at events.imsda.org. Questions go to the conference office or support@imsda.org. Directors and deputies open My club in the account menu. Area Coordinators open Club coordination. Help has step-by-step picture guides. The app is also careful with your work. If you start typing in a form and try to leave, it asks before throwing your changes away. Search boxes filter as you type, and table headers sort.

### Point to

Keep this short. Each habit comes up again during the story.

### On the slide

**What IMAdventist is**

- IMAdventist: Events & Club Ministry keeps club records and event registrations together.
- Start at events.imsda.org.
- Questions go to the conference office or support@imsda.org.

**Where to find your work**

- Directors and deputies: My club in the account menu.
- Area Coordinators: Club coordination in the account menu.
- Help has step-by-step picture guides for directors and coordinators.

**Safer everyday work**

- Leaving a form with unsaved changes asks: Leave without saving?
- Search boxes filter as you type. Column headers sort tables.
- Statuses use the same words everywhere: Draft, Submitted, Confirmed, Waitlisted, Cancelled.

### Preparation references (not spoken)

- [docs/BRANDING-IMADVENTIST-INVENTORY.md](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/docs/BRANDING-IMADVENTIST-INVENTORY.md)
- [components/account-portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/account-portal-nav.ts)
- [components/unsaved-changes-dialog-host.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/unsaved-changes-dialog-host.tsx)
- [modules/registrations/status-words.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/registrations/status-words.ts)

## 3. Start from the public site

### Say

The public site is the front door. Anyone can look at events, the calendar and the Club ministry page without an account. You only need to sign in when you work with your club's records or your own registrations. The header links are Home, Events, Calendar and Club ministry, and Sign in is at the top right.

### Point to

Point to Sign in at the top right of either screen.

### On the slide

- Home: Find your next gathering (`assets/training/public-home.png`)
- Calendar: upcoming events (`assets/training/public-calendar.png`)

### Key points

- Anyone can browse events, the calendar and Club ministry without signing in.
- Sign in when you need your club's records or your registrations.

### Preparation references (not spoken)

- [components/public-home-page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/public-home-page.tsx)
- [components/public-explore-nav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/public-explore-nav.tsx)

## 4. Use the account you already have

### Say

Use the same email address the conference office used for your club invitation. Enter your email and password, or choose the passkey option if you set one up. Some browsers show a short Security check. If a privacy setting blocks it, the page offers Email me a code instead. Please do not create a second account to get around a problem; ask the office instead.

### Point to

Point to the email field (1), then to Sign in with a passkey.

### On the slide

- Account sign in (`assets/training/sign-in.png`)

### Key points

- Enter your email address and password, or use a passkey.
- A Security check may appear. If it is blocked, choose Email me a code instead.
- Back to events returns you to the public site.

### Preparation references (not spoken)

- [components/attendee-sign-in-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/attendee-sign-in-form.tsx)
- [components/security-check/security-check.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/security-check/security-check.tsx)
- [components/back-to-events-link.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/back-to-events-link.tsx)

## 5. The extra step protects young people's records

### Say

Club pages show records about young people, so the system asks for a second step. The page is called Confirm it's you. Enter the six-digit code from your authenticator app or a recovery code, or use your passkey. If you lose your phone, the link Recover two-step sign-in emails you a code. You only set this up once.

### Point to

Read the yellow 'Why this is needed' box aloud.

### On the slide

- Confirm it's you (`assets/training/two-step.png`)

### Key points

- Club pages hold names, birthdays, health forms and medical notes.
- Enter the six-digit code from your authenticator app, or use a passkey.
- Lost your phone? Use Recover two-step sign-in.

### Preparation references (not spoken)

- [components/two-step-setup.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/two-step-setup.tsx)
- [components/two-step-recovery-link.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/two-step-recovery-link.tsx)

## 6. Your account page shows your roles

### Say

After you sign in you land on your account page. The top menu reads Overview, My registrations, Profile, My club and Help. Jordan's club appears under Your other roles. Choose the club name to open the Club portal. If you help more than one club, the menu says My clubs and you pick the right one.

### Point to

Point to the Riverton Pathfinders card (1).

### On the slide

- Jordan's account (`assets/training/director-account.png`)

### Key points

- Account menu: Overview, My registrations, Profile, My club, Help.
- Under Your other roles, open your club.
- Coordinators see Club coordination instead of My club.

### Preparation references (not spoken)

- [components/account-portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/account-portal-nav.ts)

## 7. Jordan starts with the next task

### Say

This is the Club portal. Check the club name and the current club year at the top before you change anything. The tabs across the page are where the work lives. Home summarizes the year and shows a Getting started list. Each step has an Open link and a Help guide with pictures.

### Point to

Point to the club year box, then the tab row.

### On the slide

- Riverton Pathfinders Home (`assets/training/director-home.png`)

### Key points

- Tabs: Home, Roster, Forms, Club events, Honors, Class tracking, Monthly Records, Orders, Health, Club settings.
- Your club this year: roster people, saved form drafts, event registrations.
- Getting started lists set-up steps, each with a Help guide.

### Preparation references (not spoken)

- [modules/club-rosters/portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/club-rosters/portal-nav.ts)
- [components/club-portal-masthead-view.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-portal-masthead-view.tsx)

## 8. Add Morgan once

### Say

Morgan Reed is joining Riverton. Jordan searches the roster first to make sure Morgan is not already there, then chooses Add to roster. The form asks for first and last name, birth date, type, current class and gender. Birth dates are encrypted and only the director and deputy see them. Adding someone to the roster does not register them for an event.

### Point to

Point to Add to roster, then the First name field.

### On the slide

- ① Add to roster (`assets/training/roster-edit-top.png`)
- ① Enter the details (`assets/training/roster-add.png`)

### Key points

- Search the roster first so you don't add someone twice.
- First name, last name, birth date, type, current class, gender. Emergency contacts are optional.

### Preparation references (not spoken)

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-roster-workspace.tsx)

## 9. Save, then check the saved row

### Say

Jordan chooses Add to roster at the bottom of the dialog. The dialog closes and Morgan's row appears in the Members list. Always look for the saved row before moving on. To fix a mistake later, use Edit beside the name. Actions holds Deactivate and Remove. Remove erases roster details and cannot be undone, so read it carefully.

### Point to

Point to Morgan's row (1).

### On the slide

- ① Add to roster saves (`assets/training/roster-add-save.png`)
- ① Morgan Reed on the roster (`assets/training/roster-added.png`)

### Key points

- The roster now shows 10 people.
- Use Edit to correct a person and Actions for deactivate or remove.

### Preparation references (not spoken)

- [components/club-roster-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-roster-workspace.tsx)

## 10. Build a roster file for another event

### Say

Some outside events want the roster in their own layout. The Export builder lets you pick columns, put them in order, rename headers, preview and download a CSV file. You can save the layout with a name, for example for a union camporee, so next year it is one click.

### On the slide

- Export builder (`assets/training/roster-export.png`)

### Key points

- Choose and order the columns another event needs.
- Preview, then Download CSV.
- Save the column choice as a named format for next time.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/clubs/[organizationId]/roster/export/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/roster/export/page.tsx)

## 11. Fill in a form or send a private link

### Say

The Forms tab holds the yearly forms. For family forms such as the membership application or a permission slip, you can fill it in yourself or send a private link so a parent fills it in. Club forms, like the transportation passenger list, are filled in by the club. Only the director, deputy and conference office can open these files, because they can hold health and contact details.

### Point to

Point to Fill in (1) and Send link.

### On the slide

- Forms for your club's files (`assets/training/forms.png`)

### Key points

- Family forms: ① Fill in yourself, or Send link to a parent.
- Club forms: the club fills these in itself.
- A saved draft is not a submitted form.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/forms/page.tsx)

## 12. Record honors as they are earned

### Say

Honors keeps each member's honor records. Use Add beside a name, or Add honors to several members after a group finishes the same honor. You can filter by honor, status and class, and download or print the list.

### On the slide

- Honors (`assets/training/honors.png`)

### Key points

- Find a person, then + Add or View.
- Add honors to several members at once.
- Riverton: 4 completed, 4 in progress.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/clubs/[organizationId]/honors/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/honors/page.tsx)

## 13. Capture the meetings while they are fresh

### Say

Monthly Records lists each month with its due date. September is closed. October is a draft that Jordan can still change until November 10. Under each month, Add meeting note records the date, head counts and what you did. Notes taken during the month make the report quicker at the end.

### Point to

Point to the October row and the Add meeting note button.

### On the slide

- ① Open a month (`assets/training/records-list.png`)
- October meetings (`assets/training/meeting-note.png`)

### Key points

- Reports are due the 10th of the next month.
- Add meeting note after each meeting; the record can pull counts from your notes.

### Preparation references (not spoken)

- [components/club-report-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-report-form.tsx)
- [modules/club-reports/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/club-reports/domain.ts)

## 14. Sign, then Submit report

### Say

Jordan opens October with Continue report, checks the counts, types a full name and the date under Signature, and chooses Submit report. Save draft would only keep the work for later. After submitting, the card says Submitted with the date. If something needs changing before the deadline, Reopen as draft is there.

### Point to

Point to Submit report (1), then the Submitted label.

### On the slide

- ① Type your name and date (`assets/training/report-sign.png`)
- Submitted (`assets/training/report-submitted.png`)

### Key points

- Save draft keeps your work but does not file the report.
- Submit report files it; the points show on the card.

### Preparation references (not spoken)

- [components/club-report-form.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-report-form.tsx)

## 15. Choose who is going

### Say

Winter Camporee is open. Jordan chooses Register, then picks who is going. Select everyone ticks the whole roster; you can also tick people one at a time, or add a visitor who is not on your roster. The button counts the people you chose.

### Point to

Point to Register, then the Continue button.

### On the slide

- ① Register (`assets/training/events-list.png`)
- ① Continue with 10 people (`assets/training/event-attendees.png`)

### Key points

- Club events lists events open to your club.
- Select everyone or tick people one by one. Add a person who is not on the roster.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/%5BeventId%5D/page.tsx)

## 16. Review, submit, and check the result

### Say

Before submitting, the review page shows the contact details, the people and the price. For a church-billed event there is nothing to pay online; the church is billed after the event. After Submit registration, the event page says Your club is registered, with a confirmation number and a code to show at check-in. A saved draft or a waitlist place is not a confirmed registration.

### Point to

Point to the confirmation number.

### On the slide

- ① Submit registration (`assets/training/event-review.png`)
- Your club is registered (`assets/training/event-saved.png`)

### Key points

- Review shows the contact, people and price before you submit.
- After submitting: a confirmation number, the people going and a check-in code.

### Preparation references (not spoken)

- [components/club-registration-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-registration-workspace.tsx)
- [app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/events/%5BeventId%5D/page.tsx)

## 17. Record a class, then confirm the insignia

### Say

Class tracking shows each member's class status. When members finish a class, select them and choose Mark completed. The page then suggests that class's insignia: name strip, chevron, pin and ribbon bar. Nothing is ordered until you choose Add to order list, and you can untick anything a member already has.

### Point to

Point to Avery's suggested items and Add to order list.

### On the slide

- Class tracking (`assets/training/club-class-tracking.png`)
- Suggested insignia (`assets/training/club-class-suggestions.png`)

### Key points

- Avery finished Friend on October 18.
- Suggested items join the order list only when you choose Add to order list.

### Preparation references (not spoken)

- [modules/earned-awards/order-source.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/earned-awards/order-source.ts)
- [modules/earned-awards/domain.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/earned-awards/domain.ts)

## 18. One list for honors, uniforms and supplies

### Say

Orders brings honors, uniform needs and earned awards into one list. It is a helper: you still order from AdventSource. Keep your supplies on hand up to date, and the list subtracts them. Ready to hand out shows items that are already in your supplies for a member.

### On the slide

- Orders (`assets/training/club-orders-top.png`)
- Ready to hand out (`assets/training/club-orders-list.png`)

### Key points

- The order list is a helper, not an official order form.
- Stock on hand comes off what you need to order.

### Preparation references (not spoken)

- [components/club-order-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-order-workspace.tsx)

## 19. Mark it handed out; stock goes down

### Say

Drew earned a Good Conduct Bar and the club has three. Jordan ticks Drew and chooses Mark handed out. The item leaves the list and the supply count drops to two on its own, so don't change the count by hand as well.

### Point to

Point to Mark handed out, then the stock of 2.

### On the slide

- ① Mark handed out (`assets/training/club-orders-handout.png`)
- Good Conduct Bar: 2 on hand (`assets/training/club-orders-stock-after.png`)

### Key points

- Drew's Good Conduct Bar: 3 on hand before.
- The app takes it off your supplies. Don't subtract it again by hand.

### Preparation references (not spoken)

- [components/club-order-workspace.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/club-order-workspace.tsx)

## 20. Most of the Year-End Report fills itself

### Say

The Year-End Report covers the Pathfinder year, May 1 to April 30, which is different from the September club year. It is due April 1. Your roster, honors and classes fill in most of the counts. Check them, add the few things only you know, and use Save draft until you are ready. Submitting locks it until conference staff reopen it.

### Point to

Point to Membership total, then Save draft.

### On the slide

- Pathfinder year May 1–April 30 (`assets/training/club-year-end-header.png`)
- ① Counts from the roster (`assets/training/club-year-end.png`)
- ① Save draft (`assets/training/club-year-end-save.png`)

### Key points

- Due April 1, 2027. Counts only, no names.
- Save draft keeps it open. Submit report locks it until staff reopen it.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/clubs/[organizationId]/reports/year-end/[year]/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/%5BorganizationId%5D/reports/year-end/%5Byear%5D/page.tsx)

## 21. Help is one click away

### Say

Every club page has Forms help at the top. It covers common form problems, translation, and how to reach the conference office. The Help page in your account menu has short guides and Step by step guides, with a picture of the real screen for each step. Reading a guide doesn't finish a task; the work happens on the working pages.

### On the slide

- Forms help in the club portal (`assets/training/forms-help.png`)
- Step-by-step guides (`assets/training/help-walkthroughs.png`)

### Key points

- Forms help: form issues, translation, and how to reach the office.
- Help → Step by step: guides with a picture of every step.

### Preparation references (not spoken)

- [modules/help/walkthroughs.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/help/walkthroughs.ts)
- [app/(public)/account/(portal)/help/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/help/page.tsx)

## 22. Alex opens Club coordination

### Say

Now we switch to Alex. Alex's account page has an Area Coordinator card with upcoming club events and clubs that need attention. Everything for coordinators lives under Club coordination in the account menu.

### Point to

Point to Club coordination (1).

### On the slide

- ① Club coordination (`assets/training/coordinator-account.png`)

### Key points

- Account menu: Overview, My registrations, Profile, Club coordination, Help.
- The Area Coordinator card shows upcoming club events and clubs needing attention.

### Preparation references (not spoken)

- [components/account-portal-nav.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/account-portal-nav.ts)
- [app/(public)/account/(portal)/clubs/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/clubs/page.tsx)

## 23. Start with who is missing what

### Say

The Overview tab shows upcoming deadlines, a Getting started list and a summary for the year. Who's missing what lists each club that is behind, with one next step. For Lakeview and Pine Grove the next step is to contact the director about the Monthly Record. The app does not send that message for you.

### Point to

Point to the Next step column.

### On the slide

- Overview and Getting started (`assets/training/coordinator-overview.png`)
- Who's missing what (`assets/training/coordinator-all-clubs.png`)

### Key points

- Tabs: Overview, Monthly Records, Points, Club events, Team approvals, New clubs, Waitlists.
- Each club that is behind shows one next step.

### Preparation references (not spoken)

- [components/coordinator-overview.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/coordinator-overview.tsx)
- [components/area-clubs-subnav.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/area-clubs-subnav.tsx)

## 24. Every club, view only

### Say

Clubs at a glance is the club list. It shows roster size, adults and staff, the current month's record and Sterling Volunteers screening counts. Open club shows the club's own pages in view-only mode. The director keeps the roster and settings, so ask the director for any change.

### Point to

Point to View only on each row.

### On the slide

- Clubs at a glance (`assets/training/coordinator-glance.png`)
- Riverton, view only (`assets/training/coordinator-club-view.png`)

### Key points

- Search by club, church or city; download the full-year CSV.
- Open club shows the club's pages without editing controls.

### Preparation references (not spoken)

- [components/coordinator-overview.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/coordinator-overview.tsx)

## 25. Read the month across clubs

### Say

Monthly Records shows every club for a month. Submitted means the club filed it. Not submitted means the month ended without a filed record. Open a submitted record to read it; coordinators read reports but do not change them.

### On the slide

- Monthly Records by month (`assets/training/coordinator-reports.png`)
- Riverton October, read only (`assets/training/coordinator-report-detail.png`)

### Key points

- Pick a month to see Submitted, Not submitted and Not due yet.
- Open a submitted record to read it.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/area-clubs/reports/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/area-clubs/reports/page.tsx)

## 26. See how points add up

### Say

Points adds up each club's Monthly Record points and the on-time yearly registration points. Riverton has 770 after two submitted records. Show as a table gives the ranking with supporting records, and the CSV covers the full year for every club.

### On the slide

- Points (`assets/training/coordinator-points.png`)

### Key points

- Report points plus on-time yearly registration points.
- Riverton leads with 770 after two submitted records.
- Full-year points CSV covers every available club.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/area-clubs/points/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/area-clubs/points/page.tsx)

## 27. Who is registered for each event

### Say

Club events shows each club's registration status and headcount for every club event. Winter Camporee has one club registered with ten people. Only registered clubs count toward the total. If a club hasn't registered, the follow-up is a conversation with the director.

### On the slide

- Winter Camporee (`assets/training/coordinator-events.png`)

### Key points

- Riverton: Registered, 10 people. Other clubs: Not registered.
- Only registered clubs count toward the event total.
- Coordinators can't register a club or change a registration.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/area-clubs/events/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/area-clubs/events/page.tsx)

## 28. Read new club applications

### Say

New clubs shows applications from people who want to start a club. Coordinators can read the details, but a system administrator makes the decision. Team approvals is the one place where a coordinator decides something: adult team members of 18 or older when a club asks.

### On the slide

- Pending approval (`assets/training/new-clubs.png`)

### Key points

- Coordinators read the application.
- A system administrator approves or declines it.
- Cancelled applications are collapsed out of the way.

### Preparation references (not spoken)

- [app/(public)/account/(portal)/area-clubs/applications/page.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/app/%28public%29/account/%28portal%29/area-clubs/applications/page.tsx)

## 29. Small changes that protect your work

### Say

A few small changes apply everywhere. If you start editing and try to leave, the app asks before discarding your changes. Searches update as you type. Table headers sort. And the status words are the same on every page, so Draft always means started but not submitted.

### On the slide

**Before you leave a page**

- If you changed something and didn't save, the app asks: Leave without saving?
- Choose Keep editing to go back, or Leave without saving.

**Finding things**

- Search boxes filter as you type. No Enter needed.
- Select a column header to sort a table. Clear filters brings everything back.
- Lists use one Download CSV link.

**Reading status**

- Draft: started, not submitted.
- Submitted, Confirmed, Waitlisted, Cancelled mean the same thing on every page.
- Saving… shows while a button works; Saved. confirms it.

### Preparation references (not spoken)

- [components/unsaved-changes-dialog-host.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/unsaved-changes-dialog-host.tsx)
- [components/search-as-you-type.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/search-as-you-type.tsx)
- [components/list-sort.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/list-sort.tsx)
- [modules/registrations/status-words.ts](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/modules/registrations/status-words.ts)

## 30. What is done and what is still planned

### Say

Some of what you see today was finished recently: the event form builder improvements, the public site redesign and the picture guides. Other items are still planned or are longer-term possibilities. Planned means tracked work that has not been built. Possible means an idea that still needs decisions. None of the planned or possible items are in the app today.

### Point to

Keep the three labels distinct. Don't promise dates.

### On the slide

**Already built**

- Event form builder: templates, a question library, phone editing and All/Any rules.
- Redesigned public home, events, calendar, event and club ministry pages.
- Step-by-step Help guides with pictures.

**Planned (not yet built)**

- Saved views for staff lists.
- Adventurer ministry and YMMS move.
- Shared ledger with held credits and installments.

**Possible later**

- Public merchandise.
- Full residential camp registration.
- Returning profiles and a wallet; partner connections such as eAdventist and UltraCamp.

### Preparation references (not spoken)

- [docs/ISSUE-CLEANUP-2026-11-02.md](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/docs/ISSUE-CLEANUP-2026-11-02.md)

## 31. Finish safely

### Say

Before you close the browser, check that your task saved: a row on the roster, a Submitted label, a confirmation number. Then sign out, especially on a shared computer. If something doesn't work, contact the conference office and tell them the club, the page, what you were trying to do and any message you saw. Please leave passwords, codes and health details out of the message.

### Point to

Point to Sign out (1).

### On the slide

- ① Sign out (`assets/training/account-sign-out.png`)

### Key points

- Check the saved result of your task before you leave.
- Choose Sign out, especially on a shared computer.
- Questions: support@imsda.org · (515) 223-1197

### Preparation references (not spoken)

- [components/profile-view.tsx](https://github.com/DurantTL/IMSDA-Events/blob/ad9237d/components/profile-view.tsx)
