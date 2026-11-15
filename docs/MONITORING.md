# Site-down alerts (UptimeRobot, #1789)

If the site goes down or starts answering with errors, staff should hear it
from an alert, not from a registrant. A free outside checker, **UptimeRobot**,
visits the site every 5 minutes from outside the server and emails the people
on call when it fails twice in a row, and again when it is back (Caleb,
November 15, 2026).

This page is the setup and the record. The account itself is set up by a
person (the conference communication director or the conference IT lead); no
part of it lives in this repository, and no password, API key or personal
email address belongs here.

## What is checked

| Monitor | Address | Down when |
| --- | --- | --- |
| Events home page | `https://events.imsda.org/` | no answer, a timeout, or any HTTP status other than 2xx/3xx |
| Events health check | `https://events.imsda.org/api/health` | no answer, a timeout, HTTP 503, or the word `"ok"` is missing |

Both are checked every 5 minutes (the free plan's interval).

**Who is alerted:** the conference communication director and the conference
IT lead, by email. An alert goes out after two failed checks in a row, and a
second email when the site is working again.

## What the alert contains (no attendee data)

The alert email holds only what UptimeRobot itself knows: the monitor's name,
the address, up or down, the time and the reason (for example "Connection
timeout" or "503 Service Unavailable"). UptimeRobot never signs in, so it only
ever sees public pages.

The health check gives an outside caller the short public answer (#1400) and
nothing else:

```json
{"status":"ok","checkedAt":"2026-11-15T06:00:00.000Z","services":{"database":"ok"}}
```

or, with HTTP 503 when the database is down,
`{"status":"degraded","checkedAt":"...","services":{"database":"unavailable"}}`.
No names, registrations, payments, counts or settings. The detailed answer
(release, backups, outbox) is shown only to a caller with a token or a signed-in
system administrator; UptimeRobot is given no token, so it gets the public
answer. `tests/health-route.test.ts` ("health endpoint, public answer")
checks that the public answer has exactly those three fields.

## Setting it up (one time, on the production account)

Done by the conference IT lead or the communication director. Screen names in
UptimeRobot change from time to time; if a button below is named differently,
look for the closest match.

1. **Account.** Sign up at uptimerobot.com with a shared conference mailbox
   that both people can reach (not a personal address), and keep the password
   in the conference password manager. The free plan allows any use, up to 50
   monitors at 5-minute checks.
2. **Alert contacts.** In **Integrations & Team** (older screens: **My
   Settings → Alert Contacts**), add one **E-mail** contact for the
   communication director and one for the IT lead. Each person confirms the
   email UptimeRobot sends them; an unconfirmed contact gets nothing.
3. **Home page monitor.** **New monitor** →
   - Monitor type: **HTTP(s)**
   - Friendly name: `Events home page`
   - URL: `https://events.imsda.org/`
   - Monitoring interval: **5 minutes**
   - Notifications: tick both email contacts.
4. **Health check monitor.** **New monitor** →
   - Monitor type: **Keyword**
   - Friendly name: `Events health check`
   - URL: `https://events.imsda.org/api/health`
   - Keyword: `"status":"ok"`, alert when the keyword **does not exist**
   - Monitoring interval: **5 minutes**
   - Notifications: tick both email contacts.
5. **Two failures before an alert.** For each monitor, in its notification
   settings, set the delay so the alert goes out only once the monitor has been
   down for **two checks** (with 5-minute checks, "notify after 10 minutes" or
   the closest choice). If the free plan does not offer a delay on your
   screen, leave it at the default: UptimeRobot already re-checks a failure
   before it marks a monitor down. Write down which one applies in the record
   below.
6. **Recovery email.** Make sure the "up" (recovery) notification is on for
   both contacts. It is on by default.
7. **Cloudflare.** The site sits behind Cloudflare. If a monitor shows down
   while the site works in a browser, Cloudflare is probably challenging
   UptimeRobot. Follow the skip rule for `/api/health` in
   `docs/CLOUDFLARE-SECURITY-AUDIT-2026-10.md` (finding 1), and add the home
   page path to it if needed. Do not turn off Cloudflare protection.

## Changing who gets the alerts

In UptimeRobot, **Integrations & Team** (older screens: **My Settings → Alert
Contacts**): add the new person's email contact and have them confirm it, then
open each of the two monitors, tick the new contact under notifications and
untick anyone leaving. Delete the old contact afterwards. Update the
"Who is alerted" line above only if the **roles** change; this repository is
public, so no names or email addresses go here.

## Sending one test alert

Do this once after setup, and again after changing the alert list.

1. Open the `Events health check` monitor → **Edit**.
2. Change the URL to an address that does not answer with the keyword, for
   example `https://events.imsda.org/api/health-alert-test` (it returns "not
   found"), and save.
3. Wait for the down email (about 10 minutes with the two-check delay). Both
   people should get it.
4. Change the URL back to `https://events.imsda.org/api/health` and save. Wait
   for the recovery email.
5. Write the date below.

This never touches the server and shows no data to anyone.

## Record

Filled in by the person who set it up. Dates only; no names or addresses.

- UptimeRobot account and both monitors set up: _not yet_
- Two-failure delay: _"notify after 10 minutes" set / free plan default re-check (choose one)_
- Test alert sent and received by both roles: _not yet_
