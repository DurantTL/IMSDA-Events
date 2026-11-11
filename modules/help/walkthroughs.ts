import type { PortalAudience, PortalGuide, WalkthroughStep } from "@/modules/help/types";

/**
 * Walkthroughs (#1482): step-by-step guides with a picture of the real screen for every step. This file is pure data
 * (no Playwright, no database). The browser actions that drive each screen live in `tests/browser/walkthroughs/`, keyed by
 * the same walkthrough and step ids; `scripts/capture-help-screenshots.ts` runs them and saves the pictures. Each walkthrough
 * is its own portal guide, so Help search, the hub and the Getting started links reach it like any other guide.
 * `docs/HELP-AND-LEARNING.md` ("Walkthroughs") says how to add one.
 *
 * Wording rules: one or two plain sentences, short words, the exact on-screen labels, no jargon. Sample data only.
 */
export type WalkthroughDefinition = {
  /** The portal guide id. Stable: picture paths, links and search depend on it. */
  id: string;
  audience: PortalAudience;
  title: string;
  summary: string;
  needs: readonly string[];
  changes: readonly string[];
  verify: readonly string[];
  next: string;
  destinationIds: readonly string[];
  keywords: readonly string[];
  /**
   * Repo-relative app files whose change can change what the pictures show. `npm run help:check` hashes them and warns when
   * the pictures were captured from different source.
   */
  sourceFiles: readonly string[];
  steps: readonly WalkthroughStep[];
};

const REVIEWED = "2026-11-11";
const OWNER = "Communication office";
const CLUB = "app/(public)/account/(portal)/clubs/[organizationId]";
const SHELL = ["components/club-portal-masthead-view.tsx", "components/club-portal-nav.tsx", "modules/club-rosters/portal-nav.ts", "modules/club-rosters/portal-phone-bar.ts"] as const;

