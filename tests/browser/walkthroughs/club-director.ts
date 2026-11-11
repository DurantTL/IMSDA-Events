import type { WalkthroughActions, WalkthroughContext } from "./types";

/**
 * Browser actions for the club director walkthroughs (#1482). Each action drives the page to the state its picture shows
 * (including the tap or typing that leads there from the step before) and returns the control to mark. They use roles and
 * the exact on-screen labels, so a renamed label breaks the walkthrough the way it would break the person following it.
 */
const slow = { timeout: 90_000 };

/** Opens a page and waits until it has stopped loading (the dev server compiles a page on its first visit). */
async function open(ctx: WalkthroughContext, path: string) {
  await ctx.page.goto(`${ctx.baseUrl}${path}`, { waitUntil: "networkidle", ...slow });
}

async function settle(ctx: WalkthroughContext) {
  await ctx.page.waitForLoadState("networkidle", slow);
}

/** Types the sample director's email and password on the sign-in page. */
async function fillSignIn(ctx: WalkthroughContext) {
  await ctx.page.getByLabel("Email address").fill(ctx.director.email);
  await ctx.page.locator('input[name="password"]').fill(ctx.director.password);
}

/** Signs in for real and stops on the page that asks for the emailed code. */
async function signInToCodePage(ctx: WalkthroughContext) {
  await open(ctx, "/account/sign-in");
  await fillSignIn(ctx);
  await ctx.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await ctx.page.waitForURL(/\/account\/sign-in\/code/, slow);
  await settle(ctx);
}

/** A phone shows the club menu as a bar at the bottom; anything wider shows the tabs along the top. */
const isPhone = (ctx: WalkthroughContext) => (ctx.page.viewportSize()?.width ?? 1280) < 768;

/**
 * The club menu link a step opens: the tab on a wide screen, and on a phone the bar's link of that name (the bar names Home,
 * Roster, Events and Records) or More for any other page.
 */
function menuLink(ctx: WalkthroughContext, name: string, phoneName: string = name) {
  return ctx.page.locator("nav").getByRole("link", { name: isPhone(ctx) ? phoneName : name, exact: true }).locator("visible=true").first();
}

const codeBox = (ctx: WalkthroughContext) => ctx.page.getByLabel("Sign-in code");

const rosterRowName = (ctx: WalkthroughContext) => `${ctx.rosterPerson.firstName} ${ctx.rosterPerson.lastName}`;

/** Opens the Members group on the roster, where the sample youth lands. */
async function showMembers(ctx: WalkthroughContext) {
  const members = ctx.page.locator("summary", { hasText: /^\s*Members/ });
  if (await members.count()) {
    const details = ctx.page.locator("details", { has: members });
    if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await members.click();
  }
}

/** The roster row (a card on a phone) of the sample person. */
const rosterRow = (ctx: WalkthroughContext) => ctx.page.locator("tr").filter({ has: ctx.page.locator(`[aria-label="Edit ${rosterRowName(ctx)}"]`) });

const actionsButton = (ctx: WalkthroughContext) => ctx.page.locator(`summary[aria-label="Actions for ${rosterRowName(ctx)}"]`).first();

/** The sample supply's row under Inventory (the last row with its name and a count box). */
const stockRow = (ctx: WalkthroughContext) => ctx.page.locator("li", { hasText: ctx.supplyName }).filter({ has: ctx.page.getByRole("spinbutton") }).last();

const openMonthlyRecord = (ctx: WalkthroughContext) => ctx.page.getByRole("link", { name: "Open Monthly Record" }).or(ctx.page.getByRole("button", { name: "Open Monthly Record" })).first();

