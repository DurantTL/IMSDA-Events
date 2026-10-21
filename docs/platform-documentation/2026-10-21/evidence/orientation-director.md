# Director orientation: source-verified task guidance

Prepared October 21, 2026 for the revised end-user presentation. This is documentation only. The reviewed application source is the application baseline from `5e367b7c`; current main `47cd5c00` adds the preceding documentation pack. No production session or member data was used.

## Core explanation for a director

IMSDA Events keeps the club's ongoing membership and records together, then uses that information when the club takes part in an event. It helps a director avoid retyping the same people, see what needs attention, keep reports and achievements on file, and return to an event's actual registration and choices.

The central distinction for a new user is simple: **the roster says who belongs to the club; a registration says who is going to one event.** Adding someone to the roster does not register them for every event. An annual form, an event registration, attendance and an award also remain different records.

## Verified current destinations and labels

The current director/deputy navigation is **Home**, **Roster**, **Honors**, **Class tracking**, **Club events**, **Forms**, **Health**, **Monthly Records**, **Orders** and **Club settings**, according to the person's role and applicable gates. This list is evidence of the present menu, not a proposed replacement.

Entry is `/account/clubs`. A director with one club is taken directly to that club. Multiple clubs are listed with **Open**; **All my clubs** appears from club Home only when there is another club to choose. Club pages show the person's role, the club name, sponsoring church when present, and current club year. Do not teach a universal year selector that is not on every page. Club Home is calculated for the current year. Roster routes can show the previous/current/next year, with noncurrent rosters ordinarily read-only and a narrow next-year emergency-contact exception.

| Task | Actual current route / click path | Verified labels and behavior |
|---|---|---|
| Begin work | My club → club Home (`/account/clubs/[club]`) | Home leads with a next-task card and deadline, then Roster/Honors/Events/Monthly Records summaries, deadlines, To do and registered events. Tile actions include **Open roster**, **Open honors**, **Open events**, **Open Monthly Records**. |
| Add a regular member | **Roster → Add to roster** | Enter requested person details, then **Add to roster**. Successful save says **Added to the roster. Next: they can be chosen when the club registers for an event.** |
| Correct details | **Roster → pencil/Edit for that person → Save** | Current row actions are icons with person-specific accessible names, not the future proposed labelled-action layout. The birth-date field may say **Birth date (leave blank to keep)**. |
| Temporarily stop selecting someone | **Roster → Edit → Deactivate** | Confirm the named person. They stay on file but are omitted from new registrations until **Reactivate**. The roster has **Show inactive**. |
| Erase roster details | Roster trash/Remove action | The confirmation explicitly says birth date and details are erased and cannot be undone. **Remove** is not the ordinary way to mark a person away for a while. Names may remain on items already ordered. Do not demonstrate this by deleting a real person's row. |
| Fill or request a club form | **Forms → [enabled form] → Fill in for a member**, or its private-link action | Only conference-enabled forms appear. **Filled forms** lists saved/submitted records; **Show forms for → Show** filters to a member. Drafts use **Open**; submitted records use **View and print**. Sent links work once and show Waiting/Submitted/Withdrawn/Expired separately from email delivery. |
| Record a meeting | **Monthly Records → choose/Open month → Add meeting note** | Enter meeting date/head counts, optional **Take attendance**, honors and notes. New notes use **Add meeting note**; edits use **Save changes**. Attendance supports **Mark all present**, **Clear all** and **Skip attendance**. **Attendance export (CSV)** is available under the appropriate roster access. |
| Prepare/submit the month's report | **Monthly Records → month → Open Monthly Record** | Existing report buttons vary: **Continue report**, **Edit report**, **View report**. **Save draft** and **Submit report · [points] points** are separate actions. The source says reports are due the **10th of the next month**. **Refresh from meeting notes** is explicit; editing notes does not silently overwrite a saved report. A submitted/closed report may be read-only. |
| Register for an event | **Club events → event → Register** | The event list offers **Register**, **Continue**, **View**, or **Your teams** according to state. New registration has three steps: **Who's going → Each person's details → Review**. Select the actual people and, where asked, location/classes. Who's-going choices save automatically; a saved draft is not a completed registration. |
| Review an existing registration | **Club events → View** | Read confirmation/status and people included. While allowed, the embedded editor saves through **Save changes**; otherwise the page explains the closed edit window or asks the user to contact the event team. The page offers **Print club packet** and **Download registration PDF** where applicable. |
| Record honors | **Honors → Add** beside a member, or **Add honors to several members** | Choose the honor and requested details, then **Record** / confirm the named honor. **Export CSV** and **Print report** are on Honors. Director/deputy can void under the specific permission; registrar cannot simply inherit that authority. |
| Review earned class/award items | **Class tracking** | Current page concerns class insignia, event patches, Good Conduct/TLT items and Master Award progress. Director/deputy confirm/record; registrar views. Do not describe it as a universal checklist of every curriculum requirement. |
| Prepare supplies | **Orders** | Order helper list, uniform/honor/other supplies, stock on hand and hand-out workflow. Actions include **Add to list**, **Export list (CSV)**, **Printable list**, **Pick list (who gets what)**. It is not a general camp-store or online purchase checkout. Director/deputy edit; registrar views. |
| Export a roster | **Roster → Build a roster export** | Choose columns, **Preview**, then **Download CSV**. Optional **Save format** stores a named configuration. Only permitted fields are offered; do not add birth dates/guardians to make a generic example look complete. |

