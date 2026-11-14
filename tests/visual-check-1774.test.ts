import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { compareImages, MAX_DIFFERING_SHARE, PIXEL_THRESHOLD } from "../scripts/visual/compare";
import { VISUAL_FIXED_NOW, visualPages, visualRoles, visualWidths } from "../scripts/visual/pages";

/** Site rule C7 (docs/SITE-RULES.md, #1774): the visual check's page list, comparison, fixed clock and workflow. */
const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function picture(width: number, height: number, paint?: (x: number, y: number) => boolean) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dark = paint?.(x, y) ?? false;
      png.data[index] = png.data[index + 1] = png.data[index + 2] = dark ? 0 : 255;
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("the visual check page list", () => {
  it("has 35 to 45 pages with unique, file-safe names and valid roles", () => {
    expect(visualPages.length).toBeGreaterThanOrEqual(35);
    expect(visualPages.length).toBeLessThanOrEqual(45);
    const names = visualPages.map((page) => page.name);
    expect(new Set(names).size).toBe(names.length);
    for (const page of visualPages) {
      expect(page.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(visualRoles).toContain(page.role);
      expect(page.path.startsWith("/")).toBe(true);
    }
    expect(visualWidths).toEqual([1280, 390]);
  });

  it("covers every area of the issue", () => {
    const has = (pattern: RegExp) => visualPages.some((page) => pattern.test(page.name));
    for (const pattern of [
      /^public-home$/, /^public-calendar/, /^public-event-page$/, /^register-form$/,
      /^attendee-overview$/, /^attendee-registrations$/, /^attendee-profile$/,
      /^club-home$/, /^club-roster$/, /^club-forms$/, /^club-monthly-records$/,
      /^area-overview$/, /^area-events$/,
      /^staff-home$/, /^staff-event-home$/, /^staff-registrations$/, /^staff-check-in$/, /^staff-money$/, /^staff-reports$/, /^staff-event-setup$/,
      /^admin-hub-events$/, /^admin-hub-clubs$/, /^admin-hub-people$/, /^admin-hub-forms$/, /^admin-hub-catalogs$/,
    ]) expect(has(pattern), String(pattern)).toBe(true);
    expect(visualPages.filter((page) => page.area === "system").length).toBeGreaterThanOrEqual(2);
    expect(visualPages.find((page) => page.name === "staff-event-home")?.path).toContain("/overview?event=evt_wr26");
  });
});

describe("compareImages", () => {
  const base = picture(100, 100);

  it("passes identical pictures", () => {
    const result = compareImages(base, base);
    expect(result.ok).toBe(true);
  });

  it("passes a tiny change under the tolerance", () => {
    // 5 of 10,000 pixels is 0.05%.
    const tiny = picture(100, 100, (x, y) => y === 0 && x < 5);
    expect(5 / 10_000).toBeLessThan(MAX_DIFFERING_SHARE);
    expect(compareImages(base, tiny).ok).toBe(true);
  });

  it("fails a different size", () => {
    const result = compareImages(base, picture(100, 120));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("size");
  });

  it("fails a bigger change and returns a difference picture", () => {
    const result = compareImages(base, picture(100, 100, (_x, y) => y < 5));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("pixels");
      expect(result.diff?.length).toBeGreaterThan(0);
    }
  });

  it("keeps the agreed limits", () => {
    expect(PIXEL_THRESHOLD).toBe(0.1);
    expect(MAX_DIFFERING_SHARE).toBe(0.001);
  });
});

