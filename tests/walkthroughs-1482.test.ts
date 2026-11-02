import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { WalkthroughSteps } from "@/components/walkthrough-steps";
import { checkHelpGuides } from "@/modules/help/guide-check";
import { docFileExists, listPageRoutes, publicFileExists } from "@/modules/help/guide-check-files";
import { portalGuides } from "@/modules/help/portal-guides";
import { checkWalkthroughManifest, walkthroughCapturedFor } from "@/modules/help/walkthrough-check";
import { readWalkthroughManifest, walkthroughSourceHash } from "@/modules/help/walkthrough-files";
import { walkthroughDesktopMinWidth, walkthroughImage, walkthroughImageBudgets, walkthroughImageSizes, type WalkthroughImageKind } from "@/modules/help/walkthrough-images";
import { coordinatorWalkthroughs, directorWalkthroughs, walkthroughGuides, walkthroughs, walkthroughsForGuide } from "@/modules/help/walkthroughs";
import { assertWalkthroughSafety, signInRateLimitPolicies } from "@/scripts/support/help-walkthrough-fixtures";
import { buildClubChecklist, type ClubChecklistFacts } from "@/modules/setup-help/club-checklist";
import { buildCoordinatorChecklist } from "@/modules/setup-help/coordinator-checklist";
import { clubCapabilities } from "@/modules/organizations/director-grants-domain";
import { walkthroughActions } from "@/tests/browser/walkthroughs/steps";

/**
 * Walkthroughs (#1482, rule H6): every club director and area coordinator walkthrough has a screenshot of the real screen for
 * each step, captured by `npm run help:screenshots` from the same steps the browser check (`npm run test:walkthroughs`) runs.
 */
const root = process.cwd();
const kinds: WalkthroughImageKind[] = ["phone", "desktop"];