## Role differences to explain in normal language

- **Director:** runs the club's roster, events, team and profile.
- **Deputy:** same access as director.
- **Registrar:** maintains the roster and registers the club for events; sees ages, not full birth dates; does not inherit team/profile, guardian, Monthly Records or general club-form authority. Honors records are available, while Orders and Class tracking are view-only. A separately enabled health-record entry path is narrow and must not be presented as permission to read a health record.
- **Reporter:** Home and Monthly Records; no roster/event access. Optional name-by-name attendance check-off requires roster access, so a reporter can use report/head-count work without being promised the member list.

The everyday instruction is: **use your own account; ask the director or office to check your assignment if the expected club or task is missing.** Do not tell helpers to borrow a director's credentials or choose an administrator role.

## Nine suggested director slides

Each visible slide below has at most three steps. Spoken notes provide context and explain why the task matters. Demo with fictitious names and stop before any irreversible or real operational action.

### D1. Begin at your club Home

**Visible copy**

1. Open **My club** and choose your club if asked.
2. Check the club name and year.
3. Follow the next task or open the section you need.

**Presenter says:** “Home is your starting point, not another report to fill in. It brings together what your club has already recorded and what needs attention. For this example we are working in Riverton Pathfinders. If you manage one club, you normally go straight into it; if you manage several, choose the right one first. Look at the year as well as the club name.”

**Demo:** Point to the club header, next task, Roster and Monthly Records summaries. Do not use the unimplemented accepted redesign as the actual current screen.

### D2. Keep the roster ready

**Visible copy**

1. Open **Roster → Add to roster**.
2. Enter the member's requested details.
3. Add the person, then check the saved row.

**Presenter says:** “The roster is the club's continuing list. Add regular members here so you can choose them for events later. For our example, add a fictitious member named Morgan Reed. You are not registering Morgan for an event by doing this. If a person is already listed, use their edit control instead of creating another row.”

**Demo:** Use a training account/data set only. Explain age and birth date according to the audience's role; do not reveal a real birth date for the demonstration.

### D3. Update, deactivate or remove?

**Visible copy**

1. Use the person's **Edit** control to correct details, then **Save**.
2. Use **Deactivate** if the person should stay on file.
3. Read **Remove** carefully: it erases details and cannot be undone.