export const directorWalkthroughs: readonly WalkthroughDefinition[] = [
  {
    id: "walkthrough-director-first-sign-in",
    audience: "director",
    title: "Step by step: First sign-in",
    summary: "Sign in with your email and password, then type the six-digit code we email you.",
    needs: ["Your account email and password.", "Access to that email inbox."],
    changes: ["Nothing. You sign in to your account."],
    verify: ["Your account Overview opens.", "The code page does not show an error."],
    next: "Set up two-step sign-in so you can skip the emailed code next time.",
    destinationIds: ["portal-overview", "portal-security"],
    keywords: ["sign in", "first sign-in", "log in", "login", "emailed code", "six-digit code", "code", "password", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [
      "app/(public)/account/sign-in/page.tsx",
      "app/(public)/account/sign-in/code/page.tsx",
      "components/attendee-sign-in-form.tsx",
      "components/sign-in-code-form.tsx",
      "app/(public)/account/(portal)/page.tsx", "components/account-section-nav.tsx", "components/one-time-code-input.tsx", "components/passkey-sign-in-button.tsx", "components/sign-in-code-form.module.css"],
    steps: [
      { id: "open-sign-in", text: "Open the account sign-in page.", alt: "The Account sign in page, with the Email address box marked." },
      { id: "type-email", text: "Type your email address in the Email address box.", alt: "The sign-in form with an email address typed in the Email address box, which is marked." },
      { id: "type-password", text: "Type your password in the Password box.", alt: "The sign-in form with the Password box marked and filled with dots." },
      { id: "sign-in", text: "Choose Sign in.", alt: "The sign-in form filled in, with the Sign in button marked." },
      { id: "check-email", text: "We email you a six-digit code. Open that email and find the code.", alt: "The Check your email page, saying a six-digit code was sent, with the empty Sign-in code box marked." },
      { id: "enter-code", text: "Type the six digits in the Sign-in code box.", alt: "The Check your email page with the six digits typed in the Sign-in code box, which is marked." },
      { id: "confirm-code", text: "Choose Sign in.", alt: "The Check your email page with the code typed in and the Sign in button marked." },
      { id: "signed-in", text: "You are signed in. Your account Overview opens.", alt: "The account Overview page, which opens after the code is accepted, with its welcome heading marked." },
    ],
  },
  {
    id: "walkthrough-director-two-step",
    audience: "director",
    title: "Step by step: Set up two-step sign-in",
    summary: "Add a passkey so you use your fingerprint, face or PIN instead of an emailed code. A passkey is marked Easiest.",
    needs: ["Your account, signed in with the emailed code.", "A phone or computer that can keep a passkey."],
    changes: ["Your account gets a passkey. Nothing about your club changes."],
    verify: ["The page says Two-step sign-in is on.", "Club pages open without an emailed code."],
    next: "Add your leaders and staff so they set up their own two-step sign-in.",
    destinationIds: ["portal-security", "club-home"],
    keywords: ["two-step", "two step", "2fa", "passkey", "easiest", "fingerprint", "face", "security", "tired of codes", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [
      "app/(public)/account/two-step/page.tsx",
      "app/(public)/account/sign-in/code/page.tsx",
      "components/two-step-setup.tsx",
      "components/passkey-manager.tsx",
      "components/sign-in-code-form.tsx",
      "components/one-time-code-input.tsx", "components/passkey-unlock-button.tsx", "components/two-step-setup.module.css", "components/sign-in-code-form.module.css"],
    steps: [
      { id: "code-page", text: "Sign in with your email and password. On the Check your email page, type the six-digit code we emailed you.", alt: "The Check your email page with the six-digit code typed in the Sign-in code box, which is marked." },
      { id: "code-link", text: "Choose Enter your code, then set up two-step sign-in.", alt: "The Check your email page with the link Enter your code, then set up two-step sign-in marked." },
      { id: "start", text: "Choose Set up two-step sign-in.", alt: "The Turn on two-step sign-in page with the Set up two-step sign-in button marked." },
      { id: "choose-passkey", text: "Pick This phone or computer. It is the one marked Easiest.", alt: "The choice of how to confirm it is you, with This phone or computer marked Easiest." },
      { id: "continue", text: "Choose Continue.", alt: "The choice of how to confirm it is you, with This phone or computer picked and the Continue button marked." },
      { id: "add-passkey", text: "Choose Add a passkey. Your device then asks for your fingerprint, face or PIN.", alt: "The passkey page with the Add a passkey button marked." },
      { id: "done", text: "The page says Two-step sign-in is on. Club pages now open.", alt: "The page that says Two-step sign-in is on, with that heading marked." },
    ],
  },
  {
    id: "walkthrough-director-leaders",
    audience: "director",
    title: "Step by step: Add a leader and send an invite",
    summary: "Give a registrar or reporter a role in your club. They get an invite by email if they have no account yet.",
    needs: ["A club role of Director or Deputy.", "The email address of the person to add."],
    changes: ["The person gets the role you pick, right away or when they accept the invite."],
    verify: ["Club admins lists the person, or Pending invites shows an invite waiting."],
    next: "Add the people in your club to the roster.",
    destinationIds: ["club-settings"],
    keywords: ["leader", "leaders", "invite", "send an invite", "registrar", "reporter", "club admin", "club admins", "add someone", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/club-info/page.tsx`, "components/club-team-workspace.tsx", ...SHELL, "components/club-profile-form.tsx", "components/confirm-dialog.tsx", "components/role-details.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-settings", text: "Open Club settings in your club menu. On a phone, tap More at the bottom, then Club settings.", alt: "A club page with Club settings in the club menu marked. On a phone, the More button at the bottom is marked." },
      { id: "open-dialog", text: "Under Club admins, choose Add club admin.", alt: "The Club settings page, with the Add club admin button under Club admins marked." },
      { id: "fill-invite", text: "Type their email address in the Their email box.", alt: "The Give a role window with an email address typed in the Their email box, which is marked." },
      { id: "pick-role", text: "In the Role box, pick Registrar or Reporter.", alt: "The Give a role window with the Role box marked." },
      { id: "send", text: "Choose Add club admin. Someone with an account gets the role at once; anyone else gets an email invite.", alt: "The Give a role window filled in, with the Add club admin button marked." },
      { id: "see-invite", text: "The person now shows under Club admins with their role. Someone who has no account yet shows under Pending invites until they accept.", alt: "The Club admins list showing the new person's name, email and role, with the role marked." },
    ],
  },
  {
    id: "walkthrough-director-roster",
    audience: "director",
    title: "Step by step: Add, edit and remove a roster member",
    summary: "Add a person to your roster, change their details, and take them off when they leave.",
    needs: ["A club role of Director, Deputy or Registrar."],
    changes: ["The roster for the club year changes. Removing someone erases their emergency contacts."],
    verify: ["The roster shows the new person, then the change, then no longer shows them."],
    next: "Fill in the club forms for the new year.",
    destinationIds: ["club-roster"],
    keywords: ["roster", "add member", "edit member", "remove member", "add person", "add to roster", "pathfinder", "staff", "actions", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/roster/page.tsx`, "components/club-roster-workspace.tsx", "components/club-roster-sections.module.css", ...SHELL, "components/actions-menu.tsx", "components/birth-date-field.tsx", "components/roster-guardian-fields.tsx", "components/roster-type-definitions.tsx", "components/confirm-dialog.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-roster", text: "Open Roster in your club menu.", alt: "A club page with Roster in the club menu marked. On a phone, it is in the bar at the bottom." },
      { id: "add-open", text: "Choose Add to roster.", alt: "The Roster page, with the Add to roster button marked." },
      { id: "add-name", text: "Type the first name and the last name.", alt: "The Add to the roster window with the First name and Last name boxes filled in and marked." },
      { id: "add-birth", text: "Type the birth date, like 4/17/2014.", alt: "The Add to the roster window with the Birth date box marked and filled in. Under it the page says how it reads the date." },
      { id: "add-gender", text: "Pick the Gender. Here you can also pick the Type and the Current class.", alt: "The Add to the roster window with the Gender box marked, filled in under the Role box." },
      { id: "add-save", text: "Choose Add to roster.", alt: "The Add to the roster window filled in, with its Add to roster button marked." },
      { id: "edit-open", text: "The person is on your roster. To change them, choose Edit in their row.", alt: "The roster list with the Edit button in the new person's row marked." },
      { id: "edit-fields", text: "Change what you need, such as the Role.", alt: "The Edit window for the person with the Role box marked." },
      { id: "edit-save", text: "Choose Save.", alt: "The Edit window with the Save button marked." },
      { id: "remove-actions", text: "To take someone off, choose Actions in their row.", alt: "The roster list with the Actions button in the person's row marked." },
      { id: "remove-menu", text: "In the Actions menu, choose Remove.", alt: "The roster list with the person's Actions menu open, and Remove in it marked." },
      { id: "remove-confirm", text: "Check the name in the window. Then choose the red Remove button with their name on it.", alt: "The window that asks you to confirm removing the person, with the red Remove button marked." },
    ],
  },
  {
    id: "walkthrough-director-club-forms",
    audience: "director",
    title: "Step by step: Yearly club forms",
    summary: "Fill in the forms the conference asks for each year, or send a private link so a parent can fill one in.",
    needs: ["A club role of Director or Deputy."],
    changes: ["A form you fill in is saved as a draft until you submit it. A private link works once."],
    verify: ["Required forms no longer show Missing.", "Filled forms lists what you submitted."],
    next: "Register your club for an event.",
    destinationIds: ["club-forms"],
    keywords: ["forms", "club forms", "yearly forms", "required forms", "fill in", "send link", "private link", "missing", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/forms/page.tsx`, `${CLUB}/forms/[templateKey]/new/page.tsx`, "components/club-forms-lists.tsx", "components/club-form-fill-in.tsx", ...SHELL, "components/club-forms-actions.tsx", "components/club-forms-lists.module.css", "components/club-form-date-input.tsx", "components/club-form-section-title.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-forms", text: "Open Forms in your club menu. On a phone, tap More at the bottom, then Forms.", alt: "A club page with Forms in the club menu marked. On a phone, the More button at the bottom is marked." },
      { id: "required", text: "Required forms are at the top. Missing means the form is not filled in yet.", alt: "The Forms page, with the Required forms list and a Missing label marked." },
      { id: "fill-in", text: "Choose Fill in beside a required form.", alt: "The Forms page with the Fill in button beside a required form marked." },
      { id: "form-who", text: "Under Who is this form for, pick the Roster member. If it is not for a roster member, leave it as it is.", alt: "A club form open, with the Roster member choice under Who is this form for marked." },
      { id: "form-answer", text: "Answer the questions. A star means the answer is required.", alt: "A club form with its first questions, and the first question marked." },
      { id: "form-submit", text: "Choose Save draft to keep it for later, or Submit form when it is done.", alt: "The bottom of the club form with the Submit form button and the Save draft button marked." },
      { id: "send-link", text: "To let a parent fill in a form, choose Send a private link beside the form.", alt: "The Forms page with the Send a private link button beside a required form marked." },
      { id: "link-email", text: "Type the email address to send it to.", alt: "The private link form with an email address typed in the Email address to send it to box, which is marked." },
      { id: "link-send", text: "Choose Send link. The person gets an email, and the link works once.", alt: "The private link form with the Send link button marked." },
    ],
  },
  {
    id: "walkthrough-director-register-event",
    audience: "director",
    title: "Step by step: Register your club for an event",
    summary: "Find an open club event, choose who is going, and fill in your registration.",
    needs: ["A club role of Director, Deputy or Registrar.", "People on your roster."],
    changes: ["Your choices are saved as a draft as you go. Registering holds a place for the people you choose. Payment follows the event's billing."],
    verify: ["After you submit, Club events shows the event with its registration status."],
    next: "Build your order list.",
    destinationIds: ["club-events"],
    keywords: ["event", "events", "register", "registration", "club event", "who's going", "roster", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/events/page.tsx`, `${CLUB}/events/[eventId]/page.tsx`, "components/club-event-list.tsx", "components/club-registration-workspace.tsx", ...SHELL, "components/club-roster-age-field.tsx", "components/missing-age-summary.tsx", "components/public-registration-form.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-events", text: "Open Club events in your club menu. On a phone, tap Events at the bottom.", alt: "A club page with Club events in the club menu marked. On a phone, Events in the bar at the bottom is marked." },
      { id: "register", text: "Choose Register beside an open event.", alt: "The Club events page, with the Register button beside an open event marked." },
      { id: "whos-going", text: "Tap each person who is going, or choose Select everyone.", alt: "The Who's going page with the Select everyone button marked." },
      { id: "continue", text: "Choose Continue with, then the number of people. For example, Continue with 8 people.", alt: "The Who's going page with everyone picked and the Continue with people button marked." },
      { id: "contact", text: "Check the contact details. Change anything that is wrong.", alt: "The Contact step of the registration form, with the name and email boxes marked." },
      { id: "contact-continue", text: "Choose Continue.", alt: "The Contact step of the registration form, with the Continue button marked." },
      { id: "review", text: "Look over each person. To fix someone, choose Edit beside their name.", alt: "The Roster step of the registration form listing each person, with the first person's Edit button marked." },
      { id: "review-continue", text: "When it is right, choose Continue.", alt: "The Roster step of the registration form with the Continue button marked." },
      { id: "check-answers", text: "On the Review & submit page, check the answers and the price.", alt: "The Review & submit step of the registration form, with the Registration details answers marked." },
      { id: "submit", text: "When it is right, choose Submit registration.", alt: "The bottom of the Review & submit step with the Submit registration button marked." },
    ],
  },
  {
    id: "walkthrough-director-orders",
    audience: "director",
    title: "Step by step: Orders and supplies",
    summary: "Build your club's order list and keep count of the supplies you have on hand.",
    needs: ["A club role of Director, Deputy or Registrar. Only a Director or Deputy changes the list."],
    changes: ["Your list is saved. Nothing is ordered for you: you still order from AdventSource."],
    verify: ["Your order list shows the items you added."],
    next: "Keep your Monthly Records up to date.",
    destinationIds: ["club-orders"],
    keywords: ["orders", "order list", "supplies", "stock", "on hand", "add an item", "catalog", "adventsource", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/orders/page.tsx`, "components/club-order-workspace.tsx", "components/club-orders.module.css", ...SHELL, "components/club-supply-stock-workspace.tsx", "components/club-uniform-section.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-orders", text: "Open Orders in your club menu. On a phone, tap More at the bottom, then Orders.", alt: "A club page with Orders in the club menu marked. On a phone, the More button at the bottom is marked." },
      { id: "find-item", text: "Under Add an item, start typing the item's name in the Search honors and items box. Then pick the item from the list.", alt: "The Orders page with a name typed in the Search honors and items box, and the matching item in the list marked." },
      { id: "add-item", text: "Choose Add to list.", alt: "The Add an item form with an item picked and the Add to list button marked." },
      { id: "on-list", text: "The item is now on Your order list. You can change its quantity there.", alt: "Your order list showing the item that was added, with its row marked." },
      { id: "stock-count", text: "Under Inventory, type how many you have on hand.", alt: "The Inventory list with a number typed in the count box for one item, which is marked." },
      { id: "stock-save", text: "Choose Save under the count.", alt: "The Inventory list with the Save button under the count marked." },
    ],
  },
  {
    id: "walkthrough-director-monthly-records",
    audience: "director",
    title: "Step by step: Monthly Records",
    summary: "File your club's record for a month that has ended. It is due on the 10th of the next month.",
    needs: ["A club role of Director, Deputy or Reporter."],
    changes: ["The record is saved as a draft until you submit it."],
    verify: ["The month shows as filed on Monthly Records."],
    next: "File the Year-End Report in spring.",
    destinationIds: ["club-records"],
    keywords: ["monthly records", "monthly record", "report", "reports", "due the 10th", "submit report", "points", "attendance", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/records/page.tsx`, "components/club-report-form.tsx", ...SHELL, "components/club-meeting-notes.tsx", "components/club-year-tiles.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-records", text: "Open Monthly Records in your club menu. On a phone, tap Records at the bottom.", alt: "A club page with Monthly Records in the club menu marked. On a phone, Records in the bar at the bottom is marked." },
      { id: "open-month", text: "Choose Open beside the month that has no record.", alt: "The Monthly Records page, with the Open button beside a month marked." },
      { id: "open-form", text: "Choose Open Monthly Record.", alt: "The month's page with the Open Monthly Record button marked." },
      { id: "fill-record", text: "Fill in the meeting details and head counts, such as Average attendance.", alt: "A Monthly Record open for filling in, with the Average attendance box marked." },
      { id: "submit-record", text: "Choose Save draft to keep it for later, or Submit report when it is done.", alt: "The bottom of the Monthly Record with the Submit report button and the Save draft button marked." },
    ],
  },
  {
    id: "walkthrough-director-year-end",
    audience: "director",
    title: "Step by step: Year-End Report",
    summary: "File the Year-End Report each spring. Your roster, honors and classes fill in most of it.",
    needs: ["A club role of Director, Deputy or Reporter."],
    changes: ["The report is saved as a draft until you submit it. It holds counts only, never names."],
    verify: ["The Year-End Report shows as filed on Monthly Records."],
    next: "Nothing else is needed until next year.",
    destinationIds: ["club-records"],
    keywords: ["year-end", "year end", "year-end report", "yearly report", "april 1", "report", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/records/page.tsx`, `${CLUB}/reports/year-end/[year]/page.tsx`, "components/club-year-end-report-form.tsx", ...SHELL, "components/club-year-end-conference.tsx", "components/email-input.tsx", "components/phone-input.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-records", text: "Open Monthly Records in your club menu. On a phone, tap Records at the bottom.", alt: "A club page with Monthly Records in the club menu marked. On a phone, Records in the bar at the bottom is marked." },
      { id: "open-report", text: "Under Year-End Report, choose Open report.", alt: "The Year-End Report list on Monthly Records, with an Open report button marked." },
      { id: "who-reporting", text: "Under Who is reporting, type your name and your email.", alt: "The Year-End Report with the Name and Email boxes under Who is reporting marked." },
      { id: "check-counts", text: "Check the counts, which are filled in from your roster. To fix one, type the right number.", alt: "The Membership section of the Year-End Report, with the Membership total marked." },
      { id: "submit-report", text: "Choose Save draft to keep it for later, or Submit report when it is done.", alt: "The bottom of the Year-End Report with the Submit report button and the Save draft button marked." },
    ],
  },
  {
    id: "walkthrough-director-get-help",
    audience: "director",
    title: "Step by step: Get help",
    summary: "Use the Forms help button for answers, and see how to reach the support team.",
    needs: ["A club role on at least one club."],
    changes: ["Nothing. Help only shows information."],
    verify: ["You can find the support email and phone number."],
    next: "Search the Help guides in your account for the task you are doing.",
    destinationIds: ["club-home"],
    keywords: ["help", "support", "contact", "forms help", "email support", "phone", "need help", "translation", "step by step", "walkthrough", "screenshots"],
    sourceFiles: ["components/forms-help.tsx", "components/club-portal-masthead-view.tsx", "components/forms-help.module.css", "modules/system-admin/forms-help-contact.ts", "app/(public)/account/(portal)/clubs/[organizationId]/page.tsx", "components/club-overview.tsx", "components/club-portal-masthead-view.module.css", "components/club-portal-masthead.tsx"],
    steps: [
      { id: "open-help", text: "On any club page, choose Forms help at the top.", alt: "A club page with the Forms help button at the top marked." },
      { id: "help-choices", text: "Pick the choice that fits, such as Having form issues? or Need translation?.", alt: "The Forms help window listing Having form issues, Need translation and Need more help, with those three choices marked." },
      { id: "support-contact", text: "Choose Need more help? to see the support email and phone number.", alt: "The Forms help window showing the support email and phone number, with Need more help marked." },
    ],
  },
];

const AREA = "app/(public)/account/(portal)/area-clubs";
const COORDINATOR_SHELL = ["components/coordinator-masthead-view.tsx", "components/coordinator-shell-header.tsx", "components/area-clubs-subnav.tsx"] as const;
const COORDINATOR_NEEDS = ["An Area Coordinator account, signed in with two-step sign-in."] as const;

export const coordinatorWalkthroughs: readonly WalkthroughDefinition[] = [
  {
    id: "walkthrough-coordinator-sign-in",
    audience: "coordinator",
    title: "Step by step: Sign in as an area coordinator",
    summary: "Sign in with your email and password, then confirm it is you with your two-step sign-in.",
    needs: ["Your account email and password.", "Your authenticator app or passkey, set up with the conference."],
    changes: ["Nothing. You sign in to your account."],
    verify: ["Your account Overview opens, with Club coordination in the tabs."],
    next: "Open Club coordination to see your clubs.",
    destinationIds: ["portal-overview", "portal-security"],
    keywords: ["sign in", "log in", "login", "coordinator", "area coordinator", "two-step", "authenticator code", "passkey", "confirm it's you", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [
      "app/(public)/account/sign-in/page.tsx",
      "app/(public)/account/two-step/page.tsx",
      "components/attendee-sign-in-form.tsx",
      "components/roster-unlock-form.tsx",
      "components/passkey-unlock-button.tsx", "components/one-time-code-input.tsx", "components/account-section-nav.tsx", "components/area-coordinator-card.tsx", "app/(public)/account/(portal)/page.tsx"],
    steps: [
      { id: "enter-details", text: "Open the account sign-in page. Type your email address and password, then choose Sign in.", alt: "The Account sign in page filled in, with the Sign in button marked." },
      { id: "confirm", text: "The Confirm it's you page opens. Use your passkey, or find the six-digit code in your authenticator app.", alt: "The Confirm it's you page, with the Authenticator code box marked." },
      { id: "enter-code", text: "Type the code. Then choose Continue.", alt: "The Confirm it's you page with the code typed in and the Continue button marked." },
      { id: "signed-in", text: "You are signed in. Choose Club coordination to see your clubs (on a phone, it is in the Account menu).", alt: "The account Overview with the Club coordination tab marked, or the Account menu on a phone." },
    ],
  },
  {
    id: "walkthrough-coordinator-clubs",
    audience: "coordinator",
    title: "Step by step: Your clubs and Who's missing what",
    summary: "Find a club, read what it has filed, and see which clubs are missing something.",
    needs: [...COORDINATOR_NEEDS],
    changes: ["Nothing. Your view is read only."],
    verify: ["You can open a club and read its page.", "You can say which clubs are missing something."],
    next: "Follow up with a club that is behind.",
    destinationIds: ["coordinator-overview", "coordinator-clubs"],
    keywords: ["clubs", "clubs at a glance", "find a club", "open club", "who's missing what", "whos missing", "overview", "search", "view only", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${AREA}/overview/page.tsx`, "app/(public)/account/(portal)/clubs/page.tsx", "components/coordinator-clubs-glance.module.css", "app/(public)/account/(portal)/area/[organizationId]/page.tsx", "components/coordinator-overview.tsx", "components/coordinator-whos-missing.tsx", "components/area-clubs-views.tsx", ...COORDINATOR_SHELL, "components/area-club-search-form.tsx", "components/club-overview.tsx", "components/club-year-tiles.tsx", "components/coordinator-whos-missing.module.css", "components/setup-checklist-panel.tsx", "components/table-card-labels.tsx"],
    steps: [
      { id: "open-clubs", text: "On Club coordination, choose Overview, then find Clubs at a glance.", alt: "The Club overview page with the Clubs at a glance list marked." },
      { id: "search", text: "Every active club is listed. Type a club, church or city in Search clubs to find one.", alt: "The Clubs at a glance list with the search box marked." },
      { id: "open-club", text: "Choose the club name or Open club to read what the club has. A club you run says Your club and opens normally.", alt: "The Clubs at a glance list with an Open club button marked." },
      { id: "whos-missing", text: "Back on Overview, Who's missing what lists each club that is missing something, with one next step.", alt: "The Who's missing what list on the Club overview." },
    ],
  },
  {
    id: "walkthrough-coordinator-records",
    audience: "coordinator",
    title: "Step by step: Review Monthly Records",
    summary: "See which clubs filed each month, and read a record a club filed.",
    needs: [...COORDINATOR_NEEDS],
    changes: ["Nothing. Reading a record does not approve or change it."],
    verify: ["You can say which clubs filed a month, and read one record."],
    next: "Follow up with a club that is behind.",
    destinationIds: ["coordinator-records"],
    keywords: ["monthly records", "records", "filed", "submitted", "not submitted", "month", "review", "due the 10th", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${AREA}/reports/page.tsx`, "app/(public)/account/(portal)/area/[organizationId]/reports/[month]/page.tsx", "components/coordinator-monthly-records.tsx", ...COORDINATOR_SHELL, "components/club-report-charts.tsx", "components/coordinator-monthly-records.module.css", "components/table-card-labels.tsx"],
    steps: [
      { id: "open-records", text: "On Club coordination, choose Monthly Records (on a phone, it is in the Coordinator menu).", alt: "The Club overview with the Monthly Records tab marked." },
      { id: "pick-month", text: "Pick a month. Each month shows how many clubs filed.", alt: "The Monthly Records page with the month buttons marked." },
      { id: "see-states", text: "Submitted means the club filed. Not submitted means the month ended and nothing is filed.", alt: "The Monthly Records page for one month, with the Submitted count marked." },
      { id: "open-record", text: "Choose a filed month for a club to read its record.", alt: "The table of clubs with a filed month for one club marked." },
    ],
  },
  {
    id: "walkthrough-coordinator-points",
    audience: "coordinator",
    title: "Step by step: Read the Points ranking",
    summary: "See each club's points for the year and what they are made of.",
    needs: [...COORDINATOR_NEEDS],
    changes: ["Nothing. This page is reading only."],
    verify: ["You can say which club leads and what a club's total is made of."],
    next: "Follow up with a club that is behind.",
    destinationIds: ["coordinator-points"],
    keywords: ["points", "ranking", "leader", "score", "total points", "report points", "chart", "table", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${AREA}/points/page.tsx`, "components/coordinator-points.tsx", ...COORDINATOR_SHELL, "components/coordinator-destinations.tsx", "components/coordinator-points.module.css", "components/table-card-labels.tsx"],
    steps: [
      { id: "open-points", text: "On Club coordination, choose Points (on a phone, it is in the Coordinator menu).", alt: "The Club overview with the Points tab marked." },
      { id: "chart", text: "The chart ranks the clubs by total points. The leader is shown at the top.", alt: "The Points page with the Points leader card marked." },
      { id: "table", text: "Choose Show as a table to see the full list.", alt: "The Points page with the Show as a table button marked." },
      { id: "table-open", text: "Each row shows the club's points and a link to the records behind them.", alt: "The Points table with the ranking and a club's Records link marked." },
    ],
  },
  {
    id: "walkthrough-coordinator-follow-up",
    audience: "coordinator",
    title: "Step by step: Follow up with a club that is behind",
    summary: "Find a club that is missing a record, read what it has filed, and see who to contact.",
    needs: [...COORDINATOR_NEEDS],
    changes: ["Nothing. The app sends no messages and sets no deadline: you contact the director yourself."],
    verify: ["You know which month is missing and who to contact."],
    next: "Check Monthly Records for the whole year.",
    destinationIds: ["coordinator-overview", "coordinator-records"],
    keywords: ["follow up", "behind", "late", "missing", "overdue", "contact the director", "who's missing what", "next step", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${AREA}/overview/page.tsx`, "app/(public)/account/(portal)/area/[organizationId]/page.tsx", "components/coordinator-overview.tsx", "components/coordinator-whos-missing.tsx", ...COORDINATOR_SHELL, "components/club-overview.tsx", "components/coordinator-whos-missing.module.css", "components/setup-checklist-panel.tsx", "components/table-card-labels.tsx"],
    steps: [
      { id: "find-club", text: "On Overview, find the club in Who's missing what. Missing or Missing 1 earlier month says what is not filed.", alt: "The Who's missing what list with a club's Missing marks marked." },
      { id: "next-step", text: "Read the next step. The app sends nothing for you.", alt: "The Who's missing what list with the club's next step marked." },
      { id: "open-club", text: "Choose Open club to read what the club has filed.", alt: "The Who's missing what list with the club's Open club link marked." },
      { id: "club-records", text: "Monthly Records shows each month as submitted or Not submitted.", alt: "The club's page with its Monthly Records list marked." },
      { id: "contact", text: "Club admins shows the director and their email. Contact them yourself.", alt: "The club's page with the Club admins section and the director marked." },
    ],
  },
  {
    id: "walkthrough-coordinator-no-director",
    audience: "coordinator",
    title: "Step by step: A club with no director",
    summary: "Spot a club that has no director, and know who can add one.",
    needs: [...COORDINATOR_NEEDS],
    changes: ["Nothing. Only the conference office can add a director."],
    verify: ["You know which club has no director, and that you ask the conference office."],
    next: "Ask the conference office to add a director.",
    destinationIds: ["coordinator-overview"],
    keywords: ["no director", "missing director", "club without a director", "add a director", "conference office", "who's missing what", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${AREA}/overview/page.tsx`, "app/(public)/account/(portal)/area/[organizationId]/page.tsx", "components/coordinator-overview.tsx", "components/coordinator-whos-missing.tsx", "modules/setup-help/coordinator-checklist.ts", ...COORDINATOR_SHELL, "components/club-overview.tsx", "components/coordinator-whos-missing.module.css", "components/role-setup-help.tsx", "components/setup-checklist-panel.tsx", "components/table-card-labels.tsx"],
    steps: [
      { id: "getting-started", text: "On Overview, Getting started says how many clubs have no director.", alt: "The Getting started list on Overview with A director for every club marked." },
      { id: "no-director", text: "In Who's missing what, a club with No director has a red mark.", alt: "The Who's missing what list with the No director mark marked." },
      { id: "ask-office", text: "Its next step says to ask the conference office to add a director. Only they can.", alt: "The Who's missing what list with the next step for a club with no director marked." },
      { id: "club-admins", text: "Choose Open club. Club admins says no director is assigned yet.", alt: "The club's page with the whole Club admins section marked, which says no director is assigned yet." },
    ],
  },
];

