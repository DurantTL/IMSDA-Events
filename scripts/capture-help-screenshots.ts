/**
 * Regenerates the walkthrough pictures (#1482): `npm run help:screenshots`.
 *
 * For each walkthrough in `modules/help/walkthroughs.ts` it resets the synthetic fixtures, signs in (for real, through the
 * page, for the sign-in walkthroughs), runs the shared steps from `tests/browser/walkthroughs/`, marks the control with a
 * numbered outline, screenshots the screen at 390 x 844 (phone) and 1280 x 800 (desktop), and saves WebP files to
 * `public/help/walkthroughs/<guideId>/`. It also writes `public/help/walkthroughs/manifest.json` (capture date and a hash of
 * the walkthrough's source files), which `npm run help:check` compares to warn about stale pictures.
 *
 * LOCAL USE ONLY: see `scripts/support/walkthrough-harness.ts` for the guards. The app must already be running (default
 * http://localhost:3000, outside production, with no ACCOUNT_EMAIL_* set).
 *
 * Environment:
 *   HELP_SHOTS_BASE_URL  default http://localhost:3000
 *   HELP_SHOTS_ONLY      only walkthroughs whose id contains this text
 *   HELP_SHOTS_BROWSER   path to a Chromium executable (default: Playwright's)
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { walkthroughImage, walkthroughImageSizes, walkthroughImageRoot, type WalkthroughImageKind } from "../modules/help/walkthrough-images";
import type { WalkthroughManifest } from "../modules/help/walkthrough-check";
import { readWalkthroughManifest, walkthroughManifestFile, walkthroughSourceHash } from "../modules/help/walkthrough-files";
import { findWalkthrough } from "../modules/help/walkthroughs";
import { drawMarkInPage, overlayId, removeMarkInPage } from "./support/walkthrough-overlay";
import { runWalkthroughHarness } from "./support/walkthrough-harness";

const baseUrl = process.env.HELP_SHOTS_BASE_URL ?? "http://localhost:3000";
const only = process.env.HELP_SHOTS_ONLY || undefined;
const root = process.cwd();
const publicDir = path.join(root, "public");

/** Encodes one screenshot: WebP quality 70, effort 6; the desktop screen is resized to 960 px wide. */
export async function encodeWalkthroughImage(png: Buffer, kind: WalkthroughImageKind) {
  const size = walkthroughImageSizes[kind];
  return sharp(png).resize({ width: size.width }).webp({ quality: 70, effort: 6 }).toBuffer();
}

async function main() {
  const written = new Set<string>();
  const sizes: number[] = [];
  const result = await runWalkthroughHarness({
    baseUrl,
    only,
    kinds: ["phone", "desktop"],
    onStep: async ({ walkthroughId, stepId, index, kind, page, target }) => {
      if (target) {
        // Let a page change finish first: a Next.js navigation scrolls back to the top after it renders.
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(400);
        // Bring the control into the middle of the screen, then mark it.
        await target.first().evaluate((element: Element) => {
          element.scrollIntoView({ block: "center", inline: "nearest" });
          (window as unknown as { __walkthroughTarget?: Element }).__walkthroughTarget = element;
        });
        await page.waitForTimeout(300);
        await page.evaluate(drawMarkInPage, { number: index + 1, id: overlayId });
      }
      const png: Buffer = await page.screenshot({ type: "png" });
      if (target) await page.evaluate(removeMarkInPage, overlayId);
      const image = walkthroughImage(walkthroughId, index, stepId, kind);
      const file = path.join(publicDir, image.src);
      mkdirSync(path.dirname(file), { recursive: true });
      const webp = await encodeWalkthroughImage(png, kind);
      writeFileSync(file, webp);
      written.add(file);
      sizes.push(webp.length);
      console.log(`  ${path.basename(file)} ${(webp.length / 1024).toFixed(1)} KB`);
    },
  });

  // Remove pictures of steps that no longer exist, for the walkthroughs that ran.
  for (const walkthroughId of new Set(result.map((row) => row.walkthroughId))) {
    const dir = path.join(publicDir, walkthroughImageRoot, walkthroughId);
    for (const name of readdirSync(dir)) if (!written.has(path.join(dir, name))) rmSync(path.join(dir, name));
  }

  const manifest: WalkthroughManifest = readWalkthroughManifest(root);
  const today = new Date().toISOString().slice(0, 10);
  for (const walkthroughId of new Set(result.map((row) => row.walkthroughId))) {
    const definition = findWalkthrough(walkthroughId)!;
    const sourceHash = walkthroughSourceHash(definition, root);
    if (!sourceHash) throw new Error(`Walkthrough "${walkthroughId}" lists a source file that does not exist.`);
    manifest[walkthroughId] = { capturedFor: today, sourceHash };
  }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(walkthroughManifestFile(root), `${JSON.stringify(sorted, null, 2)}\n`);
  const total = sizes.reduce((sum, value) => sum + value, 0);
  console.log(`\nSaved ${sizes.length} pictures (${(total / 1024).toFixed(0)} KB) for ${new Set(result.map((row) => row.walkthroughId)).size} walkthroughs.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