describe("the fixed clock preload", () => {
  const run = (code: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--require", path.join(root, "scripts/support/fixed-clock.cjs"), "-e", code], {
      env: { ...process.env, VISUAL_FIXED_NOW: "", ...env }, encoding: "utf8",
    });

  it("starts Date at the fixed time and lets it move forward", () => {
    const result = run(
      "const a = Date.now(); const s = new Date().toISOString(); setTimeout(() => { console.log(JSON.stringify({ s, moved: Date.now() > a, str: typeof Date() })); }, 30);",
      { VISUAL_FIXED_NOW },
    );
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.s.startsWith("2026-09-10T15:00:00")).toBe(true);
    expect(out.moved).toBe(true);
    expect(out.str).toBe("string");
  });

  it("keeps Date.UTC and Date.parse working, also when only own properties are copied", () => {
    const result = run(
      "const copy = {}; for (const key of Object.getOwnPropertyNames(Date)) copy[key] = Date[key]; console.log(JSON.stringify([Date.UTC(2026, 3, 1), typeof copy.UTC, typeof copy.parse, Date.parse('2026-01-01T00:00:00Z'), new Date(2020, 0, 1) instanceof Date]));",
      { VISUAL_FIXED_NOW },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([Date.UTC(2026, 3, 1), "function", "function", Date.parse("2026-01-01T00:00:00Z"), true]);
  });

  it("stands still with VISUAL_CLOCK_FROZEN=1, and moves without it", () => {
    const code = "const a = Date.now(); setTimeout(() => console.log(JSON.stringify([a === Date.now(), new Date().toISOString()])), 40);";
    const frozen = JSON.parse(run(code, { VISUAL_FIXED_NOW, VISUAL_CLOCK_FROZEN: "1" }).stdout);
    expect(frozen).toEqual([true, "2026-09-10T15:00:00.000Z"]);
    const moving = JSON.parse(run(code, { VISUAL_FIXED_NOW, VISUAL_CLOCK_FROZEN: "" }).stdout);
    expect(moving[0]).toBe(false);
  });

  it("does nothing without VISUAL_FIXED_NOW", () => {
    const result = run("console.log(typeof globalThis.__visualFixedClock)");
    expect(result.stdout.trim()).toBe("undefined");
  });
});

describe("the visual check workflow", () => {
  const workflow = read(".github/workflows/visual-check.yml");

  it("runs on the paths the issue names, on main, and by hand with an update option", () => {
    for (const glob of ["app/**", "components/**", "**/*.css", "tests/visual/**", "scripts/verify-visual.ts", "scripts/visual/**", "scripts/support/visual-fixture.ts", "scripts/support/fixed-clock.cjs", ".github/workflows/visual-check.yml"]) {
      expect(workflow).toContain(`"${glob}"`);
    }
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*update:[\s\S]*type: boolean/);
  });

  it("sets the fixed clock for the whole job, caches the build, uploads the pictures and is not optional yet by flag", () => {
    expect(workflow).toContain(`VISUAL_FIXED_NOW: ${VISUAL_FIXED_NOW}`);
    // The job-level NODE_OPTIONS must not preload the clock: `npm ci` and `npm i` run install scripts from their own folders.
    expect(workflow).toMatch(/^ {6}NODE_OPTIONS: --max-old-space-size=10240$/m);
    expect(workflow).toContain("--require ${{ github.workspace }}/scripts/support/fixed-clock.cjs");
    expect(workflow).not.toMatch(/--require \.\//);
    for (const command of ["db:deploy", "db:seed", "club-forms:sync", "lodging:sync", "form-templates:sync", "event-content:sync", "run build"]) {
      expect(workflow, command).toMatch(new RegExp(`run: npm run ${command.replace("run ", "")}\\n\\s+env:\\n\\s+NODE_OPTIONS: \\$\\{\\{ env\\.FIXED_CLOCK_OPTIONS \\}\\}`));
    }
    expect(workflow).not.toMatch(/run: npm (ci|i --no-save[^\n]*)\n\s+env:/);
    expect(workflow).toContain(".next/cache");
    expect(workflow).toContain("name: visual-diffs");
    expect(workflow).toContain("name: visual-baselines");
    expect(workflow).toContain("timeout-minutes: 20");
    expect(workflow).toContain("playwright-core@1.56.1");
    expect(workflow).not.toMatch(/^\s*continue-on-error:/m);
    expect(workflow).toMatch(/not a required check/i);
  });

  it("names the check in AGENTS.md and the site rules", () => {
    expect(read("AGENTS.md")).toContain("npm run test:visual");
    expect(read("docs/SITE-RULES.md")).toMatch(/\| C7 \|.*test:visual/);
  });
});
