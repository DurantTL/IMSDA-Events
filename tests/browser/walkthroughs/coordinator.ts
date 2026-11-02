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

/** A tab of the Club coordination menu. */
const tab = (ctx: WalkthroughContext, name: string) => ctx.page.getByRole("link", { name, exact: true }).first();

export const coordinatorWalkthroughActions: Record<string, WalkthroughActions> = {
  "walkthrough-coordinator-sign-in": {
    start: "signed-out",
    steps: {
      "enter-details": async (ctx) => {
        await open(ctx, "/account/sign-in");
        await ctx.page.getByLabel("Email address").fill(ctx.coordinator.email);
        await ctx.page.locator('input[name="password"]').fill(ctx.coordinator.password);
        return ctx.page.getByRole("button", { name: "Sign in", exact: true });
      },
      confirm: async (ctx) => {
        await ctx.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await ctx.page.waitForURL(/\/account\/two-step/, slow);
        await settle(ctx);
        return ctx.page.getByLabel("Authenticator code");
      },
      "enter-code": async (ctx) => {
        await ctx.page.getByLabel("Authenticator code").fill(ctx.authenticatorCode());
        return ctx.page.getByRole("button", { name: "Continue", exact: true });
      },
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
      "open-clubs": async (ctx) => {
        await overview(ctx);
        return tab(ctx, "All clubs");
      },
      search: async (ctx) => {
        await tab(ctx, "All clubs").click();
        await ctx.page.waitForURL(/\/account\/clubs/, slow);
        await settle(ctx);
        return ctx.page.getByPlaceholder("Search by club, church or city");
      },
      "open-club": async (ctx) => ctx.page.getByRole("link", { name: /Open club/ }).first(),
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
        await tab(ctx, "Monthly Records").click();
        await ctx.page.waitForURL(/\/account\/area-clubs\/reports/, slow);
        await settle(ctx);
        return ctx.page.getByRole("link", { name: /^October 2026/ });
      },
      "see-states": async (ctx) => {
        await ctx.page.getByRole("link", { name: /^October 2026/ }).click();
        await settle(ctx);
        return ctx.page.getByText("Submitted", { exact: true }).first();
      },
      "open-record": async (ctx) => {
        const row = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first();
        return row.getByRole("link", { name: /Open record/ });
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
      chart: async (ctx) => {
        await tab(ctx, "Points").click();
        await ctx.page.waitForURL(/\/account\/area-clubs\/points/, slow);
        await settle(ctx);
        return ctx.page.getByText("Points leader", { exact: true }).locator("xpath=..");
      },
      table: async (ctx) => ctx.page.getByText(/Show as a table/).first(),
      "table-open": async (ctx) => {
        await ctx.page.getByText(/Show as a table/).first().click();
        const records = ctx.page.getByRole("row", { name: new RegExp(filedClub) }).first().getByRole("link", { name: /Records/ });
        await records.waitFor({ state: "visible", ...slow });
        return records;
      },
    },
  },

  "walkthrough-coordinator-follow-up": {
    start: "signed-in-coordinator",
    steps: {
      "find-club": async (ctx) => {
        await overview(ctx);
        return missingRow(ctx, behindClub).getByText("Missing 1 earlier month");
      },
      "next-step": async (ctx) => missingRow(ctx, behindClub).getByText(/Contact the club's director/),
      "open-club": async (ctx) => missingRow(ctx, behindClub).getByRole("link", { name: "Open club" }),
      "club-records": async (ctx) => {
        await missingRow(ctx, behindClub).getByRole("link", { name: "Open club" }).click();
        await ctx.page.waitForURL(/\/account\/area\//, slow);
        await settle(ctx);
        return ctx.page.getByRole("heading", { name: "Monthly Records" });
      },
      contact: async (ctx) => ctx.page.getByText("Sam Example").first(),
    },
  },

  "walkthrough-coordinator-no-director": {
    start: "signed-in-coordinator",
    steps: {
      "getting-started": async (ctx) => {
        await overview(ctx);
        return ctx.page.getByText("A director for every club");
      },
      "no-director": async (ctx) => missingRow(ctx, noDirectorClub).getByText("No director", { exact: true }),
      "ask-office": async (ctx) => missingRow(ctx, noDirectorClub).getByText(/Ask the conference office to add a director/),
      "club-admins": async (ctx) => {
        await missingRow(ctx, noDirectorClub).getByRole("link", { name: "Open club" }).click();
        await ctx.page.waitForURL(/\/account\/area\//, slow);
        await settle(ctx);
        // The whole Club admins card: a mark on the sentence alone would sit on top of its icon.
        const card = ctx.page.locator('section[aria-labelledby="open-club-team"]');
        await ctx.page.getByText(/No club director is assigned yet/).waitFor({ state: "visible", ...slow });
        return card;
      },
    },
  },
};
