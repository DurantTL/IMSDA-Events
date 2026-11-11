import type { WalkthroughActions, WalkthroughContext } from "./types";

/**
 * Browser actions for the area coordinator walkthroughs (#1482). Same rules as `club-director.ts`: each action drives the
 * page to the state its picture shows and returns the control to mark, using roles and the exact on-screen labels.
 * The sample area (a club up to date, one behind, one with no director) comes from `help-walkthrough-fixtures.ts`.
 */
const slow = { timeout: 90_000 };
const behindClub = "Sample Ridge Explorers";
const noDirectorClub = "Sample Creek Trailblazers";
const filedClub = "Sample Harbor Adventurers";

async function open(ctx: WalkthroughContext, path: string) {
  await ctx.page.goto(`${ctx.baseUrl}${path}`, { waitUntil: "networkidle", ...slow });
}

async function settle(ctx: WalkthroughContext) {
  await ctx.page.waitForLoadState("networkidle", slow);
}

const overview = (ctx: WalkthroughContext) => open(ctx, "/account/area-clubs/overview");

/** The club's row in Who's missing what (the first table on Overview that names the club). */
const missingRow = (ctx: WalkthroughContext, club: string) => ctx.page.getByRole("row", { name: new RegExp(club) }).first();

/**
 * A tab of the account or Club coordination menu. On a phone the tabs fold into an "Account menu" or "Coordinator menu"
 * button when they don't fit (#1641), so that menu is opened first and the link inside it is the one to mark or choose.
 */
async function tab(ctx: WalkthroughContext, name: string) {
  const link = ctx.page.getByRole("link", { name, exact: true }).filter({ visible: true }).first();
  const menu = ctx.page.getByRole("button", { name: /^(Account|Coordinator) menu/ }).first();
  // Wait until the tab row has settled into either the visible tab or the menu it folded into.
  await link.or(menu).first().waitFor({ timeout: 15_000 });
  if (await link.count()) return link;
  // A menu left open by the previous step already shows the link, so it is opened only when needed.
  await menu.click();
  return link;
}

