import type { WalkthroughActions, WalkthroughContext } from "./types";

/**
 * Browser actions for the family walkthroughs (#1883): pay a balance, change a registration, cancel a registration. Same
 * rules as `club-director.ts`: each action drives the page to the state its picture shows and returns the control to mark,
 * using roles and the exact on-screen labels. The sample family (one registration, part paid, with a cancellation policy) comes
 * from `help-walkthrough-fixtures.ts`. Square is not set up where the pictures are taken, so the pay walkthrough marks only what
 * My registrations shows then.
 */
const slow = { timeout: 90_000 };

async function open(ctx: WalkthroughContext, path: string) {
  await ctx.page.goto(`${ctx.baseUrl}${path}`, { waitUntil: "networkidle", ...slow });
}

async function settle(ctx: WalkthroughContext) {
  await ctx.page.waitForLoadState("networkidle", slow);
}

/**
 * A tab of the account menu. On a phone the tabs fold into an "Account menu" button when they don't fit (#1641), so that menu
 * is opened first and the link inside it is the one to mark.
 */
async function tab(ctx: WalkthroughContext, name: string) {
  const link = ctx.page.getByRole("link", { name, exact: true }).filter({ visible: true }).first();
  const menu = ctx.page.getByRole("button", { name: /^Account menu/ }).first();
  await link.or(menu).first().waitFor({ timeout: 15_000 });
  if (await link.count()) return link;
  await menu.click();
  return link;
}

/** The sample registration's card on My registrations. */
const card = (ctx: WalkthroughContext) => ctx.page.getByRole("article").filter({ hasText: "Sample Family Retreat" });

async function openRegistrations(ctx: WalkthroughContext) {
  await open(ctx, "/account/registrations");
  await card(ctx).first().waitFor({ state: "visible", ...slow });
}

/** The card's action row summary of that name ("Request cancellation for Sample Family Retreat" has a hidden suffix). */
const action = (ctx: WalkthroughContext, label: string) => card(ctx).locator("summary").filter({ hasText: label }).first();

const registrationsTab = async (ctx: WalkthroughContext) => {
  await open(ctx, "/account");
  return tab(ctx, "My registrations");
};

export const familyWalkthroughActions: Record<string, WalkthroughActions> = {
  "walkthrough-family-pay": {
    start: "signed-in-family",
    steps: {
      "open-registrations": registrationsTab,
      "find-card": async (ctx) => {
        await openRegistrations(ctx);
        return { target: card(ctx).getByRole("heading", { name: "Sample Family Retreat" }), area: card(ctx).locator(".attendee-ov-card-top") };
      },
      "read-balance": async (ctx) => ({ target: card(ctx).locator(".attendee-ov-money-headline"), area: card(ctx).locator(".attendee-ov-money") }),
      "read-next": async (ctx) => ({ target: card(ctx).locator(".attendee-ov-money-detail"), area: card(ctx).locator(".attendee-ov-money") }),
    },
  },

  "walkthrough-family-change": {
    start: "signed-in-family",
    steps: {
      "open-registrations": registrationsTab,
      "open-contact": async (ctx) => {
        await openRegistrations(ctx);
        return { target: action(ctx, "Update contact details"), area: card(ctx).locator(".attendee-reg-actions") };
      },
      "open-form": async (ctx) => {
        await action(ctx, "Update contact details").click();
        const summary = card(ctx).locator("summary").filter({ hasText: "Update registration contact" });
        await summary.waitFor({ state: "visible", ...slow });
        return summary;
      },
      "edit-phone": async (ctx) => {
        await card(ctx).locator("summary").filter({ hasText: "Update registration contact" }).click();
        const phone = card(ctx).getByLabel("Phone");
        await phone.fill(ctx.family.newPhone);
        return { target: phone, area: card(ctx).locator("form") };
      },
      "email-code": async (ctx) => ({ target: card(ctx).getByRole("button", { name: "Email a code" }), area: card(ctx).locator("form") }),
      "enter-code": async (ctx) => {
        await card(ctx).getByRole("button", { name: "Email a code" }).click();
        // Locally the app returns the code instead of emailing it, and the box fills in.
        const code = card(ctx).getByLabel("Six-digit edit code");
        await ctx.page.waitForFunction((el: HTMLInputElement | null) => Boolean(el && el.value.replace(/\s+/g, "").length === 6), await code.elementHandle(), slow);
        return { target: code, area: card(ctx).locator("form") };
      },
      save: async (ctx) => ({ target: card(ctx).getByRole("button", { name: "Save with code" }), area: card(ctx).locator("form") }),
      saved: async (ctx) => {
        await card(ctx).getByRole("button", { name: "Save with code" }).click();
        const saved = card(ctx).getByText(/^Saved\./);
        await saved.waitFor({ state: "visible", ...slow });
        return { target: saved, area: card(ctx).locator("form") };
      },
    },
  },

  "walkthrough-family-cancel": {
    start: "signed-in-family",
    steps: {
      "open-registrations": registrationsTab,
      "open-cancel": async (ctx) => {
        await openRegistrations(ctx);
        return { target: action(ctx, "Request cancellation"), area: card(ctx).locator(".attendee-reg-actions") };
      },
      "show-outcome": async (ctx) => {
        await action(ctx, "Request cancellation").click();
        const button = card(ctx).getByRole("button", { name: "Show the proposed outcome" });
        await button.waitFor({ state: "visible", ...slow });
        return { target: button, area: card(ctx).locator(".cancel-request-panel") };
      },
      "read-outcome": async (ctx) => {
        await card(ctx).getByRole("button", { name: "Show the proposed outcome" }).click();
        const outcome = card(ctx).locator(".cancel-request-outcome");
        await outcome.waitFor({ state: "visible", ...slow });
        // The first line is the policy period and its terms; the eyebrow above it stays in view.
        return { target: outcome.locator("p").nth(1), area: outcome.locator("p").first() };
      },
      "read-money": async (ctx) => ({ target: card(ctx).locator(".cancel-request-money"), area: card(ctx).locator(".cancel-request-outcome > p").nth(1) }),
      reason: async (ctx) => {
        const reason = card(ctx).getByLabel(/^Why are you asking\?/);
        await reason.fill("Our plans changed and we cannot come.");
        return { target: reason, area: card(ctx).locator(".cancel-request-outcome") };
      },
      send: async (ctx) => ({ target: card(ctx).getByRole("button", { name: "Send request for review" }), area: card(ctx).locator(".cancel-request-outcome") }),
      sent: async (ctx) => {
        await card(ctx).getByRole("button", { name: "Send request for review" }).click();
        const message = card(ctx).locator(".cancel-request-message.is-ok");
        await message.waitFor({ state: "visible", ...slow });
        await settle(ctx);
        return { target: message, area: card(ctx).locator(".cancel-request-panel") };
      },
    },
  },
};
