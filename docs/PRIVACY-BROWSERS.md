# Privacy browsers and blockers (#1445)

Rule: every page and action works in Brave (Shields on, standard and aggressive), Avast Secure Browser, Firefox (strict
tracking protection) and Safari (tracking prevention). If a blocker stops something optional (analytics), nothing visible
breaks. If it stops something needed (the card form, the Security check, passkeys), the person sees a clear message and
another way through, never a silent failure.

Related: `docs/SERVER-CALCULATIONS-AUDIT.md` (the server, not the browser, decides every amount).

## What can be blocked

| Dependency | What it is | What blocks it | What the person sees when it is blocked | Code |
| --- | --- | --- | --- | --- |
| Square Web Payments (card, Apple Pay, Google Pay) | Script from `web.squarecdn.com` (sandbox: `sandbox.web.squarecdn.com`), card fields in Square's own iframe, tokenisation at `pci-connect.squareup.com`, fonts from `square-fonts-production-f.squarecdn.com`, error telemetry to `*.ingest.sentry.io`. Used on the private registration page (`/manage/<token>`), the account's registration page and club payments. | Brave Shields (aggressive), Avast Anti-Tracking, uBlock-style lists, corporate filters, strict iframe blocking | A red notice: "The secure card form could not load. A browser privacy setting, an ad blocker or the network may be blocking Square. Your registration is saved." It names the other ways to pay (Pay later in the options above, **Pay on Square** where the event offers it, or in person) and has a **Try again** button that loads the script and builds the card form again. A script request that is held open (not refused) gives up after 20 seconds and shows the same notice. The amount shown (`Pay $74.46 securely with Square`) is the server's. | `components/public-square-payment.tsx` (`sdkFailed`, `retrySquareLoad`) |
| Cloudflare Turnstile ("Security check") | Script from `challenges.cloudflare.com`, widget in a Cloudflare iframe. One shared widget on sign-in, sign-up, password reset, registration recovery, public and group registration, club applications, information forms and club forms. Off until `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set. | Brave Shields, Avast, VPNs and ad blockers, strict iframe blocking | "The security check could not load. A browser privacy setting, ad blocker or VPN may be blocking it. Turn it off for this site, then press Try again. Your answers are still here." with a **Try again** button that tears the widget down and asks for the script again. Pressing Submit without a token while the check is still working sends nothing and says "Finish the security check above". When the check cannot run at all, the box also shows the office contact and the fallback described in "Blocked-check fallback (#1480)" below. The server still fails closed on an invalid token. A script request held open gives up after 15 seconds. | `components/security-check/security-check.tsx` |
| Analytics beacon | First-party `navigator.sendBeacon("/api/public-metrics")` and web-vitals, from `components/public-metrics-beacon.tsx`. No cookie, no identifier, no third-party script. Off by itself under Global Privacy Control or Do Not Track. | EasyPrivacy-style path rules (`/metrics`, `/beacon`, `/analytics`), Brave, Avast | Nothing. The send is wrapped; a refused `sendBeacon` falls back to `fetch(...).catch(() => undefined)`. The browser may log a blocked request in its network panel; that is not a page error. | `components/public-metrics-beacon.tsx` |
| Google sign-in | A plain link (`/api/attendee/oauth/google/start`) that leaves our site for `accounts.google.com` and comes back. No Google script runs on our pages. | A blocker that refuses `accounts.google.com`, or Google's own page failing | The browser shows its own error page for Google; our page is unchanged and the password, email-code and passkey sign-in beside the button still work. A cancelled or expired Google sign-in returns to our sign-in with a plain message ("You can try again, or use a password."). | `components/attendee-google-button.tsx` |
| Passkeys (WebAuthn) | The device's own prompt through `@simplewebauthn/browser` (bundled with the app, nothing third-party). | A browser or policy without WebAuthn, or a prompt the person closes | Staff sign-in hides the passkey button when WebAuthn is missing (password sign-in stays). The second-step page says "This browser can't use passkeys. Use your authenticator code instead." A closed or failed prompt shows a plain message under the button. | `components/passkey-*.tsx`, `staff-passkey-sign-in-button.tsx` |
| Calendar embed on imsda.org | An `<iframe>` of `/embed/calendar` plus `embed-host.js` (both ours) on another site. The page is server-rendered, uses no cookies, no storage and no script of its own beyond Next's. | Third-party cookie blocking, blocked third-party storage, strict iframe rules on the host site | Works without cookies or storage. If a host blocks the frame itself, the host's own page shows a blank frame (we cannot show text inside a frame that never loads; the host's embed code can carry fallback text). The embed's allowed hosts come from `EMBED_ALLOWED_ORIGINS` (default `imsda.org` and subdomains). | `app/(public)/embed/`, `modules/calendar/widget.ts` |
| Fonts and CDNs | Noto Sans is bundled (`@fontsource/noto-sans`) and served by us. Square's fonts load only inside Square's own card iframe. No Google Fonts, no CDN for scripts or styles. | n/a | Nothing third-party to block on our pages. | `app/layout.tsx` |
| Service worker and offline pieces | There is no service worker and no web manifest. "Offline check-in" is an in-page queue in `localStorage`, not a cache of pages. Live lists are never cached by an app layer. | n/a | n/a | `components/use-offline-check-in-queue.ts` |
| `localStorage`, `sessionStorage` | Convenience only: saved form drafts, collapsed sections, dismissed banners, the sign-in return path, the offline check-in queue, a one-time reload guard. IndexedDB is not used. | Private windows, "block all site data", some embedded frames (the property read itself throws), a full quota | Every page renders and works without storage; the convenience is simply not remembered. All access goes through try/catch (`lib/safe-storage.ts`, or an inline try in the component), and `tests/safe-storage-1445.test.ts` fails when a raw access is added without one. The offline check-in queue says "Browser storage is unavailable. Nothing new can be queued until storage access is restored" instead of losing an action silently. | `lib/safe-storage.ts` |

## Turnstile fallback options (decision made: see the next section)

Today, with Turnstile on, a person whose browser cannot run the check cannot submit. They see the message and can turn
off their blocker, but a person on a locked-down device is stuck. Options, safest first. None is built; none weakens
server verification until Caleb picks one.

1. **Emailed code instead.** If the check cannot load, offer "Email me a code": send a one-time code to the address they
   typed (rate limited per address and per IP), and accept the code in place of the token. Proves control of the inbox;
   works for sign-in, sign-up and password reset where we already mail codes. Does not fit anonymous public registration
   (we would email before the registration exists).
2. **Honeypot plus a stricter rate limit.** When the token is missing because the script could not load (the browser
   says so with a reason header), accept the request only if the hidden `website` field is empty and the per-IP,
   per-address limits are much lower (for example 3 per hour). Weakest, but needs no extra step for the person.
3. **Allow-list.** Skip the check for trusted networks (the conference office's address) or signed-in accounts that
   already passed the check. Does nothing for a new visitor on a blocker.
4. **Staff-assisted.** Show the conference office's phone and email next to the message, and let staff register the
   person (they can already add registrations). No code change; slowest for the person.

Recommendation: 1 for the sign-in pages, 2 for public registration, plus 4's contact line on both. All are human
decisions (they change what the server accepts).

## Blocked-check fallback (#1480)

Caleb approved options 1 and 2 above plus 4's contact line on Nov 1, 2026. "Blocked" means the script failed, timed out or
the widget reported an error, so no token can be produced. It never means the server said a token was invalid.

| Where | What the person sees when blocked | What the server does |
| --- | --- | --- |
| Sign-in (`/login`, `/sign-in`, `/account/sign-in`), sign-up, both password resets | The blocked message, the office contact, and **Email me a code instead**. They press it, get "If that address can use this, we sent a code. It works for 10 minutes.", type the code into **Code from your email**, and press the form's own button. | `POST /api/security-check/email-code` sends a code only when an active account exists (sign-up: always). The form sends it in `x-security-check-code` with no token; `requireTurnstile` checks it for that action and address, spends it, and lets that one request through. A wrong, expired or used code gets the "security_check_failed" answer. |
| Every other public form (registrations, group and general-link registrations, club applications, club form applications, information forms, registration recovery) | The blocked message and the office contact. Submit works. | No token is accepted only under the limits below, and each accepted submission writes a `SECURITY_CHECK_FALLBACK_ACCEPTED` audit entry (action and route only, no personal data). Over the limit: 429, "Too many tries without the security check. Try again in an hour, or contact the conference office." |

An invalid token is always rejected (403), and any code or fallback beside it is ignored.

Limits, in `modules/rate-limit/service.ts`, all per hour:

| Constant | Value | Reason |
| --- | --- | --- |
| `SECURITY_CHECK_FALLBACK_BUDGETS.client` | 3 per source address | A family on a blocking browser can send a registration, a recovery email and an information form. A bot behind one address cannot do more. Venue Wi-Fi shares an address, so this is a real cost there and the office contact is the way out. |
| `SECURITY_CHECK_FALLBACK_BUDGETS.email` | 2 per address typed in the form | A typo is fixed once. A script cannot flood one registration contact. Forms with no email answer are limited per source only. |
| `SECURITY_CHECK_CODE_SEND_BUDGETS` | 10 per source, 5 per address | Each new code retires the last. Charged the same for known and unknown addresses. |

The honeypot runs first: the registration schemas (`website` field), and the new club application, parse before
`requireTurnstile`, so a filled honeypot is refused before the fallback is considered. The club form application,
information form and recovery routes have no honeypot field today; they rely on the limits above.

Codes: six digits, ten minutes, five tries, hashed like the #1410 sign-in code, stored in `SecurityCheckCode` (the address
only as a sha256), minted when the message is delivered. A code is spent by the request that uses it, so a wrong password
after a valid code needs a fresh code. Audit entries (`SECURITY_CHECK_CODE_SENT`, `_VERIFIED`, `_FAILED`) carry the code's id
and the action name, never the address, code or a hash.

## The browser test

`npm run test:privacy-browsers` (`scripts/verify-privacy-browsers.ts`) runs the journeys in Chromium, Firefox and WebKit
in three modes from `scripts/support/privacy-block-lists.ts`:

- control: nothing blocked;
- shields: EasyList/EasyPrivacy-style rules (`squarecdn`, `squareup`, `challenges.cloudflare.com`, Google sign-in,
  `sentry.io`, the analytics beacon and `/metrics`, `/beacon`, `/track`, `/pixel` paths);
- strict: shields plus third-party iframes refused, third-party cookies stripped, and `localStorage`, `sessionStorage`
  and IndexedDB refusing access everywhere.

Journeys: sign-in with the emailed code, club director pages and roster, an event page with analytics blocked, public
registration with a promo code and card (the stored total and the card amount are the server's numbers), the same
registration while the page's own price preview throws (the form says the total is calculated on submit), the calendar
embed on another site, and, when `PRIVACY_TURNSTILE_BASE_URL` points at a second app with Turnstile test keys, the Security
check blocked on sign-in and password reset. Each asserts the page works or shows the fallback message, and that no
uncaught error reached the page. The app under test needs fictitious Square settings and the embed host allowed; see
`.github/workflows/browser-privacy.yml`. The workflow is advisory (like the mobile layout audit).

Square's card form is only offered when the app has Square settings, so the check starts the app with fictitious sandbox
values (`SQUARE_APPLICATION_ID`, `SQUARE_LOCATION_ID`, `SQUARE_ACCESS_TOKEN`, a webhook key and URL). Nothing is ever
charged and no card number is typed.

## Manual spot check in real Brave and Avast (for Caleb)

Do this once before Nov 9 and after any change to the card form or sign-in. Use a test registration on the sandbox or a
free event; do not enter a real card on production.

1. **Brave, standard Shields.** Open the site, click the lion icon, leave Shields up (Standard). Visit an event's
   registration, fill it in, apply a promo code and submit. The confirmation shows the total. Open the private link: the
   Square card form loads, or the red notice "The secure card form could not load" appears with **Try again**.
2. **Brave, aggressive.** Lion icon, Advanced View, set "Trackers & ads blocking" to Aggressive and "Block fingerprinting"
   to Strict. Repeat step 1 and also sign in with an email and password as a club director: the emailed code step must
   appear and accept the code. Open the club roster.
3. **Brave, everything off for the site** (lion icon, switch Shields off). Confirm the Square card form loads and the
   Security check box (if Turnstile is on) shows a green check. This proves the blocker, not the site, caused any failure.
4. **Avast Secure Browser.** Settings, Privacy and security, turn on Anti-Tracking and Ad Blocking. Repeat steps 1 and 2.
   Turn them off for the site (the shield icon in the address bar, "Disable for this site") and confirm step 3.
5. **Block site data.** In Brave or Chrome, Settings, Privacy, Cookies: "Block all cookies" for a quick check on a public
   page (sign-in will not work without first-party cookies, which is expected and not a bug), or "Block third-party
   cookies" and open an imsda.org page that holds the calendar embed: the list still shows.
6. **Firefox strict.** Settings, Privacy and Security, Strict. Repeat step 1.
7. **Safari.** Settings, Privacy, Prevent cross-site tracking on (default). Repeat step 1 on a phone or Mac.

Pass means: every step either works or shows a plain message with a way forward. Fail means a blank gap, a button that
does nothing, a spinner that never ends, or a total that is not what the confirmation shows. Write down the browser, the
setting and the page, and open an issue.

## Rule T2 (for docs/SITE-RULES.md)

| ID | Rule | Guard test | Browser test | Issue |
| --- | --- | --- | --- | --- |
| T2 | Every page and action works in Brave (Shields on, standard and aggressive), Avast Secure Browser, Firefox (strict tracking protection) and Safari (tracking prevention). If a blocker stops something optional (analytics), nothing visible breaks. If it stops something needed (the card form, the Security check, passkeys), the person sees a clear message and another way through, never a silent failure. | `tests/safe-storage-1445.test.ts`, `tests/security-check-blocked-1445.test.ts` | `npm run test:privacy-browsers` (`scripts/verify-privacy-browsers.ts`, `.github/workflows/browser-privacy.yml`) | Caleb, Nov 1 (#1445) |
