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

export const clubDirectorWalkthroughActions: Record<string, WalkthroughActions> = {
  "walkthrough-director-first-sign-in": {
    start: "signed-out",
    steps: {
      "open-sign-in": async (ctx) => {
        await open(ctx, "/account/sign-in");
        return ctx.page.getByLabel("Email address");
      },
      "enter-details": async (ctx) => {
        await fillSignIn(ctx);
        return ctx.page.getByRole("button", { name: "Sign in", exact: true });
      },
      "check-email": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await ctx.page.waitForURL(/\/account\/sign-in\/code/, slow);
        await settle(ctx);
        return codeBox(ctx);
      },
      "enter-code": async (ctx) => {
        await codeBox(ctx).fill(await ctx.readSignInCode());
        return ctx.page.getByRole("button", { name: "Sign in", exact: true });
      },
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
        return ctx.page.getByRole("button", { name: "Enter your code, then set up two-step sign-in" });
      },
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
        await open(ctx, `${ctx.clubPath}/club-info`);
        return ctx.page.getByRole("button", { name: "Add club admin" });
      },
      "fill-invite": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Add club admin" }).click();
        await ctx.page.getByLabel("Their email").fill(ctx.invitee.email);
        return ctx.page.getByLabel("Their email");
      },
      send: async (ctx) => ctx.page.getByRole("dialog").getByRole("button", { name: "Add club admin" }),
      "see-invite": async (ctx) => {
        await ctx.page.getByRole("dialog").getByRole("button", { name: "Add club admin" }).click();
        await ctx.page.getByRole("dialog").waitFor({ state: "hidden", ...slow });
        await ctx.page.getByText(ctx.invitee.email).first().waitFor({ state: "visible", ...slow });
        // Mark the role, so the mark never covers the person's name or email.
        return ctx.page.locator('section[aria-labelledby="club-team-heading"]').getByText("Registrar", { exact: true }).locator("visible=true").first();
      },
    },
  },

  "walkthrough-director-roster": {
    start: "signed-in",
    steps: {
      "open-roster": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/roster`);
        return ctx.page.getByRole("button", { name: "Add to roster" }).first();
      },
      "add-details": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Add to roster" }).first().click();
        const dialog = ctx.page.getByRole("dialog");
        await dialog.getByLabel("First name").first().fill(ctx.rosterPerson.firstName);
        await dialog.getByLabel("Last name").first().fill(ctx.rosterPerson.lastName);
        await dialog.getByLabel("Birth date").first().fill("4/17/2014");
        await dialog.getByLabel("Current class").selectOption({ label: "Friend" });
        await dialog.locator("label", { hasText: /^Gender/ }).locator("select").selectOption({ label: "Female" });
        return dialog.getByLabel("First name").first();
      },
      "add-save": async (ctx) => ctx.page.getByRole("dialog").getByRole("button", { name: "Add to roster" }),
      "edit-open": async (ctx) => {
        await ctx.page.getByRole("dialog").getByRole("button", { name: "Add to roster" }).click();
        await ctx.page.getByRole("dialog").waitFor({ state: "hidden", ...slow });
        await showMembers(ctx);
        const edit = ctx.page.getByRole("button", { name: `Edit ${rosterRowName(ctx)}` });
        await edit.waitFor({ state: "visible", ...slow });
        return edit;
      },
      "edit-fields": async (ctx) => {
        await ctx.page.getByRole("button", { name: `Edit ${rosterRowName(ctx)}` }).click();
        const role = ctx.page.getByRole("dialog").getByLabel("Role (optional)");
        await role.fill(ctx.rosterPerson.editedRole);
        return role;
      },
      "remove-menu": async (ctx) => {
        await ctx.page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
        await ctx.page.getByRole("dialog").waitFor({ state: "hidden", ...slow });
        await showMembers(ctx);
        await ctx.page.locator(`summary[aria-label="Actions for ${rosterRowName(ctx)}"]`).first().click();
        return ctx.page.getByRole("button", { name: `Remove ${rosterRowName(ctx)}` });
      },
      "remove-confirm": async (ctx) => {
        await ctx.page.getByRole("button", { name: `Remove ${rosterRowName(ctx)}` }).click();
        return ctx.page.getByRole("dialog").getByRole("button", { name: /^Remove / });
      },
    },
  },

  "walkthrough-director-club-forms": {
    start: "signed-in",
    steps: {
      "open-forms": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/forms`);
        return ctx.page.getByText("Missing", { exact: true }).first();
      },
      "fill-in": async (ctx) => ctx.page.getByRole("link", { name: "Fill in" }).first(),
      "form-open": async (ctx) => {
        await ctx.page.getByRole("link", { name: "Fill in" }).first().click();
        await ctx.page.waitForURL(/\/forms\/.+\/new/, slow);
        await settle(ctx);
        return ctx.page.locator("main input, main textarea, main select").first();
      },
      "send-link": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/forms`);
        return ctx.page.getByRole("button", { name: /Send link/ }).first();
      },
    },
  },

  "walkthrough-director-register-event": {
    start: "signed-in",
    steps: {
      "open-events": async (ctx) => {
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
        return ctx.page.getByRole("button", { name: "Continue", exact: true });
      },
      review: async (ctx) => {
        await ctx.page.getByRole("button", { name: "Continue", exact: true }).click();
        await ctx.page.getByRole("heading", { name: "Roster", exact: true }).waitFor({ state: "visible", ...slow });
        return ctx.page.getByRole("button", { name: "Continue", exact: true });
      },
    },
  },

  "walkthrough-director-orders": {
    start: "signed-in",
    steps: {
      "open-orders": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/orders`);
        const item = ctx.page.locator("select").filter({ has: ctx.page.locator("option", { hasText: ctx.supplyName }) }).first();
        const value = await item.locator("option", { hasText: ctx.supplyName }).first().getAttribute("value");
        await item.selectOption(value);
        return item;
      },
      "add-item": async (ctx) => ctx.page.getByRole("button", { name: "Add to list", exact: true }),
      "on-list": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Add to list", exact: true }).click();
        const line = ctx.page.getByText(ctx.supplyName).first();
        await line.waitFor({ state: "visible", ...slow });
        return line;
      },
      stock: async (ctx) => {
        // The row for the sample supply under Inventory: its count box.
        const row = ctx.page.locator("li, div", { hasText: ctx.supplyName }).filter({ has: ctx.page.getByRole("spinbutton") }).last();
        return row.getByRole("spinbutton");
      },
    },
  },

  "walkthrough-director-monthly-records": {
    start: "signed-in",
    steps: {
      "open-records": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/records`);
        return ctx.page.getByRole("link", { name: /^Open/ }).first();
      },
      "fill-record": async (ctx) => {
        await ctx.page.getByRole("link", { name: /^Open/ }).first().click();
        await ctx.page.waitForURL(/records\?month=/, slow);
        await settle(ctx);
        await ctx.page.getByRole("link", { name: "Open Monthly Record" }).or(ctx.page.getByRole("button", { name: "Open Monthly Record" })).first().click();
        const attendance = ctx.page.locator("label", { hasText: /^Average attendance/ }).locator("input");
        await attendance.fill("8");
        return attendance;
      },
      "submit-record": async (ctx) => ctx.page.getByRole("button", { name: /Submit report/ }),
    },
  },

  "walkthrough-director-year-end": {
    start: "signed-in",
    steps: {
      "open-report": async (ctx) => {
        await open(ctx, `${ctx.clubPath}/records`);
        return ctx.page.getByRole("link", { name: "Open report" }).first();
      },
      "who-reporting": async (ctx) => {
        await ctx.page.getByRole("link", { name: "Open report" }).first().click();
        await ctx.page.waitForURL(/reports\/year-end\//, slow);
        await settle(ctx);
        await ctx.page.getByLabel("Name", { exact: true }).fill(ctx.director.displayName);
        return ctx.page.getByLabel("Name", { exact: true });
      },
      "check-counts": async (ctx) => ctx.page.getByText("Membership total", { exact: true }),
      "submit-report": async (ctx) => ctx.page.getByRole("button", { name: "Submit report" }),
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
        return ctx.page.getByText("Having form issues?");
      },
      "support-contact": async (ctx) => {
        await ctx.page.getByText("Need more help?").click();
        await ctx.page.getByText("support@imsda.org").waitFor({ state: "visible", ...slow });
        return ctx.page.getByText("Need more help?");
      },
    },
  },
};
