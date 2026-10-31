# Cloudflare security audit, October 2026

Audit date: October 31, 2026. This is a read-only audit. No app code,
Cloudflare settings, or server settings were changed.

## Summary for Caleb

The site is in good shape where the code controls things. Logged-in pages and
the API are never cached by Cloudflare. HTTPS is enforced. The browser
security headers are strong. Every webhook (Square, Resend, Amazon SES) checks
a signature. Uploaded files are served safely.

Most of the risk sits in settings outside the code: the Cloudflare dashboard,
the xCloud environment panel and the server firewall. These are the three
things worth doing first:

1. **Make sure Cloudflare can't block payment and email webhooks.**
   Cloudflare's basic **Bot Fight Mode** can show a "checking your browser"
   page to Square, Resend and Amazon. Those services can't pass a check, so a
   payment or a bounce report could go unrecorded. Cloudflare says Bot Fight
   Mode can't be given exceptions. If it's on, turn it off. This is also the
   most likely cause of the check page you've seen
   ([finding 1](#1-high-bot-fight-mode-can-challenge-webhooks-and-cant-be-exempted)).
2. **Confirm the two rate-limit settings in xCloud match the Cloudflare and
   Nginx setup.** If they're wrong, everyone registering at a busy moment can
   look like one visitor and get "too many attempts" errors. Or an attacker
   could get around the limits
   ([finding 2](#2-high-to-verify-rate-limit-client-ip-settings-behind-cloudflare)).
3. **Let only Cloudflare reach the server.** Right now nothing in our
   documentation tells the server to refuse visitors who skip Cloudflare.
   Without that rule, Cloudflare's protection can be bypassed
   ([finding 3](#3-medium-origin-server-is-not-documented-as-locked-to-cloudflare)).

This repository is public, so this report describes what to check and how to
fix it. It does not record the live server's current settings or operational
state. Anything we observed that is sensitive was sent to Caleb privately.

The rest of this report gives each finding with evidence and a fix. Then
comes a checklist of Cloudflare settings and draft code issues for us to
build.

## How this audit was done

- **Guidance:** Cloudflare's published agent skills
  (`github.com/cloudflare/skills`). It covers the main `cloudflare` skill, its
  WAF and Tunnel references, `cloudflare-one` (Access), `turnstile-spin`
  (Turnstile, including the Next.js App Router reference) and `web-perf`.
  These skills mostly point to Cloudflare's developer docs, so we also read
  three of those pages: Bot Fight Mode, JavaScript detections and Turnstile's
  Content Security Policy requirements.
- **Code:** we reviewed this repository: `next.config.ts`, `proxy.ts`, the
  rate-limit module, session cookies, webhook routes, the internal outbox
  sweep route, file serving, `docker-compose.yml`, `deploy/xcloud/` and the
  deploy docs.
- **Live site:** we sent about 25 plain GET requests to public pages on
  `events.imsda.org`. We didn't log in, submit forms or scan. We couldn't see
  the Cloudflare dashboard, the xCloud environment panel, the server firewall
  or the Nginx config. Anything that depends on them is marked **to verify**.

### What the live site showed (good)

| Check | Result |
|---|---|
| HTTP to HTTPS | `http://` returns `301` to `https://` from Cloudflare (Always Use HTTPS is on) |
| TLS | TLS 1.3 at the Cloudflare edge |
| HSTS | `max-age=31536000; includeSubDomains` (from the app) |
| HTML caching | `cf-cache-status: DYNAMIC` and `cache-control: private, no-cache, no-store` on `/`, `/events`, `/sign-in` |
| API caching | `/api/health` returns `cache-control: no-store` and `DYNAMIC` |
| Static files | `/_next/static/...` returns `public, max-age=31536000` and `cf-cache-status: HIT` |
| Framing | CSP `frame-ancestors 'none'` site-wide; `/embed/*` allows only the imsda.org sites |
| Other headers | `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` |

### What the code does well

- Webhooks verify signatures on the raw body. Square uses a timing-safe HMAC
  over the **configured** notification URL, not the request's Host header, so
  Cloudflare and Nginx can't break it (`modules/payments/square-domain.ts:304-324`,
  `modules/payments/square-config-domain.ts:63-72`). Resend uses svix
  (`integrations/email/resend-webhook.ts:40-54`). SES checks the SNS signature,
  topic, account, timestamp and signing-cert host (`integrations/email/ses-sns.ts`).
- The outbox sweep (`/api/internal/outbox/sweep`) needs a bearer token compared
  in constant time and fails closed when the token is unset
  (`modules/communications/outbox-sweep.ts:118-134`). The Compose
  `outbox-sweeper` calls it inside Docker at `http://app:3000`
  (`docker-compose.yml:140-152`). Cloudflare is never in that path.
- Uploaded files are served with `Content-Disposition: attachment` (inline only
  for images), `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`
  and the verified file type (`modules/events/asset-response.ts:39-57`).
- Rate limits are stored in PostgreSQL. They survive restarts and are shared
  between the main and standby containers (`modules/rate-limit/repository.ts:74-104`).
  Public forms also have a honeypot field
  (`modules/forms/public-domain.ts:43`, `modules/club-applications/domain.ts:99`).
- Session cookies are `HttpOnly`, `Secure` in production and `SameSite=Lax`, with
  an 8-hour maximum and a 1-hour idle timeout for staff. The flags are set at
  `app/api/auth/login/route.ts:116-124`; the lifetimes are in
  `modules/access/session-store.ts:6-16`.

## Findings, ranked by risk

Key: **Dashboard** means Caleb changes a setting in Cloudflare, xCloud or the
server. **Code** means we build it.

### 1. High: Bot Fight Mode can challenge webhooks and can't be exempted

- **What:** Three services post to the site without a browser: Square
  (`/api/webhooks/square`), Resend (`/api/webhooks/resend`) and Amazon SNS for
  SES (`/api/webhooks/ses`). Apple also fetches the Apple Pay domain file
  (`/.well-known/apple-developer-merchantid-domain-association`). An external
  uptime monitor reading `/api/health`, as `docs/DEPLOY-DOCKER.md` recommends,
  is in the same position. If Cloudflare challenges any of them, they get an
  HTML check page instead of the app. The webhook is then lost or retried
  until the sender gives up.
- **Evidence:**
  - Cloudflare's Bot Fight Mode docs: "You cannot bypass or skip Bot Fight
    Mode using WAF custom rules or Page Rules." They also say it "may challenge
    API or mobile app traffic". Exceptions need Super Bot Fight Mode (Pro plan
    or higher), which supports Skip rules.
  - The webhook routes have no fallback for being blocked before the app sees
    them (`app/api/webhooks/square/route.ts:28-97`).
  - The Bot Fight Mode setting itself couldn't be seen from outside. This is
    **to verify**.
- **Why it matters:** a challenged Square webhook means a payment or refund
  isn't recorded automatically. A challenged SES or Resend webhook means
  bounces and complaints are missed. Bot Fight Mode is also the likeliest
  source of the check page seen on the site (see
  [Cloudflare check page](#the-cloudflare-check-page-likely-causes)).
- **Fix (Dashboard):**
  1. Cloudflare dashboard → select `imsda.org` → **Security** → **Settings**.
     Filter by **Bot traffic**. If **Bot Fight Mode** is on, turn it **off**.
  2. If the zone is on Pro or higher and you want bot protection, use **Super
     Bot Fight Mode** instead. Add a WAF custom rule that **skips** it for the
     webhook paths (step 3).
  3. **Security → Security rules → Create rule → Custom rule.** Name it
     "Allow webhooks and health". Expression:
     `starts_with(http.request.uri.path, "/api/webhooks/") or http.request.uri.path eq "/api/health" or http.request.uri.path eq "/.well-known/apple-developer-merchantid-domain-association"`.
     Action **Skip**. Tick all remaining custom rules, rate limiting rules,
     managed rules, Super Bot Fight Mode (if shown), Browser Integrity Check
     and Security Level. Place it **first**. The app still checks every webhook
     signature, so this exception is safe.

### 2. High (to verify): rate-limit client IP settings behind Cloudflare

- **What:** The app finds each visitor's IP from the
  `RATE_LIMIT_CLIENT_IP_HEADER` and `RATE_LIMIT_TRUSTED_PROXY_HOPS` settings.
  With Cloudflare **and** xCloud's Nginx in front, there are two hops. The
  right values are either:
  - `x-forwarded-for` with hops `2`; or
  - `cf-connecting-ip` with hops `1`.

  `docker-compose.yml:56-57` defaults to `x-forwarded-for` with hops `1`,
  which is correct only without Cloudflare.
- **Evidence:**
  - `modules/rate-limit/domain.ts:115-130` takes entry `length - hops` from
    `X-Forwarded-For`.
  - The documented options are at `docs/DEPLOY-DOCKER.md:132-133`.
  - The production values couldn't be seen. This is **to verify**.
  - The same risk was raised before go-live in `docs/WR26-GO-LIVE-REVIEW.md:47-103`.
  - `x-forwarded-for` with hops `2` works only if Nginx appends to the header
    (`$proxy_add_x_forwarded_for`). If Nginx replaces it, there is a single
    entry, the lookup returns nothing (`domain.ts:126-128`) and everyone
    shares one bucket. That's why this report prefers `cf-connecting-ip`.
- **Why it matters:**
  - With hops `1` behind Cloudflare, the "client" becomes a Cloudflare server.
    Many real people share one Cloudflare server, so a busy registration
    opening can lock out real families. For example, public registration
    allows 30 per 15 minutes per client (`modules/rate-limit/service.ts:495-520`).
  - With hops `0` or unset, every visitor shares one bucket
    (`modules/rate-limit/domain.ts:181-189`).
  - With too many hops, an attacker can forge the IP.
- **Fix (Dashboard, xCloud environment panel):** set
  `RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip` and
  `RATE_LIMIT_TRUSTED_PROXY_HOPS=1`. This is the simplest correct pair behind
  Cloudflare, and it's only safe once [finding 3](#3-medium-origin-server-is-not-documented-as-locked-to-cloudflare)
  is done. Then redeploy and run the two-network test in
  `docs/WR26-GO-LIVE-REVIEW.md` (finding F1, step 3).
- **Fix (Code):** add a way for a system admin to see which IP the app
  resolved for their own request (draft issue A). The setting can then be
  checked without guesswork.

### 3. Medium: origin server is not documented as locked to Cloudflare

- **What:** Nothing in `docs/SERVER-SECURITY-CHECKLIST.md` or
  `docs/DEPLOY-DOCKER.md` says the server should accept web traffic only from
  Cloudflare. The app container is bound to `127.0.0.1`
  (`deploy/xcloud/docker-compose.yml:21`), so Nginx is the public entry point
  on ports 80 and 443. Whether Nginx accepts traffic that doesn't come through
  Cloudflare is **to verify**.
- **Evidence:** the server firewall couldn't be seen. No
  Cloudflare IP allowlist, Authenticated Origin Pulls or Cloudflare Tunnel
  setup appears in the repo or docs.
- **Why it matters:** anyone who learns the server's address can skip
  Cloudflare's WAF, bot and rate-limit rules. They can also set
  `CF-Connecting-IP` or `X-Forwarded-For` to any value, which defeats the
  app's per-IP limits from finding 2.
- **Fix (Dashboard and server):** pick one.
  - **Firewall allowlist.** In the server firewall (or xCloud's firewall
    screen), allow ports 80 and 443 only from Cloudflare's published ranges
    (`https://www.cloudflare.com/ips/`). Keep SSH as it is. Recheck the list
    occasionally, because Cloudflare's ranges change.
  - **Authenticated Origin Pulls.** Cloudflare dashboard → **SSL/TLS → Origin
    Server → Authenticated Origin Pulls** → on. Then Nginx must require
    Cloudflare's client certificate. That needs xCloud support to add the
    Nginx lines.
  - **Cloudflare Tunnel.** This is the strongest option, but the biggest
    change. It needs a `cloudflared` connector on the server and no public
    80 or 443 at all.
- **Fix (Code, docs only):** add the chosen method to
  `docs/SERVER-SECURITY-CHECKLIST.md` (draft issue B).

### 4. Medium: no Turnstile or CAPTCHA on public forms and sign-in

- **What:** Public forms and sign-in rely on honeypots and database rate
  limits only. Examples: public registration, group and general registration,
  club applications, registration recovery, information forms, attendee
  sign-up, password reset requests and staff sign-in.
- **Evidence:** there are no `turnstile`, `captcha`, `hcaptcha` or `recaptcha`
  references in the code. The honeypots are at `modules/forms/public-domain.ts:43`
  and `modules/club-applications/domain.ts:99`.
- **Why it matters:** honeypots stop simple bots only. Rate limits slow
  attacks but also depend on finding 2 being right. Turnstile is Cloudflare's
  no-puzzle check, and it's free. It stops automated sign-ups, password
  guessing and form spam without a challenge page for real people.
- **Fix (Code):** add Turnstile in managed mode with server-side Siteverify,
  following Cloudflare's `turnstile-spin` skill (draft issue C). The CSP must
  add `https://challenges.cloudflare.com` to `script-src` and `frame-src`
  (Cloudflare's Turnstile CSP page).
- **Fix (Dashboard):** Cloudflare dashboard → **Turnstile** → **Add widget**.
  Use the hostname `events.imsda.org` and **Managed** mode. Put the site key
  and secret key in the xCloud environment panel when the code issue is ready.
  Never paste them into chat or GitHub.

### 5. Medium: public health page reveals operational detail

- **What:** `GET /api/health` is public. It returns the release commit,
  backup state, outbox counts (including the failed count) and sweep failure
  times.
- **Evidence:** `app/api/health/route.ts:20-112`. The live page returns these
  fields.
- **Why it matters:** none of this is secret, but it tells an outsider which
  build is running and when operations are weak (for example, a stale backup
  or a stopped sweeper).
- **Fix (Code):** keep a minimal public answer (`status` and the database
  check). Move the detail behind the existing bearer token or a system-admin
  session (draft issue D).

### 6. Medium: CSP allows inline scripts

- **What:** `script-src` includes `'unsafe-inline'` and has no nonce.
- **Evidence:** `next.config.ts:37-51`. The live header matches.
- **Why it matters:** if any page ever renders attacker-controlled HTML,
  inline scripts would run. Cloudflare's JavaScript detections page also
  recommends nonces over `'unsafe-inline'`. It notes Cloudflare adds the nonce
  to its own injected script when the nonce is in the CSP **header**, not a
  `<meta>` tag.
- **Fix (Code):** use a per-request nonce set in `proxy.ts` (Next.js 16
  supports this), and drop `'unsafe-inline'` from `script-src`. Nonces need
  dynamic rendering. Workspace pages already are dynamic
  (`app/(workspace)/layout.tsx:8`), but not every public page is, so the
  issue must cover that. Test Square's payment form carefully (draft
  issue E).

### 7. Low: Nginx adds a conflicting `X-Frame-Options` and legacy headers

- **What:** live responses include headers the app doesn't set:
  - `x-frame-options: SAMEORIGIN`, on `/embed/calendar` too;
  - `x-xss-protection: 1; mode=block`;
  - a second `x-content-type-options: nosniff`.
- **Evidence:**
  - Live headers on `/`, `/events` and `/embed/calendar`.
  - `next.config.ts` sets no `X-Frame-Options`.
  - `docs/DEPLOY-DOCKER.md` says the embed "does not send a conflicting
    `X-Frame-Options: SAMEORIGIN` header", but the server does.
- **Why it matters:** modern browsers follow the CSP `frame-ancestors` rule
  and ignore `X-Frame-Options` when both are present. Older browsers, and
  some in-app browsers, may still refuse to show the calendar embedded on
  imsda.org. `X-XSS-Protection` is obsolete.
- **Fix (Dashboard, xCloud):** ask xCloud support to remove the
  `X-Frame-Options`, `X-XSS-Protection` and extra `X-Content-Type-Options`
  lines from this site's Nginx config.
- **Fix (Cloudflare, if xCloud can't):** Cloudflare dashboard → **Rules →
  Overview → Create rule → Response Header Transform Rule**.
  - Name it "Remove legacy headers".
  - Apply it to all incoming requests.
  - **Remove** `X-Frame-Options` and `X-XSS-Protection`.
  - The app's CSP already covers framing.

### 8. Low: `X-Powered-By: Next.js` is sent

- **What:** responses announce the framework.
- **Evidence:** live header `x-powered-by: Next.js`. `next.config.ts` doesn't
  set `poweredByHeader: false`.
- **Why it matters:** it gives attackers a small hint. It's cheap to remove.
- **Fix (Code):** add `poweredByHeader: false` to `next.config.ts` (part of
  draft issue E). Or add `X-Powered-By` to the Cloudflare Transform Rule in
  finding 7.

### 9. Low: Cloudflare Browser Cache TTL appears to override origin headers

- **What:** `/robots.txt` and `/favicon.ico` come back as
  `cache-control: public, max-age=14400` with `cf-cache-status: BYPASS`. Four
  hours (14400 seconds) is the value Cloudflare's Browser Cache TTL setting
  writes. This is an inference; the setting itself couldn't be seen.
- **Why it matters:** HTML and API responses still send `no-store` and look
  correct. But a zone-wide browser cache override can make browsers hold
  stale copies of public files after a deploy, and it can hide caching
  mistakes later.
- **Fix (Dashboard):** Cloudflare dashboard → **Caching → Configuration →
  Browser Cache TTL** → **Respect Existing Headers**.

### 10. Low: session cookies don't use the `__Host-` prefix

- **What:** cookies are named `imsda_session` and `imsda_attendee_session`.
- **Evidence:** `modules/access/session-store.ts:6` and
  `modules/attendee-accounts/session-store.ts:16`. The flags are already
  strong.
- **Why it matters:** the `__Host-` prefix makes the browser enforce
  `Secure`, `Path=/` and no `Domain`. Another `*.imsda.org` site (such as the
  WordPress site) then can't plant or overwrite these cookies.
- **Fix (Code):** rename to `__Host-imsda_session` and
  `__Host-imsda_attendee_session` in production, with a one-time fallback read
  so nobody is signed out (draft issue F).

## The Cloudflare check page: likely causes

Without the dashboard we can't confirm the cause. In order of likelihood:

1. **Bot Fight Mode.** It challenges traffic Cloudflare scores as automated
   and can't be exempted (finding 1). People on VPNs, iCloud Private Relay,
   church or school networks, and in-app browsers (Facebook, Messenger) are
   often caught.
2. **Security Level** set to High, or **"I'm Under Attack" mode** left on.
   Either puts a check page in front of many real visitors.
3. **A custom rule with "Managed Challenge"**, for example by country or by
   path.
4. **Browser Integrity Check**, which blocks requests with missing or unusual
   browser headers.

A check page inside the **imsda.org calendar embed** is especially likely to
fail, because browsers limit cookies in cross-site frames.

**How to find it (Dashboard):** Cloudflare dashboard → `imsda.org` →
**Security → Analytics** (or **Events**). Filter **Action** to *Managed
Challenge*, *JS Challenge* and *Challenge*, and **Host** to
`events.imsda.org`. Then look at the **Service** column: Bot Fight Mode,
Security Level, Custom rules or Browser Integrity Check. Also check whether
any `/api/webhooks/` paths appear. That tells us exactly which setting to
change.

## Recommended Cloudflare settings for events.imsda.org

Check each item in the Cloudflare dashboard for the `imsda.org` zone.
"Already OK" means the live site already showed it working.

| Area | Setting | Where | Notes |
|---|---|---|---|
| SSL/TLS | Encryption mode **Full (strict)** | SSL/TLS → Overview | Never "Flexible". The origin needs a valid certificate (xCloud's Let's Encrypt or a Cloudflare Origin Certificate). Couldn't be seen from outside. |
| SSL/TLS | **Always Use HTTPS** on | SSL/TLS → Edge Certificates | Already OK (301 seen). |
| SSL/TLS | **Minimum TLS Version 1.2**, TLS 1.3 on | SSL/TLS → Edge Certificates | TLS 1.3 already OK. |
| HSTS | Leave Cloudflare's HSTS **off** | SSL/TLS → Edge Certificates | The app already sends one-year HSTS. Two sources is harder to manage. Don't turn on `preload` unless every `imsda.org` subdomain is HTTPS-only. |
| Origin | Allow only Cloudflare to reach ports 80 and 443 | Server firewall or Authenticated Origin Pulls | Finding 3. |
| WAF managed rules | **Cloudflare Free Managed Ruleset** on (default) | Security → Security rules | On Pro or higher, enable the Cloudflare Managed Ruleset. Run the **OWASP Core Ruleset** in **Log** mode first: staff send HTML email from the communications composer, which OWASP XSS rules can block. |
| Custom rule 1 | **Skip** for `/api/webhooks/*`, `/api/health` and the Apple Pay file | Security → Security rules | Finding 1. Place it first. |
| Custom rule 2 | **Block** `starts_with(http.request.uri.path, "/api/internal/")` | Security → Security rules | Only the in-server sweeper calls these, at `http://app:3000`, never through Cloudflare. If a host cron is ever used, point it at the internal address, not the public domain. |
| Rate limiting rule | One coarse flood guard on sign-in | Security → Security rules → Rate limiting | Match the path only: `http.request.uri.path in {"/api/auth/login" "/api/sign-in" "/api/attendee/sign-in"}`. The Free plan can't match on method. Count per IP; for example, block for 10 seconds above 20 requests in 10 seconds (the Free plan allows one rule and a 10-second period). Keep it generous: many people at camp share one Wi-Fi. The app has its own detailed limits. |
| Bots | **Bot Fight Mode off** | Security → Settings → Bot traffic | Finding 1. On Pro or higher, use Super Bot Fight Mode with "Definitely automated: Managed Challenge" and the skip rule above. |
| Security Level | **Essentially Off** or **Low**; "I'm Under Attack" **off** unless under attack | Security → Settings | Cuts false check pages. Turnstile on forms (finding 4) is the better tool. |
| Browser Integrity Check | On is fine | Security → Settings | Skipped for webhooks by custom rule 1. |
| Cache | Don't create any **Cache Everything** rule for HTML | Caching → Cache Rules | Already OK: HTML returns `DYNAMIC`. |
| Cache | Cache rule "**Bypass cache**" for everything on `events.imsda.org` **except** `/_next/static/*` | Caching → Cache Rules | Defense in depth. The app already sends `no-store` on private pages. Bypassing by default protects every private path (there are many: see the matcher in `proxy.ts:21-43`) against a later zone-wide setting caching private data. Expression: `http.host eq "events.imsda.org" and not starts_with(http.request.uri.path, "/_next/static/")`. |
| Cache | **Browser Cache TTL: Respect Existing Headers** | Caching → Configuration | Finding 9. |
| Transform rule | Remove `X-Frame-Options`, `X-XSS-Protection`, `X-Powered-By` | Rules → Transform Rules | Findings 7 and 8, if not fixed at Nginx or in code. |
| Access (Zero Trust) | Use only for a **staging or standby hostname**, if one is public | Zero Trust → Access → Applications → Self-hosted | Don't put Access in front of staff pages on `events.imsda.org`: check-in volunteers sign in on their phones, and the app has its own sign-in and MFA. Never put Access on `/api/webhooks/*`. |
| Turnstile | Create a **Managed** widget for `events.imsda.org` | Turnstile | Finding 4. Store keys in xCloud only. |
| Monitoring | Review **Security → Analytics** weekly during registration windows | Security → Analytics | Watch for challenges on real users or webhooks. |

## Draft code issues (not created)

### A. Show system admins the client IP the app resolved

- **Goal:** let a system admin confirm the rate-limit IP settings behind
  Cloudflare without guessing.
- **Acceptance criteria:**
  1. The System command center shows, to system admins only, "Your connection
     as the app sees it": the resolved IP (or "not resolved"), the configured
     header name and the hop count.
  2. A warning appears when the resolved IP falls in Cloudflare's published
     ranges, or when production has hops `0`.
  3. No other user's IP is shown. Nothing is logged.
  4. Tests cover hops `0`, `1` and `2` with `x-forwarded-for`, and
     `cf-connecting-ip`.

### B. Document locking the origin to Cloudflare

- **Goal:** the server security checklist covers Cloudflare.
- **Acceptance criteria:**
  1. Add a "Behind Cloudflare" section to `docs/SERVER-SECURITY-CHECKLIST.md`:
     - firewall allowlist or Authenticated Origin Pulls;
     - SSL Full (strict);
     - rate-limit header and hops values.
  2. Fix `docs/DEPLOY-DOCKER.md:132-133` so the comments name one recommended
     pair (`cf-connecting-ip` with hops `1`) and say it requires the origin
     lock.
  3. Correct the `X-Frame-Options` statement about the embed (finding 7).
  4. Link this audit.

### C. Add Cloudflare Turnstile to public forms and sign-in

- **Goal:** stop automated form spam and password guessing without challenge
  pages.
- **Acceptance criteria:**
  1. A Turnstile widget (managed mode, explicit render) on these forms:
     - staff sign-in;
     - attendee sign-in and sign-up;
     - forgot password (staff and attendee);
     - public registration, including general and group;
     - club application;
     - registration recovery;
     - information forms.
  2. Each POST handler calls Siteverify server-side. It requires
     `success === true`, the expected `action` and an allowed hostname, and
     fails closed on an error.
  3. The secret is read from the environment only (`TURNSTILE_SECRET_KEY`).
     When unset outside production, Turnstile is skipped.
  4. CSP adds `https://challenges.cloudflare.com` to `script-src` and
     `frame-src`. If issue E's nonce CSP lands first, the Turnstile script
     tag must carry the nonce, because `'strict-dynamic'` ignores host
     allowlists.
  5. Honeypots and rate limits stay.
  6. Accessible: the widget has a label, errors are announced, and tap
     targets are at least 44px.
  7. Tests mock Siteverify for success, failure, wrong action, wrong hostname
     and timeout.
  8. Out of scope: in-person check-in station screens and token-link pages
     that already need a secret link.

### D. Trim the public health response

- **Goal:** the public health page says only whether the site is up.
- **Acceptance criteria:**
  1. An unauthenticated `GET /api/health` returns `status`, `checkedAt` and the
     database check only.
  2. The full detail (release, backups, outbox, sweep, encryption key source)
     is returned only with the `OUTBOX_SWEEP_TOKEN` bearer token or a
     dedicated monitor token, or to a system-admin session.
  3. The Compose healthcheck and `docs/DEPLOY-DOCKER.md` uptime-monitor
     guidance are updated.
  4. Route tests cover public and authorized responses.

### E. Nonce-based CSP and header cleanup

- **Goal:** remove `'unsafe-inline'` from `script-src`.
- **Acceptance criteria:**
  1. `proxy.ts` generates a per-request nonce and sends the CSP in the
     response header (not `<meta>`). Its matcher widens to all pages, using
     the pattern in Next.js's CSP guide; today it covers only workspace and
     account paths.
  2. `script-src` uses `'nonce-…' 'strict-dynamic'` without `'unsafe-inline'`.
     Every first-party and Square script tag carries the nonce, because
     `'strict-dynamic'` ignores host allowlists.
  3. Every page that receives the nonce CSP renders dynamically. Static or
     ISR pages are either made dynamic or keep the current CSP.
  4. The CSP header rules move out of `next.config.ts`, or are kept only for
     paths the proxy doesn't cover, so no response gets two CSP headers.
  5. Per-path differences keep working: `/clubs`, the organization location
     page, `/events/:eventSlug` and `/embed/*`.
  6. `poweredByHeader: false`.
  7. Square card, Apple Pay and Google Pay flows, the registration builder and
     the embed still work. Verify on sandbox.
  8. Tests assert the header shape.

### F. `__Host-` prefix for session cookies

- **Goal:** other `imsda.org` subdomains can't set or replace our session
  cookies.
- **Acceptance criteria:**
  1. In production, the staff and attendee session cookies are written as
     `__Host-imsda_session` and `__Host-imsda_attendee_session`.
  2. For one release, the old names are still read and are cleared on the
     next response.
  3. All set and clear paths use one helper, covering:
     - login;
     - MFA;
     - passkeys;
     - logout;
     - switching between staff and attendee.
  4. Tests cover the new name, the fallback and logout clearing both.