/** Every walkthrough, in the order the capture script and the browser check run them. Coordinator walkthroughs are added here. */
export const walkthroughs: readonly WalkthroughDefinition[] = [...directorWalkthroughs, ...coordinatorWalkthroughs];

export function findWalkthrough(id: string): WalkthroughDefinition | undefined {
  return walkthroughs.find((walkthrough) => walkthrough.id === id);
}

/** The portal guide for a walkthrough: `steps` carries the same sentences, so search and the contextual views still work. */
export function walkthroughGuide(definition: WalkthroughDefinition): PortalGuide {
  return {
    id: definition.id,
    title: definition.title,
    summary: definition.summary,
    audience: definition.audience,
    needs: definition.needs,
    changes: definition.changes,
    steps: definition.steps.map((step) => step.text),
    verify: definition.verify,
    next: definition.next,
    destinationIds: definition.destinationIds,
    relatedDocs: [],
    keywords: definition.keywords,
    owner: OWNER,
    lastReviewed: REVIEWED,
    walkthrough: { steps: definition.steps },
  };
}

export const walkthroughGuides: readonly PortalGuide[] = walkthroughs.map(walkthroughGuide);

/**
 * The written guides that have a step-by-step version, by written guide id. Each shows a "See it step by step" link near its
 * Steps. The map keeps the written guides' own entries unchanged.
 */
export const walkthroughsForGuide: Record<string, readonly string[]> = {
  "director-getting-started": ["walkthrough-director-first-sign-in", "walkthrough-director-get-help"],
  "director-two-step-sign-in": ["walkthrough-director-two-step"],
  "director-leaders-and-invites": ["walkthrough-director-leaders"],
  "director-roster-and-forms": ["walkthrough-director-roster", "walkthrough-director-club-forms"],
  "director-register-for-events": ["walkthrough-director-register-event"],
  "director-orders-and-supplies": ["walkthrough-director-orders"],
  "director-monthly-record": ["walkthrough-director-monthly-records"],
  "director-year-end-report": ["walkthrough-director-year-end"],
  "coordinator-getting-started": ["walkthrough-coordinator-sign-in", "walkthrough-coordinator-clubs"],
  "coordinator-find-club": ["walkthrough-coordinator-clubs"],
  "coordinator-follow-records": ["walkthrough-coordinator-records"],
  "coordinator-follow-up-clubs": ["walkthrough-coordinator-follow-up", "walkthrough-coordinator-no-director"],
  "coordinator-points": ["walkthrough-coordinator-points"],
};