**Presenter says:** “These actions do different jobs. Editing fixes the existing person. Deactivate is for someone who should remain in your records but should not be chosen for a new registration. Remove is an erasure action, not a casual hide button. If someone may return, keep them on file rather than deleting their details.”

**Demo:** Show the edit dialog and Deactivate explanation. Cancel the removal confirmation rather than acting on a real row.

### D4. Collect club forms in one place

**Visible copy**

1. Open **Forms** and choose an available form.
2. Fill it in for a member or use its private-link option.
3. Return to **Filled forms** to see the result.

**Presenter says:** “Forms is for the club's files and is available to directors and deputies. The conference decides which forms are available. You can enter a form from an approved paper copy or request it through the existing private-link process. A private link works once; after submission the result is listed in Filled forms. A link saying Sent is not the same as a form saying Submitted.”

**Demo:** Explain the available action without sending an invitation/link during a general presentation. Keep example form content synthetic and non-sensitive.

### D5. Record the meeting while it is fresh

**Visible copy**

1. Open **Monthly Records** and the right month.
2. Choose **Add meeting note**; record counts and meeting details.
3. Save the note; use attendance check-off when available.

**Presenter says:** “Small records after each meeting are easier than reconstructing the month later. Enter the date and the counts you know. Directors with roster access can optionally check off who attended; someone without that access can still use the permitted head-count/report work. The meeting note is a saved record of the meeting, and it can help prepare the month-end report.”

**Demo:** Show the difference between head counts and optional Take attendance. Avoid asserting that a reporter can open the named roster.

### D6. Finish the Monthly Record

**Visible copy**

1. Open the month and **Open Monthly Record** or **Continue report**.
2. Check the details; **Save draft** if you need to finish later.
3. Choose **Submit report** and confirm the submitted result.

**Presenter says:** “Saving a draft lets you return, but it does not submit the report. Read the due date shown on the page; the current rule is the tenth of the next month. Meeting notes can help fill the report, but a report you already saved is not silently replaced when notes change. Use Refresh from meeting notes deliberately if offered, review the result, and then submit. If the report is closed or the expected edit is unavailable, contact the office.”

**Demo:** Point out Draft versus Submitted and the displayed month/due date. Do not submit a real club report during training.

### D7. Register only the people who are going

**Visible copy**

1. Open **Club events → Register** or **Continue**.
2. Choose who's going and the requested event/location/class details.
3. Review and submit; look for the confirmation.

**Presenter says:** “This is where the annual roster becomes useful. Choose the people attending this event, not automatically everyone on file. The registration guides you from Who's going, through each person's details, to Review. A draft can save while you work, but a saved draft is not a registered club. If the event is full or has a waitlist, read that explanation rather than assuming your place is confirmed.”

**Demo:** Use a synthetic event. Stop at review unless working through an authorized training submission. Team events can show Your teams and separate team forms.

### D8. Return to your registration

**Visible copy**

1. Open **Club events → View**.
2. Check the people, choices and current status.
3. Make permitted changes or download the registration/club packet.

**Presenter says:** “You do not need to start another registration to check what you sent. Return to the existing one. Changes are available only within the event's rules and editing window; use Save changes when offered. For the church-billed club events shown here, the sponsoring church follows the office billing process. The director is not being asked to pay a personal online balance. Confirmation, payment, assignments and check-in are separate facts.”

**Demo:** Show Print club packet and Download registration PDF in a permitted synthetic record. Follow the document's authorized sharing rules.

### D9. Keep achievements and supplies connected

**Visible copy**

1. Use **Honors** to record earned honors.
2. Use **Class tracking** for the supported class/award records.
3. Use **Orders** to review the helper list, stock and hand-out work.

**Presenter says:** “These tools help your records lead to the right items for the right people. Record a real completed honor through Honors, and use the existing class and award tools for what they support. Orders helps the club prepare and track supplies; it is not an online store checkout. Exports and printable lists are available when you need an approved working copy. Only include fields you actually need and are permitted to share.”

