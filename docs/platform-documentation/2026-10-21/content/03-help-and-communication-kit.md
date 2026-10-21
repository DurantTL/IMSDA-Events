# IMSDA Events help and communication kit

Prepared October 21, 2026. Source baseline: main `5e367b7c4d1b3c173d37c0415e335be76170b300`.

This kit contains ready-to-edit guidance and message drafts. It describes features present in the repository and identifies future presentation work separately. It does not establish which release is serving, enable a feature, change the agreed menus or send a message. Review the applicable event configuration before publishing any instructions.

## 1. How to use this kit

Give each person the guide for their actual job. An attendee needs personal registration help; a director needs a club and year; a coordinator needs oversight; a system administrator needs platform and event context. Sharing the same visual style does not make their navigation or authority interchangeable.

Use the task instructions below alongside the existing [Staff event workflow](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/STAFF-EVENT-WORKFLOW.md), operational runbooks and approved rehearsal material. This kit adds explanations and reusable wording rather than replacing the existing rehearsals, decision records or import examples.

Two kinds of placeholders appear in this document:

- **Editorial placeholders**, such as `[CLUB NAME]` or `[SUPPORT CONTACT]`, must be replaced by a person. They are not IMSDA Events template tokens.
- **Supported template tokens**, such as `{{event_name}}`, are named in the current application token allowlist. They still need to be available in the selected message context and checked in its preview. Do not paste an editorial placeholder into a live template unchanged.

Templates, preview and delivery are separate. A saved draft is not published; a preview sends nothing; a queued message is not evidence of delivery. Human review and the existing send permissions remain part of each actual send.

## 2. Quick starts for the current roles

### Attendee: find and manage your registration

1. Open the public event page and read its dates, location, registration choices and current availability.
2. After registering, keep the confirmation message. Its private management link provides access to that registration. Do not share the link publicly or paste it into a support screenshot.
3. If you use an account, sign in with the address associated with your registration and complete email verification when requested. Open **My registrations** to find accessible registrations.
4. Open the specific registration before changing details or continuing a permitted payment. Read the registration state and payment explanation separately.
5. If an action is unavailable, use the event's support contact. A cancellation request is a request for review; it does not by itself cancel attendance or issue a refund.

