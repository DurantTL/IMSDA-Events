/**
 * Fixed clock for the visual check (#1774). Preload it with `node --require` (or NODE_OPTIONS) and set
 * VISUAL_FIXED_NOW to an ISO time: `new Date()` and `Date.now()` then start at that time in this process and
 * move forward with the real clock from there, so timers, timeouts and rate-limit windows still behave. Every
 * process of a visual run (seed, syncs, the app server and the screenshot script) starts at the same moment,
 * so "today", "upcoming", the club year and every date the pages show are the same on every run.
 *
 * Without VISUAL_FIXED_NOW this file does nothing. It never runs in the deployed app: only the visual check sets it.
 */
"use strict";

const fixed = process.env.VISUAL_FIXED_NOW;
if (fixed && !globalThis.__visualFixedClock) {
  const start = Date.parse(fixed);
  if (Number.isNaN(start)) throw new Error(`VISUAL_FIXED_NOW is not a date: ${fixed}`);
  const RealDate = Date;
  const realStart = RealDate.now();
  const now = () => start + (RealDate.now() - realStart);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() {
      return now();
    }
  }
  // Own copies of every static (UTC, parse, ...), not just inherited ones: some code, and Next.js build workers, copy only
  // own properties, and `Date.UTC is not a function` then breaks the build. `now` stays the fixed one defined above.
  for (const key of Object.getOwnPropertyNames(RealDate)) {
    if (["length", "name", "prototype", "now"].includes(key)) continue;
    Object.defineProperty(FixedDate, key, { value: RealDate[key], writable: true, configurable: true });
  }
  // Calling Date() without `new` returns a string in real JavaScript.
  const DateFunction = new Proxy(FixedDate, {
    apply() {
      return new RealDate(now()).toString();
    },
  });
  globalThis.Date = DateFunction;
  globalThis.__visualFixedClock = { start, realStart };
}
