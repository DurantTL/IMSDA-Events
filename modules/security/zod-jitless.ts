/**
 * Zod 4 probes `new Function("")` the first time a browser builds an object
 * schema, to decide whether it can compile fast parsers. The probe's throw is
 * caught, but under the nonce-based Content-Security-Policy (#1401, no
 * `'unsafe-eval'` in production) the browser still logs and reports it as a
 * `script-src` violation on every page. Zod reads `globalThis.__zod_globalConfig`
 * when it loads and skips the probe when `jitless` is set, so the root layout
 * runs this in its nonce'd head script, before any app chunk evaluates.
 * Parsing behaviour is unchanged; Zod falls back to its normal parser.
 */
export const zodJitlessInitScript =
  "(globalThis.__zod_globalConfig||(globalThis.__zod_globalConfig={})).jitless=true;";
