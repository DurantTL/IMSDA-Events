# Cloudflare Turnstile "Security check" (#1399)

Public forms and staff and attendee sign-in show a Cloudflare "Security check"
box above the submit button. The server checks the result before it saves
anything or sends any email. Honeypots and rate limits stay as they were.

The check turns on only when **both** keys are set in the environment. Until
then it does nothing, so nobody is locked out while you set it up.

## Turn it on (Caleb)

The click-by-click steps (Cloudflare Turnstile widget, then the xCloud
settings) live in one place: the `turnstile` entry in
`modules/setup-help/system-setup-steps.ts`. The same steps show in the app, on
**System report** → Security and setup, under the **Security check** row's
**How to set this up** panel, so they are not repeated here.

The settings are `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and, only when
the app is served from more than one host, `TURNSTILE_ALLOWED_HOSTNAMES`. Blank
hostnames means the host of `APP_BASE_URL`.

## What is covered

Staff sign-in (the password step, not the second-step code), attendee sign-in
and sign-up, staff and attendee forgot password, public registration (single,
group and general link, on the "Review and submit" step), club applications,
registration recovery and information forms.

Not covered, on purpose: passkey sign-in, Google sign-in, check-in station,
private-link pages (`/manage/...`, health records, club-form and staff
invitation links).

## What people see

A "Security check" box. If they press Submit before it finishes, they see
"Finish the security check above, then press Submit again. Your answers are
still here." If it fails, they see "The security check didn't go through. Press
Try again in the box. If it keeps failing, turn off a VPN or ad blocker, or
contact the conference office."

## If it causes trouble: roll back

Remove `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in xCloud and restart.
The check is skipped and forms work as before. In production this "fails open"
on purpose, and the System report shows **Security check not configured**
as a warning until the keys are back. If only one key is set, the check is
also skipped and the report names the missing one.

While both keys are set, a failed, missing, expired, wrong-form or
wrong-hostname check is refused, and so is a Cloudflare outage (it fails
closed). Roll back as above if Cloudflare is down and people must register.

## Staging and local testing

Cloudflare publishes test keys that always pass or always fail (search for
"Turnstile testing" in Cloudflare's docs). With the always-passes pair, set
`TURNSTILE_ALLOWED_HOSTNAMES=localhost` (or the staging host). Test keys do
not return the real hostname or action, so use a real widget on a staging host
to prove the hostname and action checks. Without keys, local development skips
the check.

## How it works (for developers)

- Server: `modules/security/turnstile.ts` (`requireTurnstile`), adapter
  `integrations/turnstile/siteverify.ts`. The token travels in the
  `x-turnstile-token` header. Each form has an expected action name
  (`TURNSTILE_ACTIONS`), and the hostname must be allowed.
- Client: one component, `components/security-check/security-check.tsx`. A
  server page passes `securityCheckConfigForPage()` (site key and CSP nonce) as
  a prop; there is no `NEXT_PUBLIC_` variable.
- CSP: `https://challenges.cloudflare.com` is in `script-src` and `frame-src`;
  the script tag carries the nonce.