**Demo:** Use Honors → Export CSV or Print report; Orders → Export list (CSV), Printable list or Pick list. For a roster file, show Build a roster export → Preview → Download CSV. Do not demonstrate an external purchase.

## Suggested operating rhythm

- **When a member joins or details change:** update the existing roster person or add the new member; review required forms.
- **After each meeting:** add the meeting note and optional attendance while details are fresh.
- **Before the monthly due date:** open the month, check/finish the report and confirm Submitted rather than leaving a draft.
- **Before an event:** review Home/deadlines, update the roster, register the actual attendees and check required choices.
- **After an event or achievement:** record supported honor/class/award results, review orders/stock and keep the saved registration as history.

These are suggested habits, not new automated schedules, reminders or policy dates.

## Existing screenshot candidates

`docs/screenshots/issue-645/after-club-home-1280.png`, `after-club-home-390.png`, `after-club-forms-tab-1280.png`, `after-club-form-fill-in-390.png` and `after-club-form-filled-1280.png` are committed historical UI captures from the earlier typography audit. They are useful references, but label them historical if reused and do not assert they represent every detail of today's serving screen.

`docs/design/role-workspaces/screenshots/director-desktop.png` is the accepted synthetic future direction. It must not be used as a current how-to screenshot. The later public/list roster samples are proposals as well. Prefer current synthetic application captures for actual click demonstrations when available.

## Source map

All paths below exist in the reviewed worktree. Stable base: `https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/`.

- `modules/club-rosters/portal-nav.ts:21` — exact current club menu and role-gated destinations.
- `modules/organizations/director-grants-domain.ts:9` — role descriptions and capability differences.
- `app/(public)/account/(portal)/clubs/page.tsx:141` — one-club redirect and multi-club list.
- `app/(public)/account/(portal)/clubs/[organizationId]/layout.tsx:54` — club/role/current-year header and roster unlock context.
- `app/(public)/account/(portal)/clubs/[organizationId]/page.tsx:79` — current-year Home projections and next tasks.
- `components/club-year-tiles.tsx:40` — tile labels and Open actions.
- `components/club-roster-workspace.tsx:361` — Deactivate/Reactivate and Remove confirmations; `:406` Add to roster; `:618` Edit action; `:745` Save/Add label.
- `app/(public)/account/(portal)/clubs/[organizationId]/forms/page.tsx:58` — enabled forms, Fill in for a member, Filled forms, private-link states.
- `app/(public)/account/(portal)/clubs/[organizationId]/records/page.tsx:125` — month list, due rule and note/report composition.
- `components/club-meeting-notes.tsx:278` — Add meeting note and Attendance export; `:500` optional attendance controls.
- `components/club-report-form.tsx:246` — current report opening labels; `:317` Refresh from meeting notes; `:423` Save draft and Submit report.
- `components/club-event-list.tsx:59` — Register/Continue/View/Your teams state labels.
- `components/club-registration-workspace.tsx:301` — three-step registration and saved choices.
- `app/(public)/account/(portal)/clubs/[organizationId]/events/[eventId]/page.tsx:298` — Print club packet and Download registration PDF; `:366` allowed edit path.
- `components/club-registration-editor.tsx:302` — Save changes for existing permitted registration edits.
- `components/club-honors-workspace.tsx:311` — Export CSV/Print report; `:327` bulk recording; `:584` Record.
- `app/(public)/account/(portal)/clubs/[organizationId]/class-tracking/page.tsx:10` — actual Class tracking scope and registrar read-only behavior.
- `components/club-order-workspace.tsx:591` — Add to list and exports/print/pick list.
- `components/roster-export-builder.tsx:291` — Preview, Download CSV and Save format.

No application source, GitHub issue or production data was changed for this review.