export const coordinatorWalkthroughActions: Record<string, WalkthroughActions> = {
  "walkthrough-coordinator-sign-in": {
    start: "signed-out",
    steps: {
      "open-sign-in": async (ctx) => {
        await open(ctx, "/account/sign-in");
        return ctx.page.getByLabel("Email address");
      },
      "type-email": async (ctx) => {
        await ctx.page.getByLabel("Email address").fill(ctx.coordinator.email);
        return ctx.page.getByLabel("Email address");
      },
      "type-password": async (ctx) => {
        const password = ctx.page.locator('input[name="password"]');
        await password.fill(ctx.coordinator.password);
        return password;
      },
      "sign-in": async (ctx) => ctx.page.getByRole("button", { name: "Sign in", exact: true }),
      confirm: async (ctx) => {
        await ctx.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await ctx.page.waitForURL(/\/account\/two-step/, slow);
        await settle(ctx);
        return ctx.page.getByLabel("Authenticator code");
      },
      "enter-code": async (ctx) => {
        await ctx.page.getByLabel("Authenticator code").fill(ctx.authenticatorCode());
        return ctx.page.getByLabel("Authenticator code");
      },
      continue: async (ctx) => ctx.page.getByRole("button", { name: "Continue", exact: true }),
      "signed-in": async (ctx) => {
        await ctx.page.getByRole("button", { name: "Continue", exact: true }).click();
        await ctx.page.waitForURL((url: URL) => !url.pathname.startsWith("/account/two-step"), slow);
        await settle(ctx);
        return tab(ctx, "Club coordination");
      },
    },
  },

  "walkthrough-coordinator-clubs": {
    start: "signed-in-coordinator",
    steps: {
      "find-club": async (ctx) => {
        await overview(ctx);
        return ctx.page.getByRole("link", { name: "Find a club" });
      },
      search: async (ctx) => {
        await ctx.page.getByRole("link", { name: "Find a club" }).click();
        await ctx.page.waitForURL(/\/account\/area-clubs\/clubs/, slow);
        await settle(ctx);
        const box = ctx.page.getByLabel("Search clubs");
        await box.fill("Ridge");
        // The box is outlined with its icon, and loses the page's own focus ring.
        await box.blur();
        // The list narrows after a short pause, and the status line says how many clubs match.
        await ctx.page.getByText("1 of 4 clubs match").waitFor({ state: "visible", ...slow });
        await settle(ctx);
        return { target: box.locator("xpath=.."), area: ctx.page.getByRole("listitem").filter({ hasText: behindClub }) };
      },
      "open-club": async (ctx) => ({
        target: ctx.page.getByRole("link", { name: behindClub }),
        area: ctx.page.getByRole("listitem").filter({ hasText: behindClub }),
      }),
      "view-only": async (ctx) => {
        await ctx.page.getByRole("link", { name: behindClub }).click();
        await ctx.page.waitForURL(/\/account\/area\//, slow);
        await settle(ctx);
        return ctx.page.locator("p.inline-notice").first();
      },
      "whos-missing": async (ctx) => {
        await overview(ctx);
        return ctx.page.getByRole("heading", { name: "Who's missing what" });
      },
    },
  },

  "walkthrough-coordinator-records": {
    start: "signed-in-coordinator",
    steps: {
      "open-records": async (ctx) => {
        await overview(ctx);
        return tab(ctx, "Monthly Records");
      },
      "pick-month": async (ctx) => {
        await (await tab(ctx, "Monthly Records")).click();
        await ctx.page.waitForURL(/\/account\/area-clubs\/reports/, slow);
        await settle(ctx);
        return ctx.page.getByRole("navigation", { name: "Report month" }).getByRole("link", { name: /^October 2026/ });
      },
      "see-counts": async (ctx) => {
        await ctx.page.getByRole("navigation", { name: "Report month" }).getByRole("link", { name: /^October 2026/ }).click();
        await settle(ctx);
        return ctx.page.getByRole("region", { name: "October 2026 records" });
      },
      "find-row": async (ctx) => {
        const row = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first();
        return { target: row.locator('[data-state="SUBMITTED"]').first(), area: row };
      },
      "open-record": async (ctx) => {
        const row = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first();
        return { target: row.getByRole("link", { name: /Open record/ }), area: row };
      },
      "read-record": async (ctx) => {
        const row = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first();
        await row.getByRole("link", { name: /Open record/ }).click();
        await ctx.page.waitForURL(/\/account\/area\/.+\/reports\//, slow);
        await settle(ctx);
        return ctx.page.getByText(/View only\. The club files and changes its own reports\./).first();
      },
    },
  },

  "walkthrough-coordinator-points": {
    start: "signed-in-coordinator",
    steps: {
      "open-points": async (ctx) => {
        await overview(ctx);
        return tab(ctx, "Points");
      },
      leader: async (ctx) => {
        await (await tab(ctx, "Points")).click();
        await ctx.page.waitForURL(/\/account\/area-clubs\/points/, slow);
        await settle(ctx);
        return ctx.page.locator(".club-home-count").filter({ hasText: "Points leader" });
      },
      chart: async (ctx) => ctx.page.getByRole("figure", { name: /Top clubs by total points/ }),
      table: async (ctx) => ctx.page.getByText(/Show as a table/).first(),
      "table-row": async (ctx) => {
        await ctx.page.getByText(/Show as a table/).first().click();
        const row = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first();
        await row.waitFor({ state: "visible", ...slow });
        return row;
      },
      "table-open": async (ctx) => {
        const row = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first();
        return { target: row.getByRole("link", { name: /Records/ }), area: row };
      },
    },
  },

  "walkthrough-coordinator-follow-up": {
    start: "signed-in-coordinator",
    steps: {
      "find-club": async (ctx) => {
        await overview(ctx);
        const row = missingRow(ctx, behindClub);
        return { target: row.getByRole("rowheader"), area: row };
      },
      "what-missing": async (ctx) => {
        const row = missingRow(ctx, behindClub);
        return { target: row.getByText("Missing", { exact: true }), alsoMark: row.getByText("Missing 1 earlier month"), area: row.getByRole("rowheader") };
      },
      "next-step": async (ctx) => {
        const row = missingRow(ctx, behindClub);
        return { target: row.getByRole("cell", { name: /Contact the club's director/ }), area: row.getByRole("rowheader") };
      },
      "open-club": async (ctx) => {
        const row = missingRow(ctx, behindClub);
        return { target: row.getByRole("link", { name: "Open club" }), area: row.getByRole("rowheader") };
      },
      "club-records": async (ctx) => {
        await missingRow(ctx, behindClub).getByRole("link", { name: "Open club" }).click();
        await ctx.page.waitForURL(/\/account\/area\//, slow);
        await settle(ctx);
        return ctx.page.locator('section[aria-labelledby="open-club-reports"]');
      },
      contact: async (ctx) => {
        const card = ctx.page.locator('section[aria-labelledby="open-club-team"]');
        return { target: card.getByRole("listitem").first(), area: card.getByRole("heading", { name: "Who runs this club" }) };
      },
    },
  },

  "walkthrough-coordinator-no-director": {
    start: "signed-in-coordinator",
    steps: {
      "getting-started": async (ctx) => {
        await overview(ctx);
        return ctx.page.locator("li").filter({ hasText: "A director for every club" }).first();
      },
      "no-director": async (ctx) => {
        const row = missingRow(ctx, noDirectorClub);
        return { target: row.getByText("No director", { exact: true }), area: row.getByRole("rowheader") };
      },
      "ask-office": async (ctx) => {
        const row = missingRow(ctx, noDirectorClub);
        return { target: row.getByRole("cell", { name: /Ask the conference office to add a director/ }), area: row.getByRole("rowheader") };
      },
      "open-club": async (ctx) => {
        const row = missingRow(ctx, noDirectorClub);
        return { target: row.getByRole("link", { name: "Open club" }), area: row.getByRole("rowheader") };
      },
      "club-admins": async (ctx) => {
        await missingRow(ctx, noDirectorClub).getByRole("link", { name: "Open club" }).click();
        await ctx.page.waitForURL(/\/account\/area\//, slow);
        await settle(ctx);
        // The whole card: a mark on the sentence alone would sit on top of its icon.
        const card = ctx.page.locator('section[aria-labelledby="open-club-team"]');
        await ctx.page.getByText(/No club director is assigned yet/).waitFor({ state: "visible", ...slow });
        return card;
      },
    },
  },
};
