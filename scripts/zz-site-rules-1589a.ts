// Temporary local site-rules browser check for #1589 part A (not committed).
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { Recorder, checkPage, checkSearchBoxes, checkTabs, checkButtons, checkChipsAndBadges } from "./support/site-rule-checks";
loadEnvConfig(process.cwd());
const base = "http://localhost:3000";
const out = process.env.OUT!;
async function main() {
  const prisma = new PrismaClient();
  const { createDatabaseSession } = await import("../modules/access/session-store");
  const { staffSessionCookie } = await import("../modules/security/session-cookies");
  const user = await prisma.user.findUnique({ where: { email: "system@imsda-events.test" } });
  const session = await createDatabaseSession(user!.id, null);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const lines: string[] = [];
  for (const width of [1280, 390]) {
    const rec = new Recorder(String(width));
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: staffSessionCookie.legacyName, value: session.token, url: base }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    const visit = async (name: string, path: string) => {
      const response = await page.goto(base + path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      lines.push(`${width} ${name}: status ${response?.status()} url ${page.url().replace(base, "")} h1="${(await page.locator("h1").first().innerText().catch(() => "")).trim()}"`);
      await page.screenshot({ path: `${out}/${width}-${name}.png`, fullPage: true });
      for (const check of [checkPage, checkSearchBoxes, checkTabs, checkButtons, checkChipsAndBadges]) {
        try { await (check as (p: unknown, r: Recorder, n: string) => Promise<void>)(page, rec, name); } catch (e) { lines.push(`  ${name} ${check.name} threw: ${(e as Error).message.split("\n")[0]}`); }
      }
    };
    await visit("leaders-current", "/admin/clubs/leaders");
    await visit("leaders-invited", "/admin/clubs/leaders?status=invited");
    await visit("leaders-draft", "/admin/clubs/leaders?status=draft");
    await visit("invites-redirect", "/admin/clubs/invites");
    await visit("clubs-dashboard", "/admin/clubs");
    // B2: change the status filter in the page; it lands in the URL and Back undoes it.
    await page.goto(base + "/admin/clubs/leaders", { waitUntil: "load" });
    const select = page.locator('select[name="status"]');
    if (await select.count()) {
      await select.selectOption("draft");
      await page.waitForURL(/status=draft/, { timeout: 15000 }).then(() => lines.push(`${width} B2 status select -> ${page.url().replace(base, "")}: pass`), () => lines.push(`${width} B2 status select: FAIL url ${page.url()}`));
      await page.goBack();
      await page.waitForURL((u: URL) => !u.searchParams.get("status"), { timeout: 15000 }).then(() => lines.push(`${width} B2 Back -> ${page.url().replace(base, "")}: pass`), () => lines.push(`${width} B2 Back: FAIL ${page.url()}`));
    } else lines.push(`${width} no status select found`);
    // Waiting invites card links to Invited.
    await page.goto(base + "/admin/clubs", { waitUntil: "load" });
    const card = page.locator('a[href*="/admin/clubs/leaders?status=invited"]').first();
    lines.push(`${width} dashboard waiting-invites link: ${(await card.count()) ? `"${(await card.innerText()).replace(/\s+/g, " ").trim()}"` : "MISSING"}`);
    // Horizontal scroll check.
    for (const path of ["/admin/clubs/leaders?status=invited", "/admin/clubs/leaders?status=draft", "/admin/clubs/leaders"]) {
      await page.goto(base + path, { waitUntil: "load" });
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      lines.push(`${width} ${path} scrollWidth ${sw[0]} / ${sw[1]} ${sw[0]! <= sw[1]! ? "ok" : "SIDEWAYS"}`);
    }
    lines.push(`${width} page errors: ${errors.length ? errors.join(" | ") : "none"}`);
    lines.push(...rec.summary().map((l) => `${width}${l}`));
    await context.close();
  }
  await browser.close();
  console.log(lines.join("\n"));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