**Remember:** several attendees on one registration do not create a permanent family account or guardian authority over other records. A missing registration can be an email/access mismatch; creating another registration may create a duplicate. Waitlisted and cancelled records need their own status explanation rather than an automatic instruction to pay. Account display correction is tracked in [#1100](https://github.com/DurantTL/IMSDA-Events/issues/1100).

### Club director or deputy: keep the club's work together

1. Complete the personal invitation and sign-in prompts, including the required second step for club access. The existing [authenticator guide](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/app/%28public%29/account/help/authenticator/page.tsx) explains the authenticator option.
2. Open your club and confirm its identity and the working year before editing records.
3. Read the next task on **Home**. Use **Roster** for members, **Club events** for participation, **Forms** for available club forms and **Monthly Records** for the club's records.
4. For an event, review who is attending, the location and any required class or event choices. Annual roster membership and event attendance are different records.
5. Review the submitted registration and any staff assignments. On a church-billed event, the sponsoring church is billed; the director should not be told to pay a personal online balance.
6. Save before leaving an editor and confirm its result. If saving fails, keep the page open and correct the named problem. Broader dirty-editor protection is tracked separately in [#1101](https://github.com/DurantTL/IMSDA-Events/issues/1101).

**Role differences matter:** deputies have the director capability set. A registrar maintains the roster and registers the club but lacks the director's full birth-date, guardian, team, profile and report authority. A reporter has Home and Monthly Records, without roster or event access. Do not use “club administrator” as a blanket promise of every capability.

### Area Coordinator: review and follow up

1. Sign in to your own account and complete the required second step. Open the coordinator workspace offered to that account.
2. Confirm the selected year and the scope shown. Current source selects all active clubs available to the role; future ministry scoping belongs to the Adventurer work, not a current area selector.
3. Use **Overview**, **Monthly Records**, **Points** and **Club events** to identify follow-up work. Open a club or record to understand a count before contacting someone.
4. Treat club detail as oversight: the coordinator view does not become the director's editor.
5. Use **Team approvals** only for the existing requests and event locations your real coordinator account may decide. New-club applications are view-only for coordinators; system administrators make those decisions.
6. Read the export label. The existing full-year summary CSV does not become a filtered export merely because a name search is visible.

**Remember:** a staff “act as” view is a distinct temporary support mechanism. It does not inherit a real coordinator's decision authority. Readiness/report counts, screening summaries and access to protected records are separate concepts.

### System administrator: keep System and Event context visible

1. Start in **System management** for platform work: accounts, team, directory, catalogs, central Email, platform settings and readiness.
2. Enter a selected event deliberately for its settings, forms, people, finance, check-in and event communications. Confirm the event name before acting.
3. Use the existing readiness checklist and runbooks as evidence records. A tick does not send invitations, deploy a release, apply a migration, enable sign-in or activate health records.
4. For event setup, follow the existing seven-step workflow. The first publication of a registration form needs a test submission; later published versions do not acquire a new per-version test requirement merely because a label changed.
5. Preview the actual audience and content before sending. Event Email and central Email settings have different responsibilities.
6. When support requires another person's context, use the explicit authorized mechanism and its audit trail. Do not share credentials or make another role's menu visible as a workaround.

**Important exception:** a kitchen-only staff role intentionally lacks general event/registration access. A missing People or finance destination can be correct access behavior, not a broken navigation item.

## 3. Answers people are likely to need

| Question | Suggested answer |
|---|---|
| Must I create an account to register? | Guest registration remains available. An account can help you return to accessible registrations; it is separate from the private link for one registration. |
| Why can I not see my registration? | Check the event and the verified address on your account against the registration's contact address. Use the supported recovery route or event support before registering again. |
| Does my club roster register everyone for an event? | No. The roster keeps club membership; the event registration records who is attending that event and their choices. |
| Why does another club helper see fewer pages? | Pages follow the person's actual role. Registrar and reporter access differ from director/deputy access. |
| Does “submitted” mean paid, checked in and approved? | Those are separate states. Read the specific registration, payment, arrival or approval status shown for the task. |
| Should I pay a church-billed camporee balance online? | Follow the event's organization-billed instructions. The responsible church is billed through the office process; a director's submission does not make the director the debtor. |
| I asked to cancel. Is my refund complete? | A request begins review. Cancellation, refund approval, refund execution and successful refund recording are different steps. Follow the status message and contact the office when needed. |
| An email says queued or accepted. Did the person receive it? | That records a delivery stage. It does not establish inbox arrival or that the person read it. Use the available delivery evidence and support process. |
| Does a registration PDF contain exactly what every screen/export shows? | No. It is a versioned document with its own documented field/redaction rules, including the approved PDF-only exceptions. It is not a general health-record export. Share it only through its authorized workflow. |
| Why is a health or finance action unavailable to an administrator? | Some domains have dedicated permissions, purpose limits, time windows or break-glass requirements beyond an ordinary page link. Follow the approved workflow rather than changing roles to bypass it. |
| Are the new mockup screens available now? | They show accepted direction or proposals as labelled. The corresponding implementation issue must be delivered and available in the serving release before training calls it a current feature. |

## 4. Proposed short help and recovery copy

The following is **editorial copy for review**, not a claim that these messages or a new Help & learning page have been installed. [#1077](https://github.com/DurantTL/IMSDA-Events/issues/1077) remains the owner of future task-based help presentation.

| Situation | Ready-to-edit wording |
|---|---|
| Event context | **Working in [EVENT NAME].** Changes on this page apply to this event. |
| Club context | **[CLUB NAME] · [CLUB YEAR].** Check the year before changing this roster. |
| Empty personal registrations | **No registrations are available to this account yet.** Check your verified email address or use the private link from your confirmation. |
| Empty club roster | **No members are on this year's roster yet.** Add members before choosing who will attend an event. |
| No search matches | **No matches for these filters.** Clear a filter or change your search. |
| Save failure | **Your changes were not saved.** If fields are highlighted, review them and try again. Keep this page open to continue editing. |
| Unsaved changes | **You have unsaved changes.** Stay to finish, or discard them before leaving. |
| Read-only coordinator record | **This is a view-only club record.** Ask the club's director or the conference office to correct it. |
| Restricted destination | **This page is not available with your current access.** Return to your workspace or ask the office to check your assignment. |
| Saved public link | **Copy the saved public event link.** Unsaved address changes are not published or ready to share. |
| Queue or history count | **[N] unread alerts.** Reading an alert does not complete the task it describes. |
| Map coverage | **[N] clubs found; [M] shown on the map.** Clubs without a map location remain in the list. |
| Full-year export | **Download the full [YEAR] summary.** This export includes all clubs in your authorized scope, regardless of the visible name search. |
| Wrong kind of link | **This is a private registration link.** Share the public event page when inviting other people. |

Keep the action beside the explanation, retain entered values after recoverable errors and name the destination of a back link. An icon can support a label; it should not carry the whole explanation for a new user.

## 5. A practical support handoff

Start with context rather than requesting a data export. Ask for the role, event or club/year, page title, approximate time and time zone, the visible error text and the intended action. Ask the person to omit private links, birth dates, health information, credentials and card details from screenshots or messages.

| Reported problem | First useful check | Handoff |
|---|---|---|
| Club or workspace missing | Correct account, current grant, second step and selected context | Office access administrator |
| Registration missing | Correct verified email/event; existing recovery path | Event registration support |
| Save or validation problem | Field name, changed versus untouched value, retained draft, reproducible steps | Owning form/profile/roster issue |
| Amount or church invoice question | Direct versus organization billing; registration/payment/invoice state | Authorized finance staff |
| Check-in refused | Correct event/person and actual refusal category | Authorized check-in lead; existing override process where permitted |
| Email not received | Intended audience, current address, queued/suppressed/failed/accepted evidence | Communications lead or system Email administrator |
| Public link does not open | Public event/form link versus private link; saved/published/window state | Event setup support; #1115 if unsaved-link behavior is reproduced |

**Support ticket starter**

**Task:** [WHAT THE PERSON WAS TRYING TO DO]\
**Context:** [ROLE], [EVENT OR CLUB/YEAR], [PAGE TITLE]\
**When:** [DATE/TIME/TIME ZONE]\
**Expected result:** [EXPECTED VISIBLE BEHAVIOR]\
**Actual result:** [ERROR TEXT OR DESCRIPTION, WITHOUT PRIVATE DATA]\
**Steps:** [SHORT REPRODUCTION]\
**Reference:** [EXISTING ISSUE OR RESTRICTED SUPPORT REFERENCE]

The office can use its authorized tools to investigate identifiers internally. A public issue does not need a copy of an attendee record to explain the defect.

## 6. Draft communication content

All examples below are **prepared drafts, not sent messages**. Review audience, event, current state, contact details and links before use. An email mentioning a feature does not enable it. Keep reasons, health details, payment credentials and internal staff notes out of the message.

### A. Club director welcome — editorial draft

**Audience:** a newly invited director or deputy. **Use:** the existing individual invitation/onboarding process. Do not send a working invitation link to a shared mailing list.

**Subject:** Getting started with [CLUB NAME] in IMSDA Events

Hello [FIRST NAME],

Your invitation gives you access to [CLUB NAME] for your approved role. Open your personal invitation and complete the account and second-step prompts.

Once you are signed in, confirm the club and year on Home. Begin with the next task shown there. Review the roster, then use Club events to choose who will attend an event. Monthly Records and other tools appear according to your role.

For [CHURCH-BILLED EVENT], the sponsoring church is billed through the office process. Please do not send a personal payment unless the office specifically instructs you to do so.

Questions or a missing club? Contact [OFFICE SUPPORT CONTACT]. Please describe the page and problem without sending a password, private link or member's health details.

### B. Registration confirmation — supported-token draft

**Template context:** `REGISTRATION_CONFIRMATION_PAID` or `REGISTRATION_CONFIRMATION_UNPAID`, chosen by the existing current-state logic. **Condition:** an eligible direct-billed registration, not a waitlist or cancelled-record blast.

**Subject:** Your {{event_name}} registration

Hello {{recipient_name}},

Your registration for {{event_name}} is recorded. Your confirmation code is **{{confirmation_code}}**.

**When:** {{event_dates}}\
**Where:** {{event_location}}

{{payment_status_block}}

[View your registration]({{portal_url}}) to review the people included and the actions currently available to you. Keep that link private.

Questions? Contact {{contact_email}}.

### C. Balance reminder — supported-token draft

**Template context:** `BALANCE_REMINDER`. **Condition:** the reviewed current amount-due audience and existing reminder workflow. Recheck eligibility at execution; exclude waitlisted/cancelled records and organization-billed registrations where no personal online payment is due.

**Subject:** A balance remains for {{event_name}}

Hello {{recipient_name}},

The current recorded balance for registration **{{confirmation_code}}** is **{{balance_amount}}**.

[Review your registration and payment options]({{portal_url}}). If you recently paid, the payment may still be processing. Contact {{contact_email}} if the amount or status does not look right.

Do not add a late-fee or blocked-access warning: the recorded payment-due feature is a reminder, not an automatic penalty.

### D. Organization-billed registration — supported-token draft

**Template context:** `REGISTRATION_CONFIRMATION_ORGANIZATION_BILLED`. **Condition:** an actual deferred-organization-billing event. This is not the separate finalized invoice delivery.

**Subject:** Registration recorded for {{event_name}}

Hello {{recipient_name}},

Registration **{{confirmation_code}}** is recorded for {{event_name}}. This event bills the responsible organization through the office process. **No personal online payment is due for this registration.**

[Review the registration]({{portal_url}}) and check the people attending and their event choices. The office will follow the event's reconciliation and invoicing process separately.

Questions about registration or billing responsibility? Contact {{contact_email}}.

### E. Event information update — editorial draft

**Audience:** the reviewed applicable event audience. **Use:** the existing event announcement/custom-message workflow; saved public content alone does not send this message.

**Subject:** [EVENT NAME]: [SHORT DESCRIPTION OF CHANGE]

Hello,

The following information for [EVENT NAME] has changed:

**What changed:** [APPROVED NEW INFORMATION]\
**When it applies:** [DATE/TIME/TIME ZONE]\
**What you need to do:** [ONE CLEAR ACTION, OR “NO ACTION IS NEEDED”]

Read the current event information at [PUBLIC EVENT URL]. For questions, contact [EVENT SUPPORT CONTACT].

Choose the audience deliberately if the change applies only to one location, group or class. Avoid a generic “everyone” message when only one subset needs to act.

### F. Waitlist acknowledgment — supported-token draft

**Template context:** `WAITLIST_JOINED`. **Condition:** an actual waitlisted registration. Promotion has its own message and eligibility rules.

**Subject:** You are on the {{event_name}} waitlist

Hello {{recipient_name}},

Registration **{{confirmation_code}}** is on the waitlist for {{event_name}}. This message does not confirm a place, and **no payment is due while you are waitlisted**.

[Review your waitlist registration]({{portal_url}}). If a place becomes available, the event's promotion process will explain the next step.

Questions? Contact {{contact_email}}.

### G. Cancellation request received — supported-token draft

**Template context:** `CANCELLATION_REQUEST_RECEIVED`. **Condition:** the request was successfully recorded. Do not include the person's reason, staff notes, refund amount or a promised outcome.

**Subject:** Cancellation request received for {{event_name}}

Hello {{recipient_name}},

We received a cancellation request for registration **{{confirmation_code}}**. The request is waiting for review; this acknowledgment does not itself change the registration or issue a refund.

[View the request and current registration status]({{portal_url}}). Contact {{contact_email}} if you need help.

### H. New-feature announcement — editorial draft

**Audience:** the roles that will actually use the feature. **Condition:** a named feature is delivered, enabled as appropriate and verified in the serving release. An accepted mockup or merged documentation PR is insufficient.

**Subject:** [FEATURE NAME] is available for [ROLE/AUDIENCE]

You can now [SPECIFIC TASK] in [EXISTING DESTINATION]. This helps you [PRACTICAL BENEFIT].

**Start here:** [CURRENT VERIFIED INSTRUCTIONS OR HELP LINK]\
**Who can use it:** [ACTUAL ROLE/GRANT]\
**What you need to do:** [ACTION OR “NOTHING UNTIL YOUR NEXT TASK”]

If your screen or access differs, contact [SUPPORT CONTACT] with your role and the page title.

## 7. Describe future features without promising them

Use wording that matches the evidence:

| Evidence | Wording to use |
|---|---|
| Feature present in source, serving availability not verified | “Implemented in the repository; availability depends on the serving release and configuration.” |
| Implemented but intentionally gated | “Prepared behind an activation or policy gate; not announced as generally available.” |
| Accepted design, implementation open | “The design direction is accepted. The implementation issue remains open.” |
| Planned or exploratory issue | “A future possibility being planned; scope and timing are not committed.” |
| Vendor capability or access unconfirmed | “Requires confirmation from the provider before an integration can be promised.” |

Apply that language to the form-builder redesign, task-based Help & learning, future Adventurer scope, wallets, native mobile, broad site building, installment charging, incident/personnel systems and UltraCamp exchange. Do not convert their presence in a feature deck into a launch date or approval. Use [#98](https://github.com/DurantTL/IMSDA-Events/issues/98) for delivery order and the owning issue for its actual scope.

## 8. Training facilitator notes and slide talking points

Use these as an orientation around the already-prepared rehearsal scenarios, not a replacement rehearsal plan.

1. **One system, different jobs.** Show the four role examples, clearly labelled as current or accepted/proposed design. Ask learners to identify the record scope before choosing an action.
2. **Where am I working?** Point to the event or club/year. Demonstrate the existing return links and authorized context switch without introducing another menu.
3. **What does this state mean?** Compare registration, payment, invoice, email delivery and check-in. Avoid a single green badge as shorthand for all five.
4. **Where do I start?** Attendee: own registration; director: club Home and next task; coordinator: record follow-up; administrator: System or selected event task.
5. **How do I recover?** Show a safe synthetic example of a validation or access problem, then use the support ticket starter. Never demonstrate with a real private link or protected record.
6. **What is coming later?** Show separate “implemented,” “gated,” “accepted design” and “planned” labels. Invite task feedback without turning proposed screens into commitments.

Before distributing a training document, replace editorial placeholders, check every public destination and menu label against the serving release, label screenshots with their capture date/status and use synthetic records. Keep private links out of shared slides. Record the document version so a future screen change can update the instructions without rewriting the whole guide.

## 9. Existing material to reuse

- [Navigation conventions and current destinations](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/NAVIGATION.md).
- [Existing staff event workflow](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/STAFF-EVENT-WORKFLOW.md).
- [Role/source contract and accepted design package](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/design/role-workspaces/README.md).
- [Current role capability rules](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/modules/organizations/director-grants-domain.ts).
- [Message keys, token allowlist and template meanings](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/modules/communications/templates.ts).
- [Organization billing responsibility](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/BILLING-RESPONSIBILITY.md) and [invoice workflow](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/INVOICES.md).
- [Staff/pastor/volunteer invitation workflow](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/STAFF-INVITATIONS.md).
- [Registration PDF content, versions and channel-specific exceptions](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/REGISTRATION-PDF.md).
- [Existing reference CSV/JSON material](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/reference/README.md) and [sample registration PDF](https://github.com/DurantTL/IMSDA-Events/blob/5e367b7c4d1b3c173d37c0415e335be76170b300/docs/samples/registration-pdf-sample.pdf).
- [Current implementation-preparation index](https://github.com/DurantTL/IMSDA-Events/issues/844), [accepted role issue index](https://github.com/DurantTL/IMSDA-Events/issues/1109) and [Help & learning owner](https://github.com/DurantTL/IMSDA-Events/issues/1077).

No application, permission, menu, template or delivery setting was changed in preparing this kit. The proposed microcopy and communication drafts remain editorial artifacts for review.