describe("walkthrough data and browser actions", () => {
  it("has the 10 club director and the 6 area coordinator walkthroughs", () => {
    expect(directorWalkthroughs).toHaveLength(10);
    expect(coordinatorWalkthroughs).toHaveLength(6);
    expect(coordinatorWalkthroughs.every((walkthrough) => walkthrough.audience === "coordinator")).toBe(true);
    expect(new Set(walkthroughs.map((walkthrough) => walkthrough.id)).size).toBe(walkthroughs.length);
    for (const walkthrough of walkthroughs) expect(walkthrough.id, walkthrough.id).toMatch(/^walkthrough-(director|coordinator)-[a-z0-9-]+$/);
  });

  it("gives every data step exactly one browser action, and every browser action a data step", () => {
    expect(Object.keys(walkthroughActions).sort()).toEqual(walkthroughs.map((walkthrough) => walkthrough.id).sort());
    for (const walkthrough of walkthroughs) {
      const actions = walkthroughActions[walkthrough.id]!;
      const ids = walkthrough.steps.map((step) => step.id);
      expect(new Set(ids).size, `${walkthrough.id} step ids are unique`).toBe(ids.length);
      expect(Object.keys(actions.steps).sort(), walkthrough.id).toEqual([...ids].sort());
      expect(["signed-out", "signed-in", "signed-in-coordinator"]).toContain(actions.start);
      // A coordinator walkthrough never starts as the club director, and the reverse.
      if (walkthrough.audience === "coordinator") expect(actions.start, walkthrough.id).not.toBe("signed-in");
      if (walkthrough.audience === "director") expect(actions.start, walkthrough.id).not.toBe("signed-in-coordinator");
    }
  });

  it("writes each step as one or two plain sentences with alt text, and no email address or real-looking data", () => {
    for (const walkthrough of walkthroughs) {
      expect(walkthrough.steps.length, walkthrough.id).toBeGreaterThanOrEqual(3);
      expect(walkthrough.steps.length, walkthrough.id).toBeLessThanOrEqual(8);
      for (const step of walkthrough.steps) {
        const sentences = step.text.split(/(?<=[.?!])\s+/).filter(Boolean);
        expect(sentences.length, `${walkthrough.id}/${step.id}: ${step.text}`).toBeLessThanOrEqual(2);
        expect(step.id, step.id).toMatch(/^[a-z0-9-]+$/);
        expect(step.alt.trim().length, `${walkthrough.id}/${step.id} alt`).toBeGreaterThan(15);
        expect(`${step.text} ${step.alt}`, `${walkthrough.id}/${step.id}`).not.toMatch(/\S+@\S+/);
      }
    }
  });

  it("lists each source file once", () => {
    for (const walkthrough of walkthroughs) expect(new Set(walkthrough.sourceFiles).size, walkthrough.id).toBe(walkthrough.sourceFiles.length);
  });

  it("lists the Forms help popup's own files for the get-help walkthrough", () => {
    const help = walkthroughs.find((walkthrough) => walkthrough.id === "walkthrough-director-get-help")!;
    expect(help.sourceFiles).toEqual(expect.arrayContaining(["components/forms-help.tsx", "components/forms-help.module.css", "modules/system-admin/forms-help-contact.ts"]));
  });

  it("lists source files that exist, for the stale-picture check", () => {
    for (const walkthrough of walkthroughs) {
      expect(walkthrough.sourceFiles.length, walkthrough.id).toBeGreaterThan(0);
      for (let index = 0; index < walkthrough.sourceFiles.length; index += 1) expect(typeof walkthrough.sourceFiles[index], `${walkthrough.id} source ${index}`).toBe("string");
      expect(walkthroughSourceHash(walkthrough, root), `${walkthrough.id} lists a missing source file`).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("walkthrough guides", () => {
  it("are portal guides for the right audience, with steps that carry the same sentences", () => {
    for (const walkthrough of walkthroughs) {
      const guide = portalGuides.find((candidate) => candidate.id === walkthrough.id)!;
      expect(guide, walkthrough.id).toBeDefined();
      expect(guide.audience).toBe(walkthrough.audience);
      expect(guide.title).toMatch(/^Step by step: /);
      expect(guide.steps).toEqual(walkthrough.steps.map((step) => step.text));
      expect(guide.walkthrough?.steps).toEqual(walkthrough.steps);
      expect(guide.keywords).toContain("step by step");
    }
    expect(walkthroughGuides).toHaveLength(walkthroughs.length);
  });

  it("are linked from the written guides they match", () => {
    for (const [guideId, ids] of Object.entries(walkthroughsForGuide)) {
      const guide = portalGuides.find((candidate) => candidate.id === guideId)!;
      expect(guide.walkthroughIds, guideId).toEqual(ids);
      for (const id of ids) expect(portalGuides.find((candidate) => candidate.id === id)?.audience, `${guideId} -> ${id}`).toBe(guide.audience);
    }
  });

  it("are what the area coordinator Getting started checklist links to", () => {
    const hrefs = Object.fromEntries(
      buildCoordinatorChecklist({ clubYear: "2026-2027", clubCount: 4, clubsWithoutDirector: 1, recordsMissing: 2, monthNotDue: false, monthLabel: "October 2026", clubsBehind: 3 }).steps.map((step) => [step.id, step.helpHref]),
    );
    expect(hrefs).toMatchObject({
      clubs: "/account/help/walkthrough-coordinator-clubs",
      directors: "/account/help/walkthrough-coordinator-no-director",
      records: "/account/help/walkthrough-coordinator-records",
      behind: "/account/help/walkthrough-coordinator-follow-up",
      points: "/account/help/walkthrough-coordinator-points",
    });
    for (const href of Object.values(hrefs)) {
      if (href?.includes("walkthrough-")) expect(portalGuides.some((guide) => `/account/help/${guide.id}` === href), href).toBe(true);
    }
  });

  it("are what the Getting started checklist links to", () => {
    const facts: ClubChecklistFacts = {
      base: "/account/clubs/club_1",
      role: "DIRECTOR",
      capabilities: clubCapabilities("DIRECTOR"),
      twoStepVerified: true,
      rosterCount: 0,
      registeredEventCount: 0,
      hasOpenEvents: true,
      monthsNotSubmitted: 1,
      sterlingReminders: 0,
    };
    const hrefs = Object.fromEntries(buildClubChecklist(facts).steps.map((step) => [step.id, step.helpHref]));
    expect(hrefs).toMatchObject({
      "two-step": "/account/help/walkthrough-director-two-step",
      leaders: "/account/help/walkthrough-director-leaders",
      roster: "/account/help/walkthrough-director-roster",
      forms: "/account/help/walkthrough-director-club-forms",
      events: "/account/help/walkthrough-director-register-event",
      orders: "/account/help/walkthrough-director-orders",
      records: "/account/help/walkthrough-director-monthly-records",
      help: "/account/help/walkthrough-director-get-help",
    });
    for (const href of Object.values(hrefs)) {
      if (href?.includes("walkthrough-")) expect(portalGuides.some((guide) => `/account/help/${guide.id}` === href), href).toBe(true);
    }
  });
});

describe("walkthrough pictures", () => {
  it("exist for every step at phone and desktop size, with the size the data says", async () => {
    for (const walkthrough of walkthroughs) {
      for (const [index, step] of walkthrough.steps.entries()) {
        for (const kind of kinds) {
          const image = walkthroughImage(walkthrough.id, index, step.id, kind);
          const file = join(root, "public", image.src);
          expect(existsSync(file), `${image.src} is missing. Run: npm run help:screenshots`).toBe(true);
          const meta = await sharp(file).metadata();
          expect(meta.format, image.src).toBe("webp");
          expect({ width: meta.width, height: meta.height }, image.src).toEqual(walkthroughImageSizes[kind]);
        }
      }
    }
  });

  it("stay within the size budget (hard limit 150 KB each; the target is reported)", () => {
    let total = 0;
    const overTarget: string[] = [];
    for (const walkthrough of walkthroughs) {
      for (const [index, step] of walkthrough.steps.entries()) {
        for (const kind of kinds) {
          const image = walkthroughImage(walkthrough.id, index, step.id, kind);
          const bytes = statSync(join(root, "public", image.src)).size;
          total += bytes;
          expect(bytes, `${image.src} is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(walkthroughImageBudgets[kind].hardLimit);
          if (bytes > walkthroughImageBudgets[kind].target) overTarget.push(`${image.src} ${(bytes / 1024).toFixed(0)} KB`);
        }
      }
    }
    if (overTarget.length > 0) console.warn(`Over the target size:\n${overTarget.join("\n")}`);
    // About 6 MB for all 16 walkthroughs.
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024);
  });

  it("has no picture file that no step uses", () => {
    for (const walkthrough of walkthroughs) {
      const used = new Set(walkthrough.steps.flatMap((step, index) => kinds.map((kind) => walkthroughImage(walkthrough.id, index, step.id, kind).src.split("/").pop())));
      const dir = join(root, "public", "help", "walkthroughs", walkthrough.id);
      for (const name of existsSync(dir) ? readdirSync(dir) : []) expect(used.has(name), `${walkthrough.id}/${name} is not used by any step`).toBe(true);
    }
  });

  it("have a manifest entry for every walkthrough, with a capture date", () => {
    const manifest = readWalkthroughManifest(root);
    for (const walkthrough of walkthroughs) {
      expect(walkthroughCapturedFor(manifest, walkthrough.id), walkthrough.id).not.toBeNull();
    }
  });

  it("make help:check report no problem for the walkthrough guides", () => {
    const problems = checkHelpGuides({
      now: new Date("2026-11-15T12:00:00Z"),
      routes: listPageRoutes(root),
      docExists: (path) => docFileExists(path, root),
      publicFileExists: (path) => publicFileExists(path, root),
    }).filter((problem) => problem.subject.startsWith("walkthrough-"));
    expect(problems).toEqual([]);
  });

  it("is reported by help:check when a picture file is missing", () => {
    const problems = checkHelpGuides({
      now: new Date("2026-11-15T12:00:00Z"),
      routes: listPageRoutes(root),
      docExists: () => true,
      publicFileExists: (path) => !path.includes("/walkthrough-director-roster/"),
    }).filter((problem) => problem.kind === "missing-screenshot");
    expect(problems.length).toBe(directorWalkthroughs.find((walkthrough) => walkthrough.id === "walkthrough-director-roster")!.steps.length * 2);
    expect(problems[0]!.message).toContain("npm run help:screenshots");
  });
});

describe("stale picture warning", () => {
  const sample = [{ id: "walkthrough-a" }, { id: "walkthrough-b" }, { id: "walkthrough-c" }, { id: "walkthrough-d" }];
  const manifest = {
    "walkthrough-a": { capturedFor: "2026-11-01", sourceHash: "aaa" },
    "walkthrough-b": { capturedFor: "2026-11-01", sourceHash: "old" },
    "walkthrough-d": { capturedFor: "2026-11-01", sourceHash: "ddd" },
  };

  it("warns about changed source, a missing manifest entry and a missing source file, and only about those", () => {
    const warnings = checkWalkthroughManifest({ walkthroughs: sample, manifest, currentHashes: { "walkthrough-a": "aaa", "walkthrough-b": "new", "walkthrough-c": "ccc", "walkthrough-d": null } });
    expect(warnings.map((warning) => [warning.walkthroughId, warning.kind])).toEqual([
      ["walkthrough-b", "stale-pictures"],
      ["walkthrough-c", "not-captured"],
      ["walkthrough-d", "missing-source"],
    ]);
    expect(warnings[0]!.message).toContain("HELP_SHOTS_ONLY=walkthrough-b npm run help:screenshots");
  });

  it("is quiet when every hash matches", () => {
    expect(checkWalkthroughManifest({ walkthroughs: sample.slice(0, 1), manifest, currentHashes: { "walkthrough-a": "aaa" } })).toEqual([]);
  });

  it("changes the source hash when a declared file changes", () => {
    const a = walkthroughSourceHash({ sourceFiles: ["package.json"] }, root);
    const b = walkthroughSourceHash({ sourceFiles: ["package.json", "tsconfig.json"] }, root);
    expect(a).not.toBe(b);
    expect(walkthroughSourceHash({ sourceFiles: ["package.json"] }, root)).toBe(a);
    expect(walkthroughSourceHash({ sourceFiles: ["does-not-exist.tsx"] }, root)).toBeNull();
    // The files' order does not matter.
    expect(walkthroughSourceHash({ sourceFiles: ["tsconfig.json", "package.json"] }, root)).toBe(b);
  });

  it("is up to date for the committed pictures (a mismatch is a warning in help:check, shown here when it happens)", () => {
    const manifest = readWalkthroughManifest(root);
    const warnings = checkWalkthroughManifest({
      walkthroughs,
      manifest,
      currentHashes: Object.fromEntries(walkthroughs.map((walkthrough) => [walkthrough.id, walkthroughSourceHash(walkthrough, root)])),
    });
    if (warnings.length > 0) console.warn(warnings.map((warning) => warning.message).join("\n"));
    expect(warnings.filter((warning) => warning.kind === "missing-source")).toEqual([]);
  });
});

describe("the guide page's steps", () => {
  const steps = [{ id: "open-it", text: "Open it.", alt: "The page that opens." }];

  it("shows each step as text then a responsive picture with its caption", () => {
    const html = renderToStaticMarkup(createElement(WalkthroughSteps, { guideId: "walkthrough-x", steps, lastReviewed: "2026-11-01", capturedFor: "2026-11-01" }));
    expect(html).toContain("<ol");
    expect(html).toContain("Open it.");
    expect(html).toContain("<picture>");
    expect(html).toContain(`media="(min-width: ${walkthroughDesktopMinWidth}px)"`);
    expect(html).toContain('srcSet="/help/walkthroughs/walkthrough-x/01-open-it-desktop.webp"');
    expect(html).toContain('src="/help/walkthroughs/walkthrough-x/01-open-it-phone.webp"');
    expect(html).toContain('width="390"');
    expect(html).toContain('height="844"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="The page that opens."');
    expect(html).toContain("Example with sample data");
    expect(html).not.toContain("may be out of date");
  });

  it("says the pictures may be out of date when the guide was reviewed later, or they were never captured", () => {
    const later = renderToStaticMarkup(createElement(WalkthroughSteps, { guideId: "walkthrough-x", steps, lastReviewed: "2026-11-05", capturedFor: "2026-11-01" }));
    expect(later).toContain("This picture may be out of date; the steps above are current.");
    const never = renderToStaticMarkup(createElement(WalkthroughSteps, { guideId: "walkthrough-x", steps, lastReviewed: "2026-11-01", capturedFor: null }));
    expect(never).toContain("may be out of date");
  });
});

describe("the capture and check scripts", () => {
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  it("refuse a non-local app URL, a non-local database, production and an environment with account email set, and accept the local setup", () => {
    const local = { DATABASE_URL: "postgresql://imsda:pw@localhost:5432/imsda_events?schema=public" };
    expect(() => assertWalkthroughSafety("http://localhost:3000", local)).not.toThrow();
    expect(() => assertWalkthroughSafety("https://events.example.org", local)).toThrow(/outside localhost/);
    expect(() => assertWalkthroughSafety("http://localhost:3000", { DATABASE_URL: "postgresql://imsda:pw@db.example.org:5432/imsda_events" })).toThrow(/outside a local database/);
    expect(() => assertWalkthroughSafety("http://localhost:3000", { ...local, NODE_ENV: "production" })).toThrow(/NODE_ENV=production/);
    expect(() => assertWalkthroughSafety("http://localhost:3000", {})).toThrow(/DATABASE_URL is required/);
    expect(() => assertWalkthroughSafety("http://localhost:3000", { ...local, ACCOUNT_EMAIL_SENDER_ADDRESS: "events@example.test" })).toThrow(/ACCOUNT_EMAIL_SENDER_ADDRESS/);
    expect(() => assertWalkthroughSafety("http://localhost:3000", { ...local, RESEND_API_KEY: "placeholder" })).toThrow(/RESEND_API_KEY/);
    // A blank value is the same as not set (that is how .env.example ships them).
    expect(() => assertWalkthroughSafety("http://localhost:3000", { ...local, ACCOUNT_EMAIL_SENDER_ADDRESS: "", RESEND_API_KEY: " " })).not.toThrow();
  });

  it("checks safety, then the seeded database, then writes the restore marker, then makes the first change", () => {
    const harness = read("scripts/support/walkthrough-harness.ts");
    const at = (text: string) => {
      const index = harness.indexOf(text);
      expect(index, text).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at("fixtures.assertWalkthroughSafety(baseUrl)"),
      at("fixtures.assertSeededDatabase(prisma)"),
      at("writeRestoreMarker(markerFile"),
      // Only a marker this run wrote is restored from or removed: the state is kept only after the write succeeds.
      at("restoreState = before;"),
      at("fixtures.enablePasskeys(prisma)"),
      at("fixtures.hideClubs(prisma"),
      at("fixtures.setEventsPublished(prisma"),
      at("fixtures.createWalkthroughFixtures(prisma)"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // A signal never restores or exits by itself: the single finally does.
    expect(harness).not.toMatch(/const onSignal[\s\S]{0,400}process\.exit/);
  });

  it("keeps the portal Help search's browser bundle small: it imports only the tiny filter module", () => {
    const search = read("app/(public)/account/(portal)/help/portal-help-search.tsx");
    expect(search).toContain('from "@/modules/help/guide-filter"');
    expect(search).not.toContain("modules/help/visibility");
    expect(read("modules/help/guide-filter.ts")).not.toMatch(/^import /m);
    expect(read("modules/help/visibility.ts")).toContain('export { filterGuides } from "@/modules/help/guide-filter"');
  });

  it("moves focus back to the search box after Show all guides (rule S5)", () => {
    const search = read("app/(public)/account/(portal)/help/portal-help-search.tsx");
    expect(search).toMatch(/onClick=\{\(\) => \{ search\.setValue\(""\); inputRef\.current\?\.focus\(\); \}\}[^>]*>Show all guides/);
  });

  it("clears only the sign-in rate limits, and has no outbox fallback for the code", () => {
    expect(signInRateLimitPolicies).toEqual(["attendee.sign-in", "attendee.roster-unlock", "attendee.passkey"]);
    expect(read("scripts/support/walkthrough-harness.ts")).not.toContain("messageOutbox");
    expect(read("scripts/support/help-walkthrough-fixtures.ts")).not.toMatch(/rateLimitBucket\.deleteMany\(\{\}\)/);
  });

  it("use only synthetic fixtures: a walkthrough id prefix, example.test emails and valid sample phones", () => {
    const fixtures = read("scripts/support/help-walkthrough-fixtures.ts");
    for (const email of fixtures.match(/[\w.${}]+@[\w.-]+/g) ?? []) expect(email, email).toMatch(/@example\.test$|@imsda-events\.test$/);
    for (const phone of fixtures.match(/\(\d{3}\) \d{3}-\d{4}/g) ?? []) expect(phone, phone).toMatch(/^\(515\) 555-01\d\d$/);
    expect(fixtures).toContain('export const W = "walkthrough"');
  });

  it("has the two npm commands", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["help:screenshots"]).toContain("scripts/capture-help-screenshots.ts");
    expect(scripts["test:walkthroughs"]).toContain("scripts/verify-help-walkthroughs.ts");
  });
});
