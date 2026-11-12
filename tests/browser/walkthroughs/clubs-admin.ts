import type { WalkthroughActions, WalkthroughContext } from "./types";

/**
 * Browser actions for the Clubs Administrator walkthroughs (#1882). Same rules as `club-director.ts`: each action drives the page
 * to the state its picture shows and returns the control to mark, using roles and the exact on-screen labels. They start as the
 * sample Clubs Administrator (`signed-in-clubs-admin`: a staff user, not a system administrator) in the staff workspace. The
 * sample clubs and the two sample invites come from `help-walkthrough-fixtures.ts`.
 */
const slow = { timeout: 90_000 };
const searchLabel = "Search pages, clubs, events, churches and people";

async function open(ctx: WalkthroughContext, path: string) {
  await ctx.page.goto(`${ctx.baseUrl}${path}`, { waitUntil: "networkidle", ...slow });
}

async function settle(ctx: WalkthroughContext) {
  await ctx.page.waitForLoadState("networkidle", slow);
}

const searchBox = (ctx: WalkthroughContext) => ctx.page.getByRole("combobox", { name: searchLabel }).filter({ visible: true }).first();
const clubResult = (ctx: WalkthroughContext) => ctx.page.getByRole("option", { name: new RegExp(ctx.clubsAdmin.clubName) }).first();
const status = (ctx: WalkthroughContext) => ctx.page.locator('select[name="status"]');
// The club year bar above has its own Show button, so this one is found inside the filter form.
const showButton = (ctx: WalkthroughContext) => ctx.page.locator("form").filter({ has: status(ctx) }).getByRole("button", { name: "Show", exact: true });

/** Picks a Status and applies it. The list is a GET form, so the address changes. */
async function showStatus(ctx: WalkthroughContext, label: string, value: string) {
  await status(ctx).selectOption({ label });
  await showButton(ctx).click();
  await ctx.page.waitForURL(new RegExp(`status=${value}`), slow);
  await settle(ctx);
}

export const clubsAdminWalkthroughActions: Record<string, WalkthroughActions> = {
  "walkthrough-clubs-find-club": {
    start: "signed-in-clubs-admin",
    steps: {
      "type-name": async (ctx) => {
        await open(ctx, "/admin/clubs");
        const box = searchBox(ctx);
        // On a phone the search is a button in the header that opens the box on its own row.
        if (!(await box.isVisible())) {
          await ctx.page.getByRole("button", { name: searchLabel }).filter({ visible: true }).first().click();
          await box.waitFor({ state: "visible", timeout: 15_000 });
        }
        await box.click();
        await box.fill(ctx.clubsAdmin.searchWord);
        await clubResult(ctx).waitFor({ state: "visible", timeout: 30_000 });
        return box;
      },
      "pick-club": async (ctx) => clubResult(ctx),
      "open-club": async (ctx) => {
        await clubResult(ctx).click();
        await ctx.page.waitForURL(/\/admin\/organizations\/[^/]+\/club/, slow);
        await settle(ctx);
        return ctx.page.getByRole("heading", { name: ctx.clubsAdmin.clubName, exact: true }).first();
      },
      "monthly-records": async (ctx) => ctx.page.locator('[data-testid="club-card"]').filter({ hasText: "Monthly Records" }).first(),
    },
  },
  "walkthrough-clubs-leaders": {
    start: "signed-in-clubs-admin",
    steps: {
      "status-choice": async (ctx) => {
        await open(ctx, "/admin/clubs/leaders");
        return status(ctx);
      },
      invited: async (ctx) => {
        await showStatus(ctx, "Invited", "invited");
        return ctx.page.getByRole("listitem").filter({ hasText: "Reese Placeholder" }).first();
      },
      resend: async (ctx) => ctx.page.getByRole("button", { name: /Resend/ }).first(),
      draft: async (ctx) => {
        await showStatus(ctx, "Draft", "draft");
        return ctx.page.getByRole("button", { name: /Send all unsent/ }).first();
      },
    },
  },
};