export const clubDirectorWalkthroughActions: Record<string, WalkthroughActions> = {
  "walkthrough-director-first-sign-in": {
    start: "signed-out",
    steps: {
      "open-sign-in": async (ctx) => {
        await open(ctx, "/account/sign-in");
        return ctx.page.getByLabel("Email address");
      },
      "type-email": async (ctx) => {
        await ctx.page.getByLabel("Email address").fill(ctx.director.email);
        return ctx.page.getByLabel("Email address");
      },
      "type-password": async (ctx) => {
        await ctx.page.locator('input[name="password"]').fill(ctx.director.password);
        return ctx.page.locator('input[name="password"]');
      },
      "sign-in": async (ctx) => ctx.page.getByRole("button", { name: "Sign in", exact: true }),
      "check-email": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await ctx.page.waitForURL(/\/account\/sign-in\/code/, slow);
        await settle(ctx);
        return codeBox(ctx);
      },
      "enter-code": async (ctx) => {
        await codeBox(ctx).fill(await ctx.readSignInCode());
        return codeBox(ctx);
      },
      "confirm-code": async (ctx) => ctx.page.getByRole("button", { name: "Sign in", exact: true }),
      "signed-in": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await ctx.page.waitForURL((url: URL) => url.pathname === "/account", slow);
        await settle(ctx);
        return ctx.page.getByRole("heading", { level: 1 });
      },
    },
  },

  "walkthrough-director-two-step": {
    start: "signed-out",
    steps: {
      "code-page": async (ctx) => {
        await signInToCodePage(ctx);
        await codeBox(ctx).fill(await ctx.readSignInCode());
        return codeBox(ctx);
      },
      "code-link": async (ctx) => ctx.page.getByRole("button", { name: "Enter your code, then set up two-step sign-in" }),
      start: async (ctx) => {
        await ctx.page.getByRole("button", { name: "Enter your code, then set up two-step sign-in" }).click();
        await ctx.page.waitForURL(/\/account\/two-step/, slow);
        await settle(ctx);
        return ctx.page.getByRole("button", { name: "Set up two-step sign-in" });
      },
      "choose-passkey": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Set up two-step sign-in" }).click();
        return ctx.page.locator("label", { hasText: "This phone or computer" });
      },
      continue: async (ctx) => ctx.page.getByRole("button", { name: "Continue" }),
      "add-passkey": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Continue" }).click();
        return ctx.page.getByRole("button", { name: "Add a passkey" });
      },
      done: async (ctx) => {
        // A software passkey stands in for the person's fingerprint, face or PIN.
        const session = await ctx.page.context().newCDPSession(ctx.page);
        await session.send("WebAuthn.enable");
        await session.send("WebAuthn.addVirtualAuthenticator", {
          options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
        });
        await ctx.page.getByRole("button", { name: "Add a passkey" }).click();
        await ctx.page.getByRole("heading", { name: /Two-step sign-in is on/ }).waitFor({ state: "visible", ...slow });
        return ctx.page.getByRole("heading", { name: /Two-step sign-in is on/ });
      },
    },
  },

  "walkthrough-director-leaders": {
    start: "signed-in",
    steps: {
      "open-settings": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Club settings", "More");
      },
      "open-dialog": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/club-info`);
        return ctx.page.getByRole("button", { name: "Add club admin" });
      },
      "fill-invite": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Add club admin" }).click();
        await ctx.page.getByLabel("Their email").fill(ctx.invitee.email);
        return { target: ctx.page.getByLabel("Their email"), area: ctx.page.getByRole("dialog") };
      },
      "pick-role": async (ctx) => {
        await ctx.page.getByRole("dialog").locator('select[name="role"]').selectOption({ label: "Registrar" });
        return { target: ctx.page.getByRole("dialog").locator("label", { hasText: /^Role/ }), area: ctx.page.getByRole("dialog") };
      },
      send: async (ctx) => ({ target: ctx.page.getByRole("dialog").getByRole("button", { name: "Add club admin" }), area: ctx.page.getByRole("dialog") }),
      "see-invite": async (ctx) => {
        await ctx.page.getByRole("dialog").getByRole("button", { name: "Add club admin" }).click();
        await ctx.page.getByRole("dialog").waitFor({ state: "hidden", ...slow });
        await ctx.page.getByText(ctx.invitee.email).first().waitFor({ state: "visible", ...slow });
        // Mark the role, so the mark never covers the person's name or email.
        const team = ctx.page.locator('section[aria-labelledby="club-team-heading"]');
        return { target: team.getByText("Registrar", { exact: true }).locator("visible=true").first(), area: team };
      },
    },
  },

  "walkthrough-director-roster": {
    start: "signed-in",
    steps: {
      "open-roster": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Roster");
      },
      "add-open": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/roster`);
        return { target: ctx.page.getByRole("button", { name: "Add to roster" }).first(), area: ctx.page.locator("#club-roster-heading") };
      },
      "add-name": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Add to roster" }).first().click();
        const dialog = ctx.page.getByRole("dialog");
        await dialog.getByLabel("First name").first().fill(ctx.rosterPerson.firstName);
        await dialog.getByLabel("Last name").first().fill(ctx.rosterPerson.lastName);
        return { target: dialog.locator("label", { hasText: /^First name/ }), alsoMark: dialog.locator("label", { hasText: /^Last name/ }), area: dialog };
      },
      "add-birth": async (ctx) => {
        const dialog = ctx.page.getByRole("dialog");
        await dialog.getByLabel("Birth date").first().fill("4/17/2014");
        return { target: dialog.locator("label.birth-date-field"), area: dialog };
      },
      "add-gender": async (ctx) => {
        const dialog = ctx.page.getByRole("dialog");
        await dialog.getByLabel("Current class").selectOption({ label: "Friend" });
        await dialog.locator("label", { hasText: /^Gender/ }).locator("select").selectOption({ label: "Female" });
        return { target: dialog.locator("label", { hasText: /^Gender/ }), area: dialog };
      },
      "add-save": async (ctx) => ({ target: ctx.page.getByRole("dialog").getByRole("button", { name: "Add to roster" }), area: ctx.page.getByRole("dialog") }),
      "edit-open": async (ctx) => {
        await ctx.page.getByRole("dialog").getByRole("button", { name: "Add to roster" }).click();
        await ctx.page.getByRole("dialog").waitFor({ state: "hidden", ...slow });
        await showMembers(ctx);
        const edit = ctx.page.getByRole("button", { name: `Edit ${rosterRowName(ctx)}` });
        await edit.waitFor({ state: "visible", ...slow });
        return { target: edit, area: rosterRow(ctx) };
      },
      "edit-fields": async (ctx) => {
        await ctx.page.getByRole("button", { name: `Edit ${rosterRowName(ctx)}` }).click();
        // The Edit window loads the person's emergency contacts after it opens, and Save refuses while they load (the
        // window then stays open). Wait for the roster's loaded state: the contact boxes stop being read-only (#1507).
        await ctx.page.getByRole("dialog").locator('input[name="g1Name"][readonly]').waitFor({ state: "detached", ...slow });
        const role = ctx.page.getByRole("dialog").getByLabel("Role (optional)");
        await role.fill(ctx.rosterPerson.editedRole);
        return { target: ctx.page.getByRole("dialog").locator("label", { hasText: /^Role \(optional\)/ }), area: ctx.page.getByRole("dialog") };
      },
      "edit-save": async (ctx) => ({ target: ctx.page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }), area: ctx.page.getByRole("dialog") }),
      "remove-actions": async (ctx) => {
        await ctx.page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
        await ctx.page.getByRole("dialog").waitFor({ state: "hidden", ...slow });
        await showMembers(ctx);
        return { target: actionsButton(ctx), area: rosterRow(ctx) };
      },
      "remove-menu": async (ctx) => {
        await actionsButton(ctx).click();
        return { target: ctx.page.getByRole("button", { name: `Remove ${rosterRowName(ctx)}` }), area: rosterRow(ctx) };
      },
      "remove-confirm": async (ctx) => {
        await ctx.page.getByRole("button", { name: `Remove ${rosterRowName(ctx)}` }).click();
        return { target: ctx.page.getByRole("dialog").getByRole("button", { name: /^Remove / }), area: ctx.page.getByRole("dialog") };
      },
    },
  },

  "walkthrough-director-club-forms": {
    start: "signed-in",
    steps: {
      "open-forms": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Forms", "More");
      },
      required: async (ctx) => {
        await open(ctx, `${ctx.clubPath}/forms`);
        return { target: ctx.page.getByText("Missing", { exact: true }).first(), area: ctx.page.locator("li[data-required-form]").first() };
      },
      "fill-in": async (ctx) => ({ target: ctx.page.getByRole("link", { name: "Fill in" }).first(), area: ctx.page.locator("li[data-required-form]").first() }),
      "form-who": async (ctx) => {
        await ctx.page.getByRole("link", { name: "Fill in" }).first().click();
        await ctx.page.waitForURL(/\/forms\/.+\/new/, slow);
        await settle(ctx);
        return ctx.page.locator("label", { hasText: /^Roster member/ });
      },
      "form-answer": async (ctx) => {
        const answer = ctx.page.locator("label", { hasText: /^Director/ }).first();
        await answer.locator("input").fill(ctx.director.displayName);
        return answer;
      },
      "form-submit": async (ctx) => ({ target: ctx.page.getByRole("button", { name: "Submit form" }), alsoMark: ctx.page.getByRole("button", { name: "Save draft" }) }),
      "send-link": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/forms`);
        return { target: ctx.page.getByRole("button", { name: "Send a private link" }).first(), area: ctx.page.locator("li[data-required-form]").first() };
      },
      "link-email": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Send a private link" }).first().click();
        const email = ctx.page.getByLabel("Email address to send it to");
        await email.fill("parent.sample@example.test");
        return { target: email, area: ctx.page.locator("form.club-form-send") };
      },
      "link-send": async (ctx) => ({ target: ctx.page.locator("form.club-form-send").getByRole("button", { name: "Send link" }), area: ctx.page.locator("form.club-form-send") }),
    },
  },

  "walkthrough-director-register-event": {
    start: "signed-in",
    steps: {
      "open-events": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Club events", "Events");
      },
      register: async (ctx) => {
        await open(ctx, `${ctx.clubPath}/events`);
        return ctx.page.getByRole("link", { name: /Register/ }).first();
      },
      "whos-going": async (ctx) => {
        await ctx.page.getByRole("link", { name: /Register/ }).first().click();
        await ctx.page.waitForURL(/\/events\/.+/, slow);
        await settle(ctx);
        return ctx.page.getByRole("button", { name: "Select everyone" });
      },
      continue: async (ctx) => {
        await ctx.page.getByRole("button", { name: "Select everyone" }).click();
        return ctx.page.getByRole("button", { name: /Continue with \d+ people/ });
      },
      contact: async (ctx) => {
        await ctx.page.getByRole("button", { name: /Continue with \d+ people/ }).click();
        await ctx.page.getByRole("heading", { name: "Contact", exact: true }).waitFor({ state: "visible", ...slow });
        return { target: ctx.page.locator("label", { hasText: /^First name/ }).first(), alsoMark: ctx.page.locator("label", { hasText: /^Email/ }).first() };
      },
      "contact-continue": async (ctx) => ctx.page.getByRole("button", { name: "Continue", exact: true }),
      review: async (ctx) => {
        await ctx.page.getByRole("button", { name: "Continue", exact: true }).click();
        await ctx.page.getByRole("heading", { name: "Roster", exact: true }).waitFor({ state: "visible", ...slow });
        return ctx.page.getByRole("button", { name: /^Edit/ }).first();
      },
      "review-continue": async (ctx) => ctx.page.getByRole("button", { name: "Continue", exact: true }),
      "check-answers": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Continue", exact: true }).click();
        await ctx.page.getByText("Registration details", { exact: true }).waitFor({ state: "visible", ...slow });
        return ctx.page.getByText("Registration details", { exact: true });
      },
      // The picture stops here: the walkthrough never submits a registration.
      submit: async (ctx) => ctx.page.getByRole("button", { name: "Submit registration" }),
    },
  },

  "walkthrough-director-orders": {
    start: "signed-in",
    steps: {
      "open-orders": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Orders", "More");
      },
      "find-item": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/orders`);
        // The shared item search box (#1553): type the name, then pick it from the list.
        const box = ctx.page.getByRole("combobox", { name: "Search honors and items" });
        await box.click();
        await box.fill(ctx.supplyName);
        const option = ctx.page.locator('[role="listbox"] [role="option"]', { hasText: ctx.supplyName }).first();
        await option.waitFor({ state: "visible", ...slow });
        return { target: option, area: box };
      },
      "add-item": async (ctx) => {
        await ctx.page.locator('[role="listbox"] [role="option"]', { hasText: ctx.supplyName }).first().click();
        return ctx.page.getByRole("button", { name: "Add to list", exact: true });
      },
      "on-list": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Add to list", exact: true }).click();
        const line = ctx.page.locator("li", { has: ctx.page.getByRole("spinbutton", { name: new RegExp(`^Quantity: ${ctx.supplyName}`) }) }).first();
        await line.waitFor({ state: "visible", ...slow });
        return line;
      },
      "stock-count": async (ctx) => {
        // The row for the sample supply under Inventory: its count box.
        const count = stockRow(ctx).getByRole("spinbutton");
        await count.fill("12");
        return { target: count, area: stockRow(ctx) };
      },
      "stock-save": async (ctx) => ({ target: stockRow(ctx).getByRole("button", { name: /Save/ }), area: stockRow(ctx) }),
    },
  },

  "walkthrough-director-monthly-records": {
    start: "signed-in",
    steps: {
      "open-records": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Monthly Records", "Records");
      },
      "open-month": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/records`);
        return ctx.page.getByRole("link", { name: /^Open/ }).first();
      },
      "open-form": async (ctx) => {
        await ctx.page.getByRole("link", { name: /^Open/ }).first().click();
        await ctx.page.waitForURL(/records\?month=/, slow);
        await settle(ctx);
        return openMonthlyRecord(ctx);
      },
      "fill-record": async (ctx) => {
        await openMonthlyRecord(ctx).click();
        const attendance = ctx.page.locator("label", { hasText: /^Average attendance/ }).locator("input");
        await attendance.fill("8");
        return attendance;
      },
      "submit-record": async (ctx) => ({ target: ctx.page.getByRole("button", { name: /Submit report/ }), alsoMark: ctx.page.getByRole("button", { name: "Save draft" }) }),
    },
  },

  "walkthrough-director-year-end": {
    start: "signed-in",
    steps: {
      "open-records": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return menuLink(ctx, "Monthly Records", "Records");
      },
      "open-report": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/records`);
        return ctx.page.getByRole("link", { name: "Open report" }).first();
      },
      "who-reporting": async (ctx) => {
        await ctx.page.getByRole("link", { name: "Open report" }).first().click();
        await ctx.page.waitForURL(/reports\/year-end\//, slow);
        await settle(ctx);
        await ctx.page.getByLabel("Name", { exact: true }).fill(ctx.director.displayName);
        await ctx.page.getByLabel("Email", { exact: true }).fill(ctx.director.email);
        return { target: ctx.page.locator("label", { hasText: /^Name/ }).first(), alsoMark: ctx.page.locator("label", { hasText: /^Email/ }).first() };
      },
      "check-counts": async (ctx) => ctx.page.getByText("Membership total", { exact: true }),
      "submit-report": async (ctx) => ({ target: ctx.page.getByRole("button", { name: "Submit report" }), alsoMark: ctx.page.getByRole("button", { name: "Save draft" }) }),
    },
  },

  "walkthrough-director-get-help": {
    start: "signed-in",
    steps: {
      "open-help": async (ctx) => {
        await open(ctx, ctx.clubPath);
        return ctx.page.getByRole("button", { name: "Forms help" });
      },
      "help-choices": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Forms help" }).click();
        return { target: ctx.page.getByText("Having form issues?"), alsoMark: ctx.page.getByText("Need more help?") };
      },
      "support-contact": async (ctx) => {
        await ctx.page.getByText("Need more help?").click();
        await ctx.page.getByText("support@imsda.org").waitFor({ state: "visible", ...slow });
        return { target: ctx.page.getByText("Need more help?"), area: ctx.page.getByText("support@imsda.org") };
      },
    },
  },
};
