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

const REVIEWED = "2026-11-01";
const OWNER = "Communication office";
const CLUB = "app/(public)/account/(portal)/clubs/[organizationId]";
const SHELL = ["components/club-portal-masthead-view.tsx", "components/club-portal-nav.tsx"] as const;

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
    ],
    steps: [
      { id: "open-sign-in", text: "Open the account sign-in page.", alt: "The Account sign in page with an Email address box and a Password box." },
      { id: "enter-details", text: "Type your email address and your password. Then choose Sign in.", alt: "The sign-in form filled in, with the Sign in button marked." },
      { id: "check-email", text: "We email you a six-digit code. Open that email and find the code.", alt: "The Check your email page, saying a six-digit code was sent, with the Sign-in code box marked." },
      { id: "enter-code", text: "Type the code. Then choose Sign in.", alt: "The Check your email page with the six digits typed in and the Sign in button marked." },
      { id: "signed-in", text: "You are signed in. Your account Overview opens.", alt: "The account Overview page, which opens after the code is accepted." },
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
    ],
    steps: [
      { id: "code-page", text: "Sign in and type your emailed code. Then choose Enter your code, then set up two-step sign-in.", alt: "The Check your email page with the code typed in and the link Enter your code, then set up two-step sign-in marked." },
      { id: "start", text: "Choose Set up two-step sign-in.", alt: "The Turn on two-step sign-in page with the Set up two-step sign-in button marked." },
      { id: "choose-passkey", text: "Pick This phone or computer, the one marked Easiest. Then choose Continue.", alt: "The choice of how to confirm it is you, with This phone or computer marked Easiest." },
      { id: "add-passkey", text: "Choose the button to add your passkey. Then use your fingerprint, face or PIN when your device asks.", alt: "The passkey page with the button that adds a passkey marked." },
      { id: "done", text: "The page says Two-step sign-in is on. Club pages now open.", alt: "The page that says Two-step sign-in is on." },
    ],
  },
  {
    id: "walkthrough-director-leaders",
    audience: "director",
    title: "Step by step: Add a leader and send an invite",
    summary: "Give a registrar or reporter a role in your club. They get an invite by email if they have no account yet.",
    needs: ["A club role of Director or Deputy.", "The email address of the person to add."],
    changes: ["The person gets the role you pick, right away or when they accept the invite."],
    verify: ["Club admins lists the person, or shows an invite waiting."],
    next: "Add the people in your club to the roster.",
    destinationIds: ["club-settings"],
    keywords: ["leader", "leaders", "invite", "send an invite", "registrar", "reporter", "club admin", "club admins", "add someone", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/club-info/page.tsx`, "components/club-team-workspace.tsx", ...SHELL],
    steps: [
      { id: "open-settings", text: "Open Club settings. Under Club admins, choose Add club admin.", alt: "The Club settings page, with the Add club admin button under Club admins marked." },
      { id: "fill-invite", text: "Type their email. Pick Registrar or Reporter.", alt: "The Give a role window with the Their email box marked." },
      { id: "send", text: "Choose Add club admin. Someone with an account gets the role right away; anyone else gets an email invite.", alt: "The Give a role window filled in, with the Add club admin button marked." },
      { id: "see-invite", text: "The person now shows under Club admins with their role. An invite shows here until they accept it.", alt: "The Club admins list showing the new person and their role." },
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
    sourceFiles: [`${CLUB}/roster/page.tsx`, "components/club-roster-workspace.tsx", "components/club-roster-sections.module.css", ...SHELL],
    steps: [
      { id: "open-roster", text: "Open Roster. Choose Add to roster.", alt: "The Roster page, with the Add to roster button marked." },
      { id: "add-details", text: "Type the first name, last name and birth date. Pick the type, the current class and the gender.", alt: "The Add to the roster window with the name, birth date, class and gender filled in, with the first name box marked." },
      { id: "add-save", text: "Choose Add to roster.", alt: "The Add to the roster window filled in, with its Add to roster button marked." },
      { id: "edit-open", text: "The person is on your roster. To change them, choose Edit beside their name.", alt: "The roster list with the Edit button beside the new person marked." },
      { id: "edit-fields", text: "Change what you need, such as the Role. Then choose Save.", alt: "The Edit window with the Role box marked." },
      { id: "remove-menu", text: "To take someone off, open Actions beside their name. Then choose Remove.", alt: "The Actions menu beside a person, with Remove marked." },
      { id: "remove-confirm", text: "Check the name. Then confirm the removal.", alt: "The window that asks you to confirm removing the person, with the confirm button marked." },
    ],
  },
  {
    id: "walkthrough-director-club-forms",
    audience: "director",
    title: "Step by step: Yearly club forms",
    summary: "Fill in the forms the conference asks for each year, or send a private link so a parent can fill one in.",
    needs: ["A club role of Director or Deputy."],
    changes: ["A form you fill in is saved as a draft until you submit it."],
    verify: ["Required forms no longer show Missing.", "Filled forms lists what you submitted."],
    next: "Register your club for an event.",
    destinationIds: ["club-forms"],
    keywords: ["forms", "club forms", "yearly forms", "required forms", "fill in", "send link", "private link", "missing", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/forms/page.tsx`, `${CLUB}/forms/[templateKey]/new/page.tsx`, "components/club-forms-lists.tsx", "components/club-form-fill-in.tsx", ...SHELL],
    steps: [
      { id: "open-forms", text: "Open Forms. Required forms are at the top, and Missing means not filled in yet.", alt: "The Forms page, with the Required forms list and a Missing label marked." },
      { id: "fill-in", text: "Choose Fill in beside a required form.", alt: "The Forms page with the Fill in button beside a required form marked." },
      { id: "form-open", text: "Pick who the form is for, then answer the questions. Save a draft, or submit when it is done.", alt: "A club form open for filling in, with the Roster member choice marked." },
      { id: "send-link", text: "For a form a parent fills in, choose Send link beside it.", alt: "The Forms page with the Send link button beside a family form marked." },
    ],
  },
  {
    id: "walkthrough-director-register-event",
    audience: "director",
    title: "Step by step: Register your club for an event",
    summary: "Find an open club event, choose who is going, and register your club.",
    needs: ["A club role of Director, Deputy or Registrar.", "People on your roster."],
    changes: ["Registering holds a place for the people you choose. Payment follows the event's billing."],
    verify: ["Club events shows the event with its registration status."],
    next: "Build your order list.",
    destinationIds: ["club-events"],
    keywords: ["event", "events", "register", "registration", "club event", "who's going", "roster", "step by step", "walkthrough", "screenshots"],
    sourceFiles: [`${CLUB}/events/page.tsx`, `${CLUB}/events/[eventId]/page.tsx`, "components/club-event-list.tsx", "components/club-registration-workspace.tsx", ...SHELL],
    steps: [
      { id: "open-events", text: "Open Club events. Choose Register beside an open event.", alt: "The Club events page, with the Register button beside an open event marked." },
      { id: "whos-going", text: "Tap each person who is going, or choose Select everyone.", alt: "The Who's going page with the Select everyone button marked." },
      { id: "continue", text: "Choose Continue with your people.", alt: "The Who's going page with everyone picked and the Continue button marked." },
      { id: "contact", text: "Check the contact details. Then choose Continue.", alt: "The Contact step of the registration form, with the Continue button marked." },
      { id: "review", text: "Look over each person, and choose Edit to fix anyone. When it is right, choose Continue.", alt: "The Roster step of the registration form listing each person with an Edit button, and the Continue button marked." },
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
    sourceFiles: [`${CLUB}/orders/page.tsx`, "components/club-order-workspace.tsx", "components/club-orders.module.css", ...SHELL],
    steps: [
      { id: "open-orders", text: "Open Orders. Under Add an item, pick an item.", alt: "The Orders page with the Item choice under Add an item marked." },
      { id: "add-item", text: "Choose Add to list.", alt: "The Add an item form with an item picked and the Add to list button marked." },
      { id: "on-list", text: "The item is now on Your order list. You can change its quantity there.", alt: "Your order list showing the item that was added." },
      { id: "stock", text: "Under Inventory, type how many you have on hand. Then choose Save.", alt: "The Inventory list with a count box and Save button marked." },
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
    sourceFiles: [`${CLUB}/records/page.tsx`, "components/club-report-form.tsx", ...SHELL],
    steps: [
      { id: "open-records", text: "Open Monthly Records. Choose Open beside the month that has no record.", alt: "The Monthly Records page, with the Open button beside a month marked." },
      { id: "fill-record", text: "Choose Open Monthly Record. Then fill in the meeting details and head counts.", alt: "A Monthly Record open for filling in, with the attendance box marked." },
      { id: "submit-record", text: "Choose Save draft to keep it for later, or Submit report when it is done.", alt: "The bottom of the Monthly Record with the Submit report button marked." },
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
    sourceFiles: [`${CLUB}/records/page.tsx`, `${CLUB}/reports/year-end/[year]/page.tsx`, "components/club-year-end-report-form.tsx", ...SHELL],
    steps: [
      { id: "open-report", text: "Open Monthly Records. Under Year-End Report, choose Open report.", alt: "The Year-End Report list on Monthly Records, with an Open report button marked." },
      { id: "who-reporting", text: "Type your name and contact details under Who is reporting.", alt: "The Year-End Report with the Who is reporting boxes marked." },
      { id: "check-counts", text: "Check the counts that came from your roster. Change any that are wrong.", alt: "The Membership section of the Year-End Report, with the Membership total marked." },
      { id: "submit-report", text: "Choose Save draft to keep it for later, or Submit report when it is done.", alt: "The bottom of the Year-End Report with the Submit report button marked." },
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
    sourceFiles: ["components/forms-help.tsx", "components/forms-help.module.css", ...SHELL],
    steps: [
      { id: "open-help", text: "On any club page, choose Forms help at the top.", alt: "A club page with the Forms help button at the top marked." },
      { id: "help-choices", text: "Pick the choice that fits, such as Having form issues? or Need translation?.", alt: "The Forms help window listing Having form issues, Need translation and Need more help, with the first marked." },
      { id: "support-contact", text: "Choose Need more help? to see the support email and phone number.", alt: "The Forms help window showing the support email and phone number, with Need more help marked." },
    ],
  },
];

/** Every walkthrough, in the order the capture script and the browser check run them. Coordinator walkthroughs are added here. */
export const walkthroughs: readonly WalkthroughDefinition[] = [...directorWalkthroughs];

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
};
