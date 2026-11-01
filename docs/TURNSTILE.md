# Cloudflare Turnstile "Security check" (#1399)

Public forms and staff and attendee sign-in show a Cloudflare "Security check"
box above the submit button. The server checks the result before it saves
anything or sends any email. Honeypots and rate limits stay as they were.

The check turns on only when **both** keys are set in the environment. Until
then it does nothing, so nobody is locked out while you set it up.

## Turn it on (Caleb)

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Name: `IMSDA Events`.
3. Hostname: `events.imsda.org` (the host of `APP_BASE_URL` in production).
   Add another hostname only if the app is also served from one.
4. Widget mode: **Managed**. Leave **pre-clearance** off.
5. Create it, then copy the **Site key** and the **Secret key**. Never paste
   them into chat, GitHub or a ticket.
6. In the xCloud environment panel set:
   - `TURNSTILE_SITE_KEY` = the Site key
   - `TURNSTILE_SECRET_KEY` = the Secret key
   - `TURNSTILE_ALLOWED_HOSTNAMES` only if the app is served from more than
     one host (comma-separated). Blank means the host of `APP_BASE_URL`.
7. Restart the app (no rebuild is needed; the keys are read at run time).
8. Open **System report** → Setup. The **Security check** row should read
   **OK / Configured**. Then open the sign-in page and a registration form and
   confirm the box shows and a submit works.

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
