# Visual check

A real-browser job that opens about 40 key pages at 1280 and 390 px wide, signed in as the right role on the seeded
database, takes a picture of each and compares it with a saved one (#1774). It catches a change nobody planned: a color
that moved, a title that repeats, a button that changed size. It adds to the mobile layout audit and the journeys; it does
not replace them.

- The page list is one file: `scripts/visual/pages.ts` (a name, a path and a signed-in role for each).
- The saved pictures ("baselines") are in `tests/visual/baselines/<width>/<name>.png`.
- The runner is `scripts/verify-visual.ts`; the CI job is `.github/workflows/visual-check.yml` ("Visual check").
- It reports without blocking until it has had one week of green runs on `main`; then Caleb can make it a required check.

## Why two runs give the same pictures

- **Fixed clock.** Every part of the run believes it is 2026-09-10 15:00 UTC (`VISUAL_FIXED_NOW`): the seed, the build, the
  app, the script (`scripts/support/fixed-clock.cjs`) and the browser. For the seed, build and script, time still moves forward,
  so timers work; the app server the script starts has a frozen clock (`VISUAL_CLOCK_FROZEN=1`), so "minutes ago" text cannot
  drift with the length of a run.
- **Database times.** A database default (`now()`) ignores that clock, so the script moves every such time back to the fixed
  time after it writes its few synthetic rows (`scripts/support/visual-fixture.ts`). This **rewrites times on the database it
  runs against**: use a freshly seeded throwaway local database. It refuses anything that is not local and seeded.
- **Calm page.** Motion is off, the caret is hidden, fonts and the loading screen are waited out, and a picture is retaken until
  two in a row are identical. Anything random on a page (a QR code, a token) is painted over with a `mask` in the page list.

## Run it locally

Use a fresh local database. The fixed clock is set for each command (an absolute path, so it also works from other folders),
never for `npm ci` or `npm i`.

```
export VISUAL_FIXED_NOW=2026-09-10T15:00:00Z
export CLOCK="--require $PWD/scripts/support/fixed-clock.cjs"
NODE_OPTIONS="$CLOCK" npm run db:deploy
NODE_OPTIONS="$CLOCK" npm run db:seed
for sync in club-forms lodging form-templates event-content; do NODE_OPTIONS="$CLOCK" npm run $sync:sync; done
NODE_OPTIONS="--max-old-space-size=8192 $CLOCK" npm run build
npm i --no-save playwright-core@1.56.1
NODE_OPTIONS="$CLOCK" VISUAL_BROWSER=/usr/bin/google-chrome npm run test:visual
```

`next start` refuses to start in production mode without these fictitious values, so export them too (they are the same ones
the "Compare the pages with the saved pictures" step sets in `.github/workflows/visual-check.yml`; copy them from there):
`MANAGE_LINK_DERIVATION_SECRET`, `ATTENDEE_PASS_SIGNING_SECRET`, `RATE_LIMIT_HASH_SECRET`, `OUTBOX_SWEEP_TOKEN`,
`SECRET_ENCRYPTION_KEY`, `ACCOUNT_EMAIL_SENDER_ADDRESS` and `RESEND_API_KEY`.

It starts the built app itself on port 3100 (set `VISUAL_BASE_URL` to use one that is already running with the same clock: `VISUAL_FIXED_NOW`, the preload and `VISUAL_CLOCK_FROZEN=1`).
`npm run test:visual -- --only=club,area` runs the pages whose name contains one of those words.
The browser version is written to `report.json` and the job summary, so a runner image update is easy to spot.
A failure writes `<name>@<width>-before.png`, `-after.png` and `-diff.png` and `report.json` to `VISUAL_OUT_DIR`
(default: a temp folder), and a table to the job summary in CI.

A page fails when its picture has a different size, or more than 0.1% of its pixels differ (a per-pixel threshold of 0.1,
anti-aliasing ignored). Both numbers are constants at the top of `scripts/visual/compare.ts`.

## Change a look on purpose

1. Make the change. The job fails and shows before, after and difference pictures (artifact `visual-diffs`).
2. Look at the "after" pictures. The reviewer looks at them too: the pictures are the review.
3. Replace the baselines, then commit them with the change:
   - **Best:** run the workflow by hand (Actions, "Visual check", Run workflow on your branch, `update` ticked) and download the
     `visual-baselines` artifact into `tests/visual/baselines`.
   - Or copy the "after" pictures from the `visual-diffs` artifact over the baselines.
   - Locally: `npm run test:visual -- --update`.

Baselines are made by CI's Linux Chrome. A picture made on another system or another Chrome build can differ in text
rendering by more than the tolerance, so a local run may fail pages you did not touch; commit CI's pictures, not local ones.
`--update` also deletes the baselines of pages no longer in the list.

## Add a page

Add one entry to `scripts/visual/pages.ts` (name: lower case letters, digits and dashes), give it an `expectText` that only
the real page shows, and update the baselines. The check fails a page that shows sign-in, a 404 or an error.
