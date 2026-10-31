# Deploying with Docker (xCloud "Deploy Any App From Git" and similar)

The repository ships a production `Dockerfile` and a `docker-compose.yml` that runs
the whole stack — the Next.js app, its PostgreSQL database, a scheduled outbox
sweeper, and a nightly backup job — with one command:

```bash
docker compose up -d --build
```

What happens on `docker compose up`:

1. **postgres** starts (PostgreSQL 16) and becomes healthy.
2. **app** builds from the `Dockerfile`, waits for postgres to be healthy, then its
   entrypoint runs `prisma migrate deploy` and then `npm run club-forms:sync` (club
   form templates, #610) before starting `next start` on port 3000.
   The app validates its whole environment before accepting a request and **refuses
   to start** if anything required is missing — see [Environment variables](#environment-variables-set-these-in-the-xcloud-env-panel).
   The image build skips Next's TypeScript check, which needs more memory than the
   4 GB production server has (pass `--build-arg NEXT_SKIP_BUILD_TYPECHECK=0` on a
   bigger host to keep it). GitHub CI type-checks every commit, so **deploy only
   commits whose CI is green**: a finished image build no longer proves the code
   type-checks.
3. **outbox-sweeper** retries queued email that failed a first delivery attempt, and
   sends the daily location waitlist digest each morning at 7:00 Central
   (see [LOCATION-WAITLISTS.md](LOCATION-WAITLISTS.md)). With
   `HEALTH_RECORDS_ENABLED` on, the same sweep also seals the event-start health
   copies. It runs the daily deletion of expired sealed copies (never one under a
   legal hold) whether the flag is on or off, so switching the feature off never
   extends retention; with it off only the sealing stops (ADR 0005 Addendum B, #924).
   System administrators can still place and lift legal holds with the flag off.
4. **backup** takes a nightly `pg_dump`, archives uploaded event files, and
   periodically rehearses a database restore.

The reverse proxy (xCloud's Nginx) forwards your domain to the app's published port.

## Why the port collision can't happen here (the "port is already allocated" error)

Postgres is reached by the app **internally** as host `postgres`, so `docker-compose.yml`
publishes **no host port for the database at all**. That means it can never collide with
another Postgres already using `5432` on the host (a common shared-server situation).
Local development, which needs host access to the database, layers in
`docker-compose.dev.yml` to publish `5432` — deploy hosts never load that file.

The **app** publishes a web port for the reverse proxy, `3100` by default. If that is
already taken on the host, set `APP_PORT` to a free port and point the proxy at that.

## Environment variables (set these in the xCloud env panel)

Use `KEY=value` lines in the deployment environment. Do not commit the
production values to this repository.

**Required for production** — the app will not start without all of these:

```
APP_BASE_URL=https://your-final-domain
POSTGRES_PASSWORD=<openssl rand -hex 32>
MANAGE_LINK_DERIVATION_SECRET=<openssl rand -base64 48>
ATTENDEE_PASS_SIGNING_SECRET=<openssl rand -base64 48>
RATE_LIMIT_HASH_SECRET=<openssl rand -base64 48>
OUTBOX_SWEEP_TOKEN=<openssl rand -base64 48>
HOST_JOB_HEARTBEAT_TOKEN=<openssl rand -base64 48>   # optional, see "System report heartbeats"
HEALTH_MONITOR_TOKEN=<openssl rand -base64 48>       # optional, see "Uptime monitor" under Alerting
SECRET_ENCRYPTION_KEY=<openssl rand -base64 48>
RESEND_API_KEY=<from the Resend dashboard>
ACCOUNT_EMAIL_SENDER_ADDRESS=<a verified sender, e.g. no-reply@imsda.org>
```

**Church map locations (optional, off by default)** — `GEOCODING_ENABLED=true`
lets a system administrator click "Find map locations" on the organization
directory. That sends each church's public street address, city, state and ZIP
to the U.S. Census Bureau geocoder, so **the production server needs outbound
HTTPS (port 443) to `geocoding.geo.census.gov`**. No API key is needed. With
the flag unset or `false` nothing is ever sent. If the host cannot be reached
the step reports an error and changes nothing. Leave `GEOCODING_PROVIDER`
unset in production (`fake` is an offline stand-in for local work only). See
[ADR 0014](decisions/0014-church-geocoding.md).

On the production server `SECRET_ENCRYPTION_KEY` does **not** go in this env
file: it is loaded from a root-only file with `SECRET_ENCRYPTION_KEY_FILE`
instead (see "Loading the encryption key from a protected file" below). The plain
variable stays supported for development and for a server that has not moved yet,
but setting both is a startup error.

Each secret needs at least 32 characters. If one is missing or malformed the
container exits at startup with the offending variable named in its log, rather
than serving pages and failing later on a QR pass or a private link. A variable
that is absent from the panel altogether stops `docker compose up` before it
builds, naming the variable in the deploy output.

> **Upgrading an existing deployment:** the required list has grown.
> `OUTBOX_SWEEP_TOKEN` arrived with the scheduled outbox sweeper,
> `SECRET_ENCRYPTION_KEY` with two-factor authentication, and `RESEND_API_KEY`
> with `ACCOUNT_EMAIL_SENDER_ADDRESS` when account email became the only way an
> invited colleague receives a link. A deployment that predates any of them must
> add it before its next deploy, or the app container will refuse to start.
> `HOST_JOB_HEARTBEAT_TOKEN` (System report heartbeats) is optional and never
> blocks a start.

`SECRET_ENCRYPTION_KEY` seals the TOTP secrets behind two-factor
authentication and every club roster birth date (ADR 0005 Addendum A).
**Changing it makes every enrolled authenticator unreadable and loses every
roster birth date for good.** Never change it without the re-seal procedure and
the key backup in `docs/SERVER-SECURITY-CHECKLIST.md` (items 2, 3, 9, and 11).

The last two are what send activation and password-reset email. They are
required rather than optional because there is no manual substitute at scale: an
invited colleague who never receives a link cannot obtain a credential at all.
The address must be verified with the active provider (Resend, or the SES
domain; see "Sending email through Amazon SES" below), or every account email
fails at the provider. `ACCOUNT_EMAIL_SENDER_NAME` defaults to `IMSDA Events`, and
`ACCOUNT_EMAIL_REPLY_TO` is optional.

`NODE_ENV` and `DATABASE_URL` are set by `docker-compose.yml` — you do **not**
provide `DATABASE_URL` here.

`APP_RELEASE_SHA` is operational metadata, not a secret. When supplied, it must
be a 7–64 character hexadecimal Git SHA. `/api/health` returns it together with
the immutable Next.js build ID so an operator can verify what is actually
running. Only a caller with the `OUTBOX_SWEEP_TOKEN` or `HEALTH_MONITOR_TOKEN`
bearer token, or a signed-in system administrator, sees it; the public answer is
just `status`, `checkedAt` and the database check. The `curl` examples below that
read the release take the token from the running container and give it to curl on
standard input, so it never appears on a command line:

```bash
T="$(docker exec xcloud-site-239298-app-1 printenv OUTBOX_SWEEP_TOKEN)"; printf 'Authorization: Bearer %s\n' "$T" | curl -s -H @- http://127.0.0.1:8100/api/health
```

A missing or wrong token is not an error: the answer is just the public one.
The xCloud repair script copies `XCLOUD_DEPLOYED_COMMIT` into
`APP_RELEASE_SHA` when xCloud exposes that value.

**Optional / conditional:**

```
APP_PORT=3100                    # only if host 3100 is already in use
APP_RELEASE_SHA=                 # optional 7–64 character Git SHA; see release health below
ALERT_WEBHOOK_URL=               # Slack/Teams incoming webhook; see Alerting below
ALERT_REPEAT_MINUTES=60          # how long the same condition stays quiet after paging
PASSWORD_BREACH_CHECK=           # enabled/disabled; unset means on in production
MESSAGE_FILE_EVENT_QUOTA_MB=     # most one event may keep as message files; default 200
MESSAGE_FILE_SWEEP_GRACE_HOURS=  # age before an unused message file may be swept; default 72, minimum 24
MESSAGE_FILE_SWEEP_DELETE=       # "true" lets the scheduled sweep delete; anything else only reports
ACCOUNT_EMAIL_SENDER_NAME=IMSDA Events
ACCOUNT_EMAIL_REPLY_TO=
RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip  # behind Cloudflare; needs the origin lock (see below)
RATE_LIMIT_TRUSTED_PROXY_HOPS=1  # must be 1 with cf-connecting-ip
OUTBOX_SWEEP_INTERVAL_SECONDS=300  # also read by the app for the broadcast dialog's time estimate
BACKUP_RETENTION_DAYS=14
BACKUP_VERIFY_EVERY=7            # rehearse a restore every Nth backup
BACKUP_OFFSITE_COMMAND=          # receives each database/asset backup path as $1
GOOGLE_OAUTH_CLIENT_ID=          # set both Google values or leave both blank
GOOGLE_OAUTH_CLIENT_SECRET=
EMBED_ALLOWED_ORIGINS='self' https://imsda.org https://*.imsda.org
```

**Rate limits behind Cloudflare.** Use the pair shown above:
`RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip` with
`RATE_LIMIT_TRUSTED_PROXY_HOPS=1`. The app then reads each visitor's address
from the header Cloudflare sets. This pair is only safe once the server accepts
web traffic from Cloudflare alone, because anyone who reaches the server
directly can write any address into that header. Lock the origin first:
"Behind Cloudflare" in `docs/SERVER-SECURITY-CHECKLIST.md`. The compose default
(`x-forwarded-for` with hops `1`, used when both are left unset) is right only
for a server with no Cloudflare in front. With `cf-connecting-ip`, hops `0`
puts every visitor in one shared limit and hops `2` or more stops the app from
starting. Background: findings 2 and 3 in
`docs/CLOUDFLARE-SECURITY-AUDIT-2026-10.md`.

Add each approved church website origin to `EMBED_ALLOWED_ORIGINS`; do not use
a bare `*`. The embed response uses this value for CSP `frame-ancestors`. The
app itself sends no `X-Frame-Options` header, but the xCloud Nginx config can
add `X-Frame-Options: SAMEORIGIN` to every response, the embed included. Modern
browsers follow `frame-ancestors` and ignore it, but older and some in-app
browsers may then refuse to show the calendar on a church website. Ask xCloud
support to remove that header (and `X-XSS-Protection`) from the site's Nginx
config, or remove them with a Cloudflare Response Header Transform Rule (finding
7 in `docs/CLOUDFLARE-SECURITY-AUDIT-2026-10.md`). Because the public
registration POST is stateless, it does not require a `SameSite=None` session
cookie inside the third-party frame.

(There is no `POSTGRES_HOST_PORT` to set for deployment — the database is not published
to the host at all. That variable only matters for the local `docker-compose.dev.yml` overlay.)

Email (Resend) and Square are left disabled unless you supply their credentials;
Square stays in Sandbox until `SQUARE_ENVIRONMENT=production` **and**
`SQUARE_ENABLE_PRODUCTION=true` are both set. See the main README for those.

## Sending email through Amazon SES (#861)

Email can go out through Amazon SES instead of Resend. The conference's SES
account is in **US East (Ohio), `us-east-2`**, with production access and the
verified domains `imsda.org` and `imadventist.org`. The app talks to SES over
SMTP (`email-smtp.us-east-2.amazonaws.com`, port 587, STARTTLS required) with
**IAM SMTP credentials**, not Mail Manager.

**1. Create IAM SMTP credentials** (an AWS administrator does this once):

1. Open the SES console in `us-east-2`, then **SMTP settings**, then **Create SMTP credentials**.
2. Accept the suggested IAM user name (or name it `imsda-events-smtp`) and create it.
3. Download or copy the **SMTP username** and **SMTP password** now. AWS shows the password only once. These are not the IAM access key and secret; an ordinary access key will not work.

**2. Add these lines to the xCloud environment panel** (the values below are placeholders):

```
EMAIL_PROVIDER=ses
SES_REGION=us-east-2
SES_SMTP_USERNAME=<SMTP username from step 1>
SES_SMTP_PASSWORD=<SMTP password from step 1>
```

Optional: `SES_CONFIGURATION_SET=<name>` to tag sends with a configuration set
(recommended: it is how delivery, bounce and complaint reports are sent to the app,
see "Bounces, complaints and deliveries from SES" below),
and `SES_MAX_SEND_RATE=<messages per second>` (default `10`; keep it at or below
the "maximum send rate" shown on the SES **Account dashboard**). `SES_SMTP_HOST`
and `SES_SMTP_PORT` exist for tests and are left unset. `RESEND_API_KEY` is no
longer required once `EMAIL_PROVIDER=ses`. Redeploy so the container restarts
with the new values.

**3. Check the sender is on a verified identity.** SES refuses mail from an
address that is not on a verified domain or address. The sender used by each
event's message settings, and `ACCOUNT_EMAIL_SENDER_ADDRESS`, must end in
`@imsda.org` or `@imadventist.org` (or be a separately verified address). In the
SES console, **Verified identities** must show that domain as *Verified*.
A rejected sender appears in the message's delivery history as
"sender address is not on a verified domain" and is not retried.

**Send one test message after switching.** Before relying on SES for a real
send, use an event's "send test message" with real delivery (or any single
registration email) to an address you can read, and confirm it arrives from the
expected sender and the delivery log shows provider `SES`. This also proves the
SMTP credentials and the verified sender together.

**What staff will see.**

- Throttling replies from SES ("Maximum sending rate exceeded"), temporary
  authentication failures, and network faults are retried automatically with the
  usual backoff. The app also spaces sends (`SES_MAX_SEND_RATE`).
- A wrong SMTP username or password is checked at the start of each delivery
  run, before any message is picked up. The run stops with one error naming
  `SES_SMTP_USERNAME` and `SES_SMTP_PASSWORD`; every queued message stays
  waiting, no attempt is used up, and nothing is sent. Fix the values, redeploy,
  and the next run sends them.
- A sender address that is not on a verified identity, or an SES rejection
  (554), fails that message for good, with a message saying what to fix.
- When SES reports the **daily sending quota** is used up, the message is
  recorded with the error code `PROVIDER_QUOTA` and follows the normal retry
  schedule. A longer wait for quota errors is tracked in #860. If quota errors
  appear, ask AWS for a higher sending quota.
- **A send that times out can arrive twice.** If the connection drops after SES
  has accepted a message but before the app hears back, the app retries it, and
  the recipient may get two copies. Every message carries an
  `X-IMSDA-Message-Id` header holding the outbox message id; the two copies have
  the same value, which tells a duplicate from two separate messages.

**Switching back.** Set `EMAIL_PROVIDER=resend` (or remove the line) and
redeploy. Resend then sends exactly as before, and `RESEND_API_KEY` is required
again. Resend's delivery and bounce webhooks stay in place but receive nothing
while SES is active. The SES notification endpoint below stays in place but is
idle while Resend is active.

### Bounces, complaints and deliveries from SES (#863)

Without this step SES mail stops at "accepted": the app never learns that a
message was delivered, bounced or reported as spam. SES reports each of those
to an **Amazon SNS topic**, and SNS posts them to
`<APP_BASE_URL>/api/webhooks/ses`. **Setting this up in AWS is a human step**;
the app side is already built and does nothing until both variables below are
set.

**What the app does with the reports**

| SES reports | The app records |
| --- | --- |
| Delivery | The message moves from "accepted" to "delivered". |
| Permanent (hard) bounce | The message is marked bounced, and **all email to that address stops** (confirmations and receipts included). |
| Spam complaint | The message is marked as a complaint, and **all email to that address stops**. |
| Transient or undetermined (soft) bounce, such as a full mailbox | Recorded only. Sending and retries carry on. |

An address that is not being sent to shows **"Not sending: bounced"** or
**"Not sending: complaint"** on the registration (the contact, and an
attendee's own address) and under **System management > Email > Email health >
Not sending**. A system administrator can **Re-enable** an address there; that
is recorded with who did it and when. A new bounce or complaint after a re-enable
stops the address again. Delivery is held at the moment of sending, so a message
queued before the bounce is also held back (its delivery log row ends
"suppressed" with the reason).

**1. Create the SNS topic** (an AWS administrator, in `us-east-2`, the same
region as SES):

**Use a topic dedicated to this app, fed only by this app's configuration set**
(step 3). Do not reuse a topic that other applications publish to.

1. Open **Amazon SNS**, **Topics**, **Create topic**, type **Standard**, name it
   `imsda-ses-events`. Leave encryption and the access policy at their defaults
   (the default policy allows only your own account to publish).
2. Copy the topic **ARN** (for example
   `arn:aws:sns:us-east-2:123456789012:imsda-ses-events`) and note the 12-digit
   **AWS account id** it contains.

**2. Add the two environment variables** to the xCloud environment panel and
redeploy (placeholders shown):

```
SES_SNS_TOPIC_ARN=arn:aws:sns:us-east-2:<account id>:imsda-ses-events
SES_AWS_ACCOUNT_ID=<the same 12-digit account id>
```

`SES_SNS_TOPIC_ARN` is the **only** topic the app trusts, and
`SES_AWS_ACCOUNT_ID` is the only AWS account whose mail it accepts reports for.
The two must agree (the account id is inside the ARN) or the app refuses to
start in a way that names the variable. Until both are set the endpoint answers
503 and processes nothing. The app deploys and runs the same with them blank.

**3. Create a configuration set and send events to the topic.** In the SES
console (`us-east-2`):

1. **Configuration sets**, **Create set**, named for example `imsda-events`.
2. In that set, **Event destinations**, **Add destination**: choose the event
   types **Delivery**, **Bounces** and **Complaints**, destination **Amazon
   SNS**, and pick the `imsda-ses-events` topic.
3. Set `SES_CONFIGURATION_SET=imsda-events` in the environment panel (the
   optional variable described above) and redeploy, so every message the app
   sends is tagged with the set.

**Do not use identity-level notifications** (a verified domain or address
publishing bounces, complaints and deliveries to the topic). The app can read
them, but they cover every sender on the AWS account, not just this app. A hard
bounce or complaint from any other system sending as `imsda.org` or
`imadventist.org` would then stop **this app's** email to that address too, with
nothing in the app to say where the report came from. The configuration set
covers exactly this app's mail, which is why it is the supported setup.

**Set the topic to signature version 2** (SHA-256; version 1 is SHA-1). It is the
topic attribute `SignatureVersion`, set from the console where it is offered or
with the AWS CLI:

```
aws sns set-topic-attributes --region us-east-2 --topic-arn <topic ARN> \
  --attribute-name SignatureVersion --attribute-value 2
```

Then add this to the environment panel and redeploy:

```
SES_SNS_SIGNATURE_VERSION=2
```

With it set, the endpoint refuses any message signed with version 1. Leave it
blank only if you cannot change the topic: the default accepts both versions.
Change the topic first; setting the variable while the topic still signs with
version 1 makes every report fail with a 400.

**4. Subscribe the app's endpoint to the topic.** In SNS, on the topic,
**Create subscription**: protocol **HTTPS**, endpoint
`<APP_BASE_URL>/api/webhooks/ses`. Leave raw message delivery **off**. The app
is reachable from the internet at that address (it is the same host as the
site), so no extra firewall rule is needed.

**Subscription confirmation is automatic and deliberately narrow.** SNS first
sends a `SubscriptionConfirmation` message. The app confirms it only when all of
these hold: the SNS signature verifies, the topic is exactly
`SES_SNS_TOPIC_ARN`, and the message's own confirmation address is exactly
`https://sns.us-east-2.amazonaws.com/` with the three query parameters
`Action=ConfirmSubscription`, this topic and this message's token and nothing
else. It makes one request to that address with no redirects. Any other
confirmation, or any other address, is refused with a 4xx and nothing is
fetched. In the SNS console the subscription should show **Confirmed** within a
minute. If it stays **Pending confirmation**, check that the two variables are
set and the site has been redeployed, then use **Request confirmation** on the
subscription. An `UnsubscribeConfirmation` is acknowledged and never followed:
re-subscribing is always this manual step.

**What the endpoint checks** (so you know what a failure means). Every request
must be at most 256 KB; be signed by AWS (`SignatureVersion` 1 or 2, or only 2
with `SES_SNS_SIGNATURE_VERSION=2`, checked over the string AWS defines for the
message type) with a certificate for `sns.amazonaws.com` issued by Amazon,
fetched only from
`https://sns.<region>.amazonaws.com/SimpleNotificationService-<32 hex digits>.pem`
for the topic's own region; carry the topic in `SES_SNS_TOPIC_ARN`; have a
`Timestamp` no more than 7 days old (SNS's longest retry window) and not more
than 5 minutes in the future; and, for a notification, name the account in
`SES_AWS_ACCOUNT_ID` as the sender. A certificate address that AWS answers with
a 403, 404 or 410 is treated as an invalid message (400); any other error,
including throttling, or a network failure is a 503 so SNS retries. Failed
certificate lookups are remembered for five minutes, so repeating the same bad
certificate address does not make the app call AWS again. Certificate addresses
can only point at AWS's own SNS host. Responses: `200` recorded, a duplicate, or
a notification the app does not act on; `400`/`403`/`413` the request is not
valid, too large or not allowed (SNS stops retrying it); `503` not configured, or AWS could
not be reached to check the signature (SNS retries); `500` storing the report
failed (SNS retries). Each report is stored once, keyed by the SNS message id,
so redelivery is harmless, and a late or repeated report can never move a
message out of a bounce or complaint.

**5. Check it end to end.** From the SES console, **Send test email** with the
scenario **Bounce**, then **Complaint**, then **Success**, to the SES mailbox
simulator addresses (`bounce@simulator.amazonses.com`,
`complaint@simulator.amazonses.com`, `success@simulator.amazonses.com`), using
the configuration set. Each report appears in the app within seconds. A
simulator address that bounced shows under **Email health > Not sending**; use
**Re-enable** to clear it. The simulator never reaches a real person and does
not count against your bounce rate.

**Privacy.** Reports are stored with ids and counts only. The only place an
address is kept is the "Not sending" list itself, in normalized (lower-case)
form, because suppression needs it. Logs and audit entries hold ids and counts,
never an address, and the real notification bodies are never stored.

**To stop it**, delete the SNS subscription (or clear the two variables). Mail
keeps sending; delivery status goes back to stopping at "accepted", and
addresses already suppressed stay suppressed until an administrator re-enables
them.

## xCloud site setup (current, October 2026)

This is how production runs and deploys now. xCloud's base compose file is
`/home/u_events/239298/docker-compose.yml` (`$XCLOUD_COMPOSE_FILE`). As xCloud
generates it, it has only the build, port `127.0.0.1:8100:3100` and `PORT`.
xCloud keeps the production environment from its dashboard in
`/home/u_events/239298/.env`, but that file only fills `${...}` values in the
compose file: **the app container does not get it unless the compose file
lists it under `env_file`.** A container started from the generated file has no
secrets and refuses to start ("Invalid server environment" or "Environment
variable not found: DATABASE_URL"), and nginx then returns 502.

So the base file on the server is replaced with
[`deploy/xcloud/docker-compose.yml`](../deploy/xcloud/docker-compose.yml). It
runs the local tag `imsda-events:live` (`pull_policy: never`, no `build`), with
`env_file` (xCloud's `.env` and `/home/u_events/.xcloud/.env.dburl`, which holds
only `DATABASE_URL`), the `imsda_events_assets` uploads volume and the
PostgreSQL network. Anything that starts the app from that file, xCloud
included, gets its settings and the deployed version. Paste the same content
into the site's **Docker Compose** page if xCloud offers an editor. If the file
on the server shrinks back to about 250 bytes, xCloud has regenerated it: copy
it in again (as `root`, `install -m 644 -o u_events -g u_events
deploy/xcloud/docker-compose.yml /home/u_events/239298/docker-compose.yml`).

**The site never runs an image built on the server.** `.github/workflows/docker-image.yml` publishes
`ghcr.io/duranttl/imsda-events:<sha>` for the latest `main` once a day at
midnight Central, or when started by hand from the Actions tab (see "Prebuilt
images from GitHub"). Its public build values
(`APP_BASE_URL`, `EMBED_ALLOWED_ORIGINS`, `SQUARE_ENVIRONMENT`,
`SQUARE_ENABLE_PRODUCTION`) come from repository variables and must match the
server `.env`.

xCloud's own deploy still builds the Dockerfile on the server
(`xcloud-site-239298-app:latest`), and xCloud has no setting to stop it. The
site never uses that image, but each build leaves gigabytes of build cache: by
Oct 15, 2026 old release images and 80 GB of cache had filled the 123 GB disk
to 99% (#943). `imsda-cleanup` (below) removes them after every deploy and
once a day.

**How a new version goes live.** xCloud does not run the Git page's Deploy
Script on this site. Its own deploy pulls `main` into `/var/www/events.imsda.org`
and then runs `down` / `up` on the base file, which restarts the app on every
merge. That restart drops anyone who is submitting a form, so it should be
turned off (see "Deploys without downtime" below); the timer then fetches
`main` itself. A systemd timer does the deploy:

- [`deploy/xcloud/deploy.sh`](../deploy/xcloud/deploy.sh), installed as
  `/usr/local/bin/imsda-deploy`, waits up to 20 minutes for
  `ghcr.io/duranttl/imsda-events:<checked-out sha>`, then switches to it
  without stopping the site (next section). If the image never appears, or the
  new version does not start, it leaves the live version running.
- [`deploy/xcloud/autodeploy.sh`](../deploy/xcloud/autodeploy.sh), installed as
  `/usr/local/bin/imsda-autodeploy`, runs every 2 minutes from
  `imsda-autodeploy.timer`. It fetches `origin/main` as the checkout's owner
  (`u_events`). When that commit differs from the live image's
  `org.opencontainers.image.revision` label, its image is published, and the
  time is inside the deploy window (`IMSDA_DEPLOY_WINDOW`, default `00-05`:
  midnight to 5 AM Central), it fast-forwards the checkout to it and runs
  `imsda-deploy`. Outside the window it waits; running `imsda-deploy` by hand
  deploys the checked-out commit at any time.
- [`deploy/xcloud/cleanup.sh`](../deploy/xcloud/cleanup.sh), installed as
  `/usr/local/bin/imsda-cleanup`, runs after each successful `imsda-deploy` and
  daily from `imsda-cleanup.timer`. It removes all
  `ghcr.io/duranttl/imsda-events:<sha>` tags (live and previous keep their
  `imsda-events:*` tags), unused build cache older than a day, untagged images
  and this site's unused `xcloud-site-239298-app` image. It never touches
  containers or volumes and never forces a removal, so anything a container uses
  stays. Cleanup and deploy take turns through `flock` on
  `/run/imsda-deploy.lock`; a failed cleanup never fails a deploy.

So after a merge nothing changes on the server until the night window: the
timer only fetches. (Until xCloud's deploy is turned off, xCloud still pulls
the commit and restarts the old version briefly.) At midnight Central GitHub
publishes the image for the latest `main` (about 10 minutes, "Prebuilt images
from GitHub"), and the timer switches to it in that night's window, so the
day's merges go live together. The timer deploys only the newest commit on
`main`: if something merges after the day's image was built, that night waits
for the next image.
For a change that can't wait, open Actions → "Docker image" → "Run workflow"
on `main`, wait about 10 minutes, then pull and run `imsda-deploy` by hand
(step 3 under "Deploys without downtime"); otherwise the timer deploys it in
the next night window. Additive database
migrations can be run as soon as their PR merges: the old code ignores new
tables and columns until the night deploy. Watch it with
`journalctl -u imsda-autodeploy.service -f`. To deploy by hand, run
`imsda-deploy` as `root`.

### Before merging #1400 (health answer trimmed)

`/usr/local/bin/imsda-deploy` is a copy of `deploy/xcloud/deploy.sh`, not a link.
The new app only shows the release SHA on `/api/health` to a caller with the
sweep token, and the old copy of the script sends no token. If the merge deploys
with the old script, it can never see the new SHA, the deploy fails, and the SHA
is written to `/var/lib/imsda/failed-sha`, which blocks further deploys.

**Before the merge reaches the server**, install the new script from the PR
branch (as `root`). The server checkout is still on `main` at this point, so
take the file straight from the branch:

```bash
cd /var/www/events.imsda.org
# Fetch as the checkout's owner (u_events) so .git stays owned by it.
runuser -u u_events -- git fetch origin claude/issue-1400-health-trim
runuser -u u_events -- git show FETCH_HEAD:deploy/xcloud/deploy.sh > /tmp/imsda-deploy.new
install -m 755 /tmp/imsda-deploy.new /usr/local/bin/imsda-deploy && rm /tmp/imsda-deploy.new
```

The new script reads the token from the container it is checking and works with
older images too (they ignore the header and still show the SHA publicly), so
installing it early is safe.

**If it was missed and a deploy failed** (after the merge, so `main` has the new
script):

```bash
install -m 755 /var/www/events.imsda.org/deploy/xcloud/deploy.sh /usr/local/bin/imsda-deploy
rm -f /var/lib/imsda/failed-sha
imsda-deploy
```

### Deploys without downtime (#1263)

Before #1263 every deploy stopped the app, ran migrations and template syncs,
then started it: about a minute in which nginx showed a 502 page and a form
submitted in that window failed. Now:

1. **The old version keeps serving** while a one-off container of the new
   image runs migrations and syncs (`IMSDA_PREP_ONLY=1`). From then on the old
   code runs on the new schema, so **every migration must be additive**: new
   tables, new nullable columns or columns with a default. Never a `NOT NULL`
   column without a default, a rename or a drop in the same release as the
   code that stops using it; split those over two releases.
2. **The new version starts next to it** as the `standby` service on
   `127.0.0.1:8101` and must report the new SHA on `/api/health` (`deploy.sh`
   reads `OUTBOX_SWEEP_TOKEN` from the container it is checking, so it is exactly
   what the app received; with no token the check never passes). If it never does, the deploy stops and the live app is not restarted (the database is
   already migrated, which is why migrations must be additive).
3. **The live tag moves and `app` restarts on 8100** with the preparation
   skipped (`IMSDA_SKIP_DB_PREP=1`), so it answers within a few seconds. If it
   does not come back on the new SHA, the script puts `imsda-events:previous`
   back and keeps the standby running until it is healthy.
4. **The standby is removed.**

A commit that fails is written to `/var/lib/imsda/failed-sha` and the timer
does not retry it; the next merge to `main` is tried as usual. Running
`imsda-deploy` by hand always tries. An image built before #1263 (for example
when deploying an older commit by hand) does not support this, so the script
switches to it the old way, with about a minute offline.

Whenever the container does run the preparation itself (a manual `up`, a
rollback), it answers with a short 503 "The site is updating" response (JSON
for `/api/*`) until the app starts, instead of nginx's 502 page. The forms
change that keeps what was typed and offers **Try again** on such an answer
is a separate PR for #1263.

**What Caleb does once on the server (human steps):**

1. **Copy the new compose file and scripts in** (as `root`, from an up-to-date
   checkout of `main`):

   ```bash
   install -m 644 -o u_events -g u_events deploy/xcloud/docker-compose.yml /home/u_events/239298/docker-compose.yml
   install -m 755 deploy/xcloud/deploy.sh /usr/local/bin/imsda-deploy
   install -m 755 deploy/xcloud/autodeploy.sh /usr/local/bin/imsda-autodeploy
   install -m 755 deploy/xcloud/cleanup.sh /usr/local/bin/imsda-cleanup
   install -m 755 deploy/xcloud/heartbeat.sh /usr/local/bin/imsda-heartbeat
   docker compose -f /home/u_events/239298/docker-compose.yml --profile standby config --quiet && echo config-ok
   ```

2. **Check the timer can fetch** (it uses the same Git access xCloud set up
   for `u_events`):

   ```bash
   runuser -u u_events -- git -C /var/www/events.imsda.org fetch origin main && echo fetch-ok
   ```

   If this asks for a password or fails, stop here and leave xCloud's deploy on
   (step 3) until the Git access is fixed.

3. **Turn off xCloud's deploy on merge.** In the xCloud dashboard open the
   events.imsda.org site, then its **Git** settings, and turn off the automatic
   deploy on push (xCloud calls it "Push to Deploy" or "Auto Deploy"; the
   wording may differ). After that a merge no longer pulls code or restarts
   the app. The timer fetches `main` every 2 minutes and deploys between
   midnight and 5 AM Central once the image is published. Check it the next
   morning:

   ```bash
   systemctl list-timers imsda-autodeploy.timer        # next run is listed
   journalctl -u imsda-autodeploy.service --since today | grep Deploying
   T="$(docker exec xcloud-site-239298-app-1 printenv OUTBOX_SWEEP_TOKEN)"; printf 'Authorization: Bearer %s\n' "$T" | curl -s -H @- http://127.0.0.1:8100/api/health | grep -o '"sha":"[^"]*"'
   ```

   To use a different window, add `Environment=IMSDA_DEPLOY_WINDOW=01-04` under
   `[Service]` in `/etc/systemd/system/imsda-autodeploy.service`, then
   `systemctl daemon-reload` (a window may cross midnight, like `22-02`). For a change that can't wait, run
   `imsda-deploy` by hand after `runuser -u u_events -- git -C
   /var/www/events.imsda.org pull --ff-only origin main`.

4. **Optional, for no gap at all: let nginx fall back to the standby.** Only if
   xCloud lets you add custom Nginx config for the site. Replace the
   `proxy_pass http://127.0.0.1:8100;` target with an upstream that has 8101 as
   a backup:

   ```nginx
   upstream imsda_events_app {
       server 127.0.0.1:8100 max_fails=1 fail_timeout=5s;
       server 127.0.0.1:8101 backup;
   }
   # in the location block:
   proxy_pass http://imsda_events_app;
   proxy_next_upstream error timeout http_502 http_503;
   ```

   Without it, the only gap is the few seconds while `app` restarts in step 3
   above.

Install or update (as `root`, from a checkout of `main`):

```bash
install -m 755 deploy/xcloud/deploy.sh /usr/local/bin/imsda-deploy
install -m 755 deploy/xcloud/autodeploy.sh /usr/local/bin/imsda-autodeploy
install -m 755 deploy/xcloud/cleanup.sh /usr/local/bin/imsda-cleanup
install -m 755 deploy/xcloud/heartbeat.sh /usr/local/bin/imsda-heartbeat
cat > /etc/systemd/system/imsda-autodeploy.service <<'UNIT'
[Unit]
Description=Deploy the GitHub-built IMSDA Events image for the checked-out commit
[Service]
Type=oneshot
ExecStart=/usr/local/bin/imsda-autodeploy
UNIT
cat > /etc/systemd/system/imsda-autodeploy.timer <<'UNIT'
[Unit]
Description=Check for a new IMSDA Events release every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/imsda-cleanup.service <<'UNIT'
[Unit]
Description=Remove old IMSDA Events images and Docker build cache
[Service]
Type=oneshot
TimeoutStartSec=30min
ExecStart=/usr/local/bin/imsda-cleanup
UNIT
cat > /etc/systemd/system/imsda-cleanup.timer <<'UNIT'
[Unit]
Description=Daily Docker cleanup for IMSDA Events
[Timer]
OnCalendar=*-*-* 09:30:00
RandomizedDelaySec=15min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload && systemctl enable --now imsda-autodeploy.timer imsda-cleanup.timer
```

`OnCalendar` uses the server's time zone; 09:30 is meant as UTC, so check it
with `timedatectl`.

Run `imsda-cleanup` by hand to free space now, and check it with
`journalctl -u imsda-cleanup.service` and `df -h /`.

### System report heartbeats

The System report's "Background jobs" section shows three server jobs:
auto-deploy, Docker cleanup and the runtime guard. Each run sends one small
heartbeat (a result word and a few counts, never an address, path, commit or
key) to the app on this machine through `imsda-heartbeat`.

1. Set `HOST_JOB_HEARTBEAT_TOKEN` (`openssl rand -base64 48`, at least 32
   characters) in the app's environment and deploy.
2. Put the same value on the host, as `root`:

   ```bash
   install -m 600 /dev/null /etc/default/imsda-heartbeat
   nano /etc/default/imsda-heartbeat
   ```

   Add the line `IMSDA_HEARTBEAT_TOKEN=<the same value>` and save. Use an
   editor rather than `echo`, so the token does not end up in shell history.

3. Re-install the scripts (the `install -m 755` lines above, including
   `imsda-heartbeat`). Re-run `scripts/install-xcloud-runtime-guard.sh` only if
   the runtime guard is in use; it adds the line that reports each guard run.

Nothing breaks without it: a heartbeat never fails a job (it adds at most a few
seconds if the app does not answer), and the rows simply read "Not reporting
yet". Each run logs one `[heartbeat]` line, and the helper needs curl 7.55 or
newer. `imsda-heartbeat` only talks to
`http://127.0.0.1:8100` (override with `IMSDA_HEARTBEAT_URL`, loopback only).
The host's other cron jobs (the touch job and the `.xcloud` cleanup) are not in
this repository and are not reported.

By hand, as `root`:

```bash
B=/home/u_events/239298/docker-compose.yml
docker compose -f $B config --quiet && echo config-ok
IMSDA_SKIP_DB_PREP=1 docker compose -f $B up -d app   # restart on the live image
T="$(docker exec xcloud-site-239298-app-1 printenv OUTBOX_SWEEP_TOKEN)"; printf 'Authorization: Bearer %s\n' "$T" | curl -s -H @- http://127.0.0.1:8100/api/health
docker inspect xcloud-site-239298-app-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -cE '^(DATABASE_URL|MANAGE_LINK_DERIVATION_SECRET)='   # expect 2
```

**Rollback** to the version before the last deploy:

```bash
docker tag imsda-events:previous imsda-events:live
IMSDA_SKIP_DB_PREP=1 docker compose -f /home/u_events/239298/docker-compose.yml up -d app
```

`IMSDA_SKIP_DB_PREP=1` keeps the container from re-running migrations and
syncs that already ran. Without it, `up -d` recreates the container and the
site shows "updating" for about a minute.

Stop the autodeploy timer before a rollback (`systemctl stop imsda-autodeploy.timer`),
otherwise autodeploy redeploys `main` in the next night window; start it again
once `main` is fixed.

Migrations only move forward; rolling back the image does not undo them.

Old images (about 1.9 GB each) and build cache are removed by `imsda-cleanup`
(above). Never run `docker system prune -a --volumes` or `docker volume prune`:
the database, uploads and backups live in volumes.

To change a secret, edit it in the xCloud dashboard, then run the `up -d` line:
a restart alone keeps the old values.

`deploy/xcloud/docker-compose.env.yml` is the earlier override with the same
settings. It is not used with this setup.

The server-level runtime guard (`imsda-xcloud-runtime-guard.timer`) belongs to
the earlier setup and is disabled; it cannot repair a container started from
the new base file. If the app ever comes up without its settings (the log says
"Invalid server environment" or "Environment variable not found:
DATABASE_URL"), something started it from the base file alone: check xCloud's
Recent Deployments and the Deploy Script, then run the `up -d` lines above.

**Nginx is held at 1.31.3** (`apt-mark hold nginx`). On 2026-10-13 unattended
upgrades moved it to 1.31.6, but xCloud's hand-installed headers-more module
(`/usr/lib/nginx/modules`) is built for 1.31.3, so nginx refused to start and
Cloudflare showed error 521. Release the hold (`apt-mark unhold nginx`) only
after xCloud rebuilds the module for the newer version.

The sections below describe the earlier setup (base file in
`/home/u_events/.xcloud/`, settings in `/home/u_events/.xcloud/.env`). That
`.env` is now unused: on 2026-10-13 the host cleanup deleted it, the daily
touch job re-created it empty, and every container started from it had no
secrets.

## Permanent xCloud Dockerfile-only runtime override

xCloud's Dockerfile-only site type regenerates
`/home/u_events/.xcloud/docker-compose.yml` during every deployment. A separate
`docker-compose.env.yml` override is not loaded by that generated command, so
the newly created app container loses both `DATABASE_URL` and its external
PostgreSQL network unless the override is reapplied.

Keep these server-owned files in `/home/u_events/.xcloud`:

- `.env` — mode `600`, containing the production environment.
- `.env.dburl` — mode `600`, containing only `DATABASE_URL=...` (used by the
  manual deployments below).
- `docker-compose.env.yml` — adds `.env` and `.env.dburl` through `env_file`
  and attaches the external PostgreSQL network.

The complete override is checked in at
[`deploy/xcloud/docker-compose.env.yml`](../deploy/xcloud/docker-compose.env.yml).
Copy it to the server (as `root`) and check it merges with xCloud's generated file:

```bash
cd /var/www/events.imsda.org && git fetch origin && git checkout --detach origin/main
install -m 600 -o u_events -g u_events deploy/xcloud/docker-compose.env.yml \
  /home/u_events/.xcloud/docker-compose.env.yml
docker volume inspect imsda_events_assets >/dev/null && echo assets-volume-ok
docker compose -f /home/u_events/.xcloud/docker-compose.yml \
  -f /home/u_events/.xcloud/docker-compose.env.yml config --quiet && echo config-ok
```

It loads `.env` and `.env.dburl`, maps `APP_RELEASE_SHA` (an `env_file` alone
cannot see xCloud's shell-only deployment variable), attaches the existing
`imsda_events_assets` uploads volume and the external PostgreSQL network, and
carries the encryption key file mount (#876) commented out. Uncomment the two
key-file parts only once the key has moved out of `.env` (see "Loading the
encryption key from a protected file" below); with the key still in `.env`, leave
them commented. If `docker volume inspect` fails, the uploads volume has a
different name on this server (`docker volume ls`); change the `name:` under
`volumes:` to match rather than creating an empty one.

`.env.dburl` is a plain `env_file` entry, so it must exist; Compose refuses to
start without it. If `DATABASE_URL` is in `.env`, you can omit the entry.

Then configure the xCloud site's **Deployment Script** to run:

```bash
IMSDA_XCLOUD_RUNTIME_DIR=/home/u_events/.xcloud IMSDA_XCLOUD_EXPECTED_NETWORK=postgresql_9kgaw_239292_xcloud-network sh "$PROJECT_DIR/scripts/xcloud-post-deploy.sh"
```

xCloud runs this hook after each deployment. The script validates the base
Compose file, override, and environment without printing secret values; safely
recreates only the `app` service with both Compose files; and fails the
deployment if the resulting container is missing `DATABASE_URL` or the expected
database network.

Some Dockerfile-only xCloud sites do not execute the configured Deployment
Script. When the deployment log does not contain any `[xcloud-post-deploy]`
lines, install the server-level guard instead:

```bash
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/DurantTL/imsda-events/main/scripts/install-xcloud-runtime-guard.sh \
  --output /tmp/install-imsda-xcloud-runtime-guard.sh

sh /tmp/install-imsda-xcloud-runtime-guard.sh
```

Run those commands as `root`. The installer copies the repair hook to
`/usr/local/sbin`, creates a systemd oneshot service and 30-second timer, and
runs the first check immediately. The check is idempotent: while the app already
has `DATABASE_URL` and the expected PostgreSQL network, it makes no container
change. After xCloud recreates a base-only container, the next timer run restores
the override. If the timer wakes while xCloud has no app container, it defers
rather than starting a competing build.

Verify it with:

```bash
systemctl status imsda-xcloud-runtime-guard.timer --no-pager
journalctl -u imsda-xcloud-runtime-guard.service -n 50 --no-pager
```

The cleaner long-term alternative is an xCloud **Custom Docker → Docker Compose
From Git** site using the repository's Compose file and xCloud's Environment
File option. That site type natively loads a named Compose file and should be
preferred when replacing this Dockerfile-only site. The post-deployment hook
keeps the current site reliable without another database or domain move.

### Protecting the override files from the host's 30-day cleanup script

The production host runs `/root/xcloud-cleanup.sh` daily at 13:12, which
deletes anything under any site's `.xcloud/` directory that hasn't been
modified in 30 days. That sweep does not know these four files are a
permanent, hand-maintained override rather than deploy scratch space, so it
will delete `.env`, `.env.dburl`, `docker-compose.yml`, and `docker-compose.env.yml` out
from under a site that hasn't deployed (and therefore hasn't touched them)
in a month.

Install a daily touch job as `root` to keep them exempt:

```bash
cat > /etc/cron.d/imsda-xcloud-touch <<'EOF'
# Keep the persistent xCloud runtime override files from being swept by
# /root/xcloud-cleanup.sh's blanket "delete anything in .xcloud/ older than
# 30 days" logic — see docs/DEPLOY-DOCKER.md for why these files must persist.
0 5 * * * root touch -c /home/u_events/.xcloud/.env /home/u_events/.xcloud/.env.dburl /home/u_events/.xcloud/docker-compose.yml /home/u_events/.xcloud/docker-compose.env.yml 2>/dev/null
EOF
chmod 644 /etc/cron.d/imsda-xcloud-touch
```

Files dropped into `/etc/cron.d/` are picked up automatically; no cron
restart needed. Verify with `cat /etc/cron.d/imsda-xcloud-touch` (expect 4
lines: 3 comment lines + 1 cron line) or `cat -A` if a terminal seems to be
wrapping the line and you want to confirm it wasn't actually truncated.

`touch -c` never creates a file. A plain `touch` re-creates a file the
cleanup already deleted as an **empty** file, which hides the loss: an empty
`.env` starts an app with no secrets, and it refuses to run. That is how the
2026-10-13 outage began. If an earlier version of this job is installed,
replace its line with the one above.

### When the Dockerfile-only site stops regenerating `docker-compose.yml` at all

Occasionally this site type stops writing `/home/u_events/.xcloud/docker-compose.yml`
on deploy entirely — the dashboard's **Deploy** button reports success (or an
`empty compose file` error) but the file is missing or empty afterward, and
neither `scripts/xcloud-post-deploy.sh` nor the systemd guard above can repair
a container, because both depend on xCloud having produced *some* base Compose
file to patch. In this mode the guard only checks the app container (set
`IMSDA_XCLOUD_CONTAINER_PATTERN` in `/etc/default/imsda-xcloud-runtime-guard`;
the installer sets it to `xcloud-site-239298-app-1`). It passes while exactly
one matching container is running with `DATABASE_URL` and the PostgreSQL
network. It defers only when no matching container exists but a matching
`-old` container does (a swap in progress). It fails, so the journal shows it,
when there is no matching container at all, when a matching container is not
running, when more than one is running, or when either setting is missing.
**Re-run the installer after this change merges** so production gets the new
script and pattern. When this happens, **file an xCloud support ticket**: this
is a platform-level regression, not something fixable from inside the site.
Until it's resolved, every deploy needs the manual rebuild-and-swap below
instead of the dashboard Deploy button.
A single failed guard run during a manual swap is expected and harmless: it can
happen between the stop and the rename, and between the run and the network
connect.

#### Manual deploy script

Use this when the xCloud Deploy button cannot be used (for example, when the
base Compose file is not regenerated). `scripts/manual-deploy.sh` does the
whole swap below in one command, and replaces
the hand-kept `/root/manual-deploy.sh`. That copy was written before the
encryption key file (#876), the lodging sync and the GHCR images, so it can now
start a container the app refuses to run. Run as `root` on the host, with the
full SHA of a `main` commit whose CI and **Docker image** workflow are green:

```bash
cd /var/www/events.imsda.org
git fetch origin && git checkout --detach origin/main     # gets the script itself
sh scripts/manual-deploy.sh <full commit sha>
```

What it does, in order:

1. Checks `/home/u_events/.xcloud/.env`, refreshes `.env.dburl` from the running
   app when `DATABASE_URL` is not in `.env` (never printed), and picks how the
   encryption key is supplied: the `/etc/imsda/secret-encryption-key` mount
   when that file exists, otherwise `SECRET_ENCRYPTION_KEY` in `.env`. It stops
   when both are present ("finish the move") or neither is.
2. Pulls `ghcr.io/duranttl/imsda-events:<sha>`. With
   `IMSDA_DEPLOY_SOURCE=build` it builds from the checkout instead (about 40
   minutes).
3. Runs the app's own production environment check **inside the new image**
   with the same env files and key mount. A missing or conflicting variable is
   listed by name and the deploy stops with the current site still running.
4. Keeps the running app as `<name>-old` (removing the previous `-old` first),
   starts the new container with the same port, networks, uploads volume and
   restart policy, and waits up to 15 minutes for `/api/health` to report the
   new SHA (it reads `OUTBOX_SWEEP_TOKEN` from the new container with `docker exec`; with no token the check never passes). If the container
   exits or never reports it, the script prints its
   last log lines and puts the `-old` container back automatically.
5. When `/home/u_events/.xcloud/.env.backup` exists, restarts `imsda-backup` on
   the matching backup image (docs/BACKUPS.md). Skip with `IMSDA_SKIP_BACKUP=1`.
   The `imsda-outbox-sweeper` container is not touched.

The defaults match this server (`xcloud-site-239298-app-1`,
`xcloud-site-239298_default`, `postgresql_9kgaw_239292_xcloud-network`,
`127.0.0.1:8100:3100`). If the xCloud site is recreated with a new id or
network, override them: `IMSDA_APP_CONTAINER`, `IMSDA_SITE_NETWORK`,
`IMSDA_XCLOUD_EXPECTED_NETWORK`, `IMSDA_PUBLISH`, `IMSDA_HEALTH_URL`; and set
the same container name in `/etc/default/imsda-xcloud-runtime-guard`.

Afterwards still check `https://events.imsda.org` through the real domain and
open one uploaded file (step 5 below). Remove `<name>-old` once you are happy.

#### Manual rebuild-and-swap (what the script does, by hand)

This builds a fresh image from the current checkout, keeps the old container
as a renamed (not deleted) safety net, and starts the new one wired
identically to the old — same published port, same two networks, same
restart policy. Run as `root` on the host. Substitute the actual container
name (`docker ps` shows it; the pattern is `xcloud-site-<id>-app-1`), the
site's internal Compose network name, the shared Postgres network name from
the override file above, and the commit SHA being deployed.

1. **Capture the live `DATABASE_URL`** from the still-running container to a
   protected file — never to the screen, since it contains the database
   password:

```bash
   umask 077
   DBURL=/home/u_events/.xcloud/.env.dburl
   TMP="$(mktemp /home/u_events/.xcloud/.env.dburl.XXXXXX)"
   docker inspect xcloud-site-<id>-app-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
     | grep '^DATABASE_URL=' > "$TMP" || true
   if [ -s "$TMP" ] && grep -q '^DATABASE_URL=postgres' "$TMP"; then
     chown u_events:u_events "$TMP"
     chmod 600 "$TMP"
     mv "$TMP" "$DBURL"
   else
     rm -f "$TMP"
     if [ -s "$DBURL" ]; then
       echo "WARNING: no DATABASE_URL found in the container; keeping the existing $DBURL" >&2
     else
       echo "No DATABASE_URL found anywhere - stop here, do not continue to step 3." >&2
     fi
   fi
```

If the "No DATABASE_URL found anywhere" message appears, do not go past step 1:
there is no database URL to give the new container.

2. **Build the new image from the current checkout:**

```bash
   cd /var/www/events.imsda.org
   docker build -t imsda-events:manual-<short-sha> .
```

   Check the build actually finished (and didn't error) before continuing. The
   build skips the TypeScript check, so also confirm the commit's GitHub CI is
   green before deploying it.

3. **Rename the old container instead of removing it**, so rollback is one
   command:

```bash
   docker stop xcloud-site-<id>-app-1
   docker rename xcloud-site-<id>-app-1 xcloud-site-<id>-app-1-old
```

4. **Start the new container**, replicating the old one's exact port,
   network, and restart configuration:

```bash
   docker run -d \
     --name xcloud-site-<id>-app-1 \
     --restart unless-stopped \
     -p 127.0.0.1:8100:3100 \
     --network xcloud-site-<id>_default \
     --env-file /home/u_events/.xcloud/.env \
     --env-file /home/u_events/.xcloud/.env.dburl \
     -v imsda_events_assets:/app/storage/event-assets \
     -e NODE_ENV=production \
     -e PORT=3100 \
     -e APP_RELEASE_SHA=<full-sha> \
     imsda-events:manual-<short-sha>

   docker network connect postgresql_9kgaw_239292_xcloud-network xcloud-site-<id>-app-1
```

5. **Verify:**

```bash
   docker logs -f xcloud-site-<id>-app-1
   # once it looks up and serving, Ctrl-C, then:
   T="$(docker exec xcloud-site-<id>-app-1 printenv OUTBOX_SWEEP_TOKEN)"; printf 'Authorization: Bearer %s\n' "$T" | curl -s -H @- http://127.0.0.1:8100/api/health
```

   Confirm `status: ok`, the expected `release.sha`, `database`/
   `messageOutbox` both `ok`. After the encryption key has moved to a file, also
   confirm `"encryptionKey":{"configured":true,"source":"file"}` (see "Loading
   the encryption key from a protected file"). Then check `https://events.imsda.org` through
   the real domain (Cloudflare/Nginx), not just the internal `curl`, to
   confirm routing actually reached the new container — and spot-check
   whatever feature the deploy was for.

   Also open one uploaded file — the event badge artwork or a schedule on the
   event page. The `-v imsda_events_assets:...` line above is what attaches the
   uploads volume; a container started without it looks healthy but serves a
   404 for every uploaded file. Nothing is lost: stop it and start it again
   with the volume.

   The container's entrypoint runs the club form sync (`npm run club-forms:sync`)
   right after migrations, so `docker logs` should show
   `Club form templates are in sync.` before `Starting`. If it prints `REFUSED`,
   the container exits: a form version would make a sensitive answer or birth date
   readable again, which needs a reviewed change; roll back below. A large
   re-seal can take minutes before the app answers `/api/health`.

**Rollback**, if anything looks wrong:

```bash
docker stop xcloud-site-<id>-app-1
docker rm xcloud-site-<id>-app-1
docker rename xcloud-site-<id>-app-1-old xcloud-site-<id>-app-1
docker start xcloud-site-<id>-app-1
```

**Cleanup**, once the new container is confirmed good (the `-old` container
can be kept a day or two first for extra insurance, no rush):

```bash
docker rm xcloud-site-<id>-app-1-old
```

Keep `/home/u_events/.xcloud/.env.dburl`: the next manual swap reads it, and
the runtime guard accepts it as the home of `DATABASE_URL`.

A `messageOutbox` `failed` count greater than zero in the health check is
usually pre-existing and unrelated to the deploy itself — worth a look in the
admin/ops view separately, but not a reason to roll back.

## Prebuilt images from GitHub (no build on the server)

Building the image on the 4 GB server takes about 40 minutes (`next build`).
`.github/workflows/docker-image.yml` builds it on GitHub once a day at midnight
Central for the latest `main` (skipped when that commit already has an image),
and by hand from the Actions tab ("Run workflow"), and publishes:

- `ghcr.io/duranttl/imsda-events:<full commit sha>` — deploy this exact tag
- `ghcr.io/duranttl/imsda-events:main` — the latest merge

The image holds no secrets; everything sensitive still comes from the env files
at runtime. A few public values are baked in while Next compiles metadata and
security headers, so set these **repository variables** (Settings → Secrets and
variables → Actions → Variables) to match the server `.env`:
`APP_BASE_URL`, `EMBED_ALLOWED_ORIGINS`, `SQUARE_ENVIRONMENT`,
`SQUARE_ENABLE_PRODUCTION`. Unset ones fall back to
`https://events.imsda.org`, `'self' https://imsda.org https://*.imsda.org`,
`sandbox` and `false`.

To deploy, pull the image for the commit instead of building it, then run the
same rename-and-start steps as the manual rebuild-and-swap (same env files,
volume `imsda_events_assets`, port and networks):

```bash
IMAGE=ghcr.io/duranttl/imsda-events:<full commit sha>
docker pull "$IMAGE"
```

If the pull asks for a login, make the package public once (GitHub → the
repository → Packages → imsda-events → Package settings → Change visibility),
or `docker login ghcr.io` with a token that has `read:packages`.

## Moving to a clean server and a new URL

This deployment is designed to start from an empty server. It does not need a
database dump when the old data is intentionally being discarded:

1. Install Docker Engine with the Compose plugin, clone this repository, and set
   the production environment variables. Generate new values for all five
   application secrets and `POSTGRES_PASSWORD`; do not copy old values when no
   old sessions, private links, QR passes, or MFA enrollments need to survive.
2. Set `APP_BASE_URL` to the final HTTPS origin, with no trailing path. Set
   `SQUARE_WEBHOOK_NOTIFICATION_URL` to
   `<APP_BASE_URL>/api/webhooks/square`.
3. Point DNS at the new server and configure its TLS reverse proxy to forward to
   `APP_PORT` (`3100` by default).
4. Update the external providers that know the old URL:
   - Google OAuth authorized redirect URI:
     `<APP_BASE_URL>/api/attendee/oauth/google/callback`
   - Square webhook notification URL:
     `<APP_BASE_URL>/api/webhooks/square`
   - Resend webhook URL:
     `<APP_BASE_URL>/api/webhooks/resend`
5. Run `docker compose up -d --build`. Postgres creates an empty database in the
   `imsda_events_postgres` volume; the app waits for it, applies every committed
   Prisma migration, and then starts. There is no demo seed.
6. Confirm the stack before importing anything:

   ```bash
   docker compose ps
   docker compose exec app npx prisma migrate status
   curl --fail https://your-new-domain/api/health   # public answer: status and database
   ```

7. Create the first administrator as described below. Create or configure the
   Women's Retreat event, then use **Imports** to preview and commit the
   registration CSV again. Re-enter event messaging settings and re-upload
   schedules, flyers, or images; uploaded files are now kept in the separate
   `imsda_events_assets` volume.
8. Keep Square in Sandbox, complete a registration/payment/webhook test, and
   only consider the separate production unlock after reconciliation passes.

Changing `APP_BASE_URL`, `EMBED_ALLOWED_ORIGINS`, or the Square environment
requires `docker compose up -d --build`, not only a container restart. Those
public values are used while Next compiles metadata and security headers and are
also supplied again at runtime.

Ordinary rebuilds and `docker compose down` preserve all three named volumes.
`docker compose down --volumes` deliberately erases the database, uploaded
files, and on-host backups; use it only while this intentionally disposable
clean deployment is still being rebuilt.

## First-deploy checklist

1. Set the required env vars above.
2. Deploy. Watch the logs for `Applying database migrations...` then `Starting`.
   A startup failure names the environment variable that caused it.
3. `GET /api/health` with no token should return `{"status":"ok"}` and
   `services.database` `ok`. With the `OUTBOX_SWEEP_TOKEN` bearer token it also
   shows `messageOutbox`, `release.buildId` and, when configured, `release.sha`.
   Record both values in the deployment log:

   ```bash
   T="$(docker compose exec -T app printenv OUTBOX_SWEEP_TOKEN)"
   printf 'Authorization: Bearer %s\n' "$T" | curl --fail --silent -H @- https://your-final-domain/api/health | jq '.status, .release'
   ```
4. Create the first real administrator. The database starts empty and there is no
   first-run setup screen, so this is the supported way in:

   ```bash
   docker compose exec app npm run admin:create -- \
     --email you@imsda.org --name "Your Name"
   ```

   It prints a one-time activation URL. Open it and choose a password. The link is
   shown once — only its digest is stored — and expires after seven days. The
   account cannot sign in until it is activated.

   If opening a link is impractical — the domain is not live yet, or account
   email is not configured — set the password directly instead:

   ```bash
   docker compose exec -e IMSDA_ADMIN_PASSWORD='<a long passphrase>' app \
     npm run admin:create -- --email you@imsda.org --name "Your Name" \
     --password-from-env
   ```

   That account is `ACTIVE` immediately. The password is read from the
   environment rather than an argument so it stays out of shell history and
   `ps`, is held to the same policy as any other, and is stored only as its
   scrypt hash. Clear `IMSDA_ADMIN_PASSWORD` afterwards, and change the password
   from the workspace once account email works.
5. Invite colleagues from **Team** in the workspace. Each invitation
   emails its own one-time activation link to the person invited; if they lose it
   they can request another from **Forgot password**. (Where account email is not
   configured — development only, since production requires it — the link is
   shown to you once instead, to pass on yourself.)
6. Confirm `APP_BASE_URL` is the final `https` domain before sending any real links.
7. Confirm the club form templates were synced (#610). `docker-entrypoint.sh`
   runs `npm run club-forms:sync` after `prisma migrate deploy` and before the
   app starts, on every deploy, so there is normally nothing to do; look for
   `Club form templates are in sync.` in the logs. To run it by hand:

   ```bash
   docker compose exec app npm run club-forms:sync
   ```

   It creates missing forms (off), brings changed ones to the code's version, and
   re-seals existing answers for any field that became sensitive, in one
   transaction per form. It is not done by the admin page or by a web request,
   because a large re-seal takes a while. Until it runs, saves to a form whose
   version is behind are refused with "This form is being updated" (nothing is
   written), the admin page shows "Needs sync", and readers and the CSV already
   treat the new code's sensitive keys as restricted. It is safe to run again, and
   it refuses (changing nothing for that form) a version that would make a
   sensitive answer or a birth date readable again; that needs a reviewed change.
   It carries on with the other forms, reports every refusal, and exits non-zero,
   so the container stops and the deploy fails loudly. The app healthcheck
   `start_period` is 300 s so a large re-seal fits before health checks count.

**There is no seed step, and `RUN_DB_SEED` is no longer supported.** `prisma/seed.ts`
writes fictitious events, people, registrations, payments and a refund, and gives
every account one shared password that is published in this repository. It refuses
to run with `NODE_ENV=production` or against any non-loopback database host.

## Event modules release note (#741)

This release adds per-event modules (`EventModule`). The migration backfills a
row for every feature an event already uses, so nothing turns off. A club event
created in the short window between the migration and the new code starting
would have no club-module rows, and its Honors Weekend card would stay hidden
until a system administrator enables the module. After such a deploy, run the
idempotent backfill once from the running app container:

```bash
npm run event-modules:backfill
```

It runs the same `INSERT ... ON CONFLICT DO NOTHING` statements as the
migration (read from the migration file). It only adds missing rows and never
deletes, updates, or turns off a module, so it is safe in production and safe to
repeat. Unlike `event-audience:backfill` it has no `--apply` guard for that
reason.

## Alerting

Set `ALERT_WEBHOOK_URL` to a Slack or Teams incoming webhook — or anything that
accepts a JSON POST — and the deployment will tell you when it is in trouble
instead of waiting for someone to notice.

What pages, and when:

| Condition | Severity | Raised by |
| --- | --- | --- |
| The database is unreachable | urgent | `/api/health`, on every failed check |
| Email delivery is falling behind (25+ due, or 30 minutes waiting) | urgent | the sweep, every run |
| A message gave up after all five attempts | urgent | the sweep |
| A card payment failed | urgent | the sweep |
| A card payment never reached a result after 15 minutes | urgent | the sweep — this is usually the Square webhook not arriving |
| A Square webhook failed signature verification | urgent | the webhook, immediately |
| A Resend webhook failed verification | watch | the webhook, immediately |

The scan runs at the end of the outbox sweep, so its frequency is
`OUTBOX_SWEEP_INTERVAL_SECONDS` (300 by default).

Because the scan rides on the sweep, **a sweep that stops cannot alert about
itself.** Each successful sweep therefore records when it finished, and
the detailed `/api/health` reports it as `outboxSweep`: `ok`, `stale` (no
successful sweep for 15 minutes — three missed five-minute runs), `failing` (the
latest run failed), or `never` (nothing has reported since this was added).
`stale` and `failing` turn the detailed `status` to `degraded` while still
answering 200. The System command center shows the same signal.

#### Uptime monitor

`/api/health` has two answers (#1400):

- **Public (no token):** `{"status":"ok","checkedAt":...,"services":{"database":"ok"}}`
  with HTTP 200 while the site is up and the database answers; HTTP 503 and
  `"status":"degraded"` when the database is down. Point the ordinary uptime
  monitor (and the Cloudflare skip rule) at this and alert on anything other than
  HTTP 200 / `"status":"ok"`. Backups, the outbox and the sweep never change it.
- **Detailed (token):** release, backups, outbox, sweep and encryption key source.
  Send `Authorization: Bearer <token>` with `HEALTH_MONITOR_TOKEN` (at least 32
  characters, `openssl rand -base64 48`). Use that separate token for a
  third-party monitor so the sweep token is never shared with it, and alert on a
  `"status"` other than `"ok"`: that is what catches a stopped sweeper, a stale
  backup or a backed-up outbox. `OUTBOX_SWEEP_TOKEN` and a signed-in system
  administrator also see the detail. A wrong or missing token gets the public
  answer, not an error.

Every health response sends `Cache-Control: no-store`. Whatever runs the sweep on the host — the Compose
`outbox-sweeper` service or a cron entry — must `POST` to
`/api/internal/outbox/sweep` with the `OUTBOX_SWEEP_TOKEN` bearer token for
any of this to register. A condition that persists pages
once per `ALERT_REPEAT_MINUTES` (60 by default) rather than every run; when it
stops being true it is cleared, so a recurrence pages immediately.

Every alert is also written to the log as a JSON line carrying `alertKey` and
`severity`, at error level for urgent ones. A deployment with no webhook set
still leaves that trail for a log aggregator to match on — but nothing will be
watching it, which is the state this replaced.

## Two-factor authentication

System administrators and event administrators must carry a second factor. The
enforcement is at sign-in: a correct password for one of those accounts produces
a **challenge**, not a session, and an account that has never enrolled is sent to
enrol inside that challenge. There is no state in which one of these accounts is
signed in on a password alone.

Everyone else may enrol voluntarily from **More → Two-factor authentication**.

Each enrolment issues ten single-use recovery codes, shown once. If an
administrator loses both their authenticator and their codes, an operator with
shell access can clear the enrolment:

```bash
docker compose exec app npm run admin:reset-mfa -- --email them@imsda.org
```

That signs out every session for the account and requires a fresh enrolment on
its next sign-in, because the role still demands one.

## Troubleshooting a failed deploy

### `dependency failed to start: container ...-app-1 is unhealthy`

The app container started but never passed its health check, so the services that
wait on it (`outbox-sweeper`) stayed in `created`. The deploy output does not
carry the reason — the app log does:

```bash
docker compose logs app --tail 50
```

In xCloud, the same thing is under **Logs → Docker Compose Log →
`...-app-1`**.

The two things that put it there:

- **A missing or too-short environment variable.** The log opens with
  `Refusing to start: the environment is not valid for production.` followed by
  one line per offending variable. Add it in the env panel and deploy again.
  The ones that catch a deployment created before they existed are
  `OUTBOX_SWEEP_TOKEN`, `SECRET_ENCRYPTION_KEY`, `RESEND_API_KEY`, and
  `ACCOUNT_EMAIL_SENDER_ADDRESS`.
- **A migration that could not be applied.** The log stops after
  `Applying database migrations (prisma migrate deploy)...` with a Prisma error.

The health check itself allows 40 seconds of start-up before its first probe and
then retries for a further two and a half minutes, so a slow first boot is not
the cause.

### `error: OUTBOX_SWEEP_TOKEN: set this to at least 32 random characters ...`

`docker compose` refused to build at all because a required variable is absent
from the environment. This is the same fault as above, caught earlier and stated
plainly. Add the named variable and deploy again.

## Loading the encryption key from a protected file (#876)

`SECRET_ENCRYPTION_KEY` protects birth dates, health records, Sterling Volunteers
data and calendar feed addresses. In an env file passed with `--env-file` it is
readable by anyone who can read that file and it appears in `docker inspect`.
Instead, keep it in a root-only file on the server and mount that file into the
container. The app reads it once at startup and trims it.

How the app behaves (`lib/env.ts`):

- `SECRET_ENCRYPTION_KEY_FILE=<path>` makes the app read the key from that file.
- Setting **both** `SECRET_ENCRYPTION_KEY_FILE` and `SECRET_ENCRYPTION_KEY` stops
  startup. Remove the plain variable from the env file.
- A file that is missing, unreadable or empty stops startup, with the variable
  and path named in the log. The key and the file's contents are never logged.
- With only `SECRET_ENCRYPTION_KEY` set, nothing changes (development).
- Everything run inside the app container reads the same variable through the
  same loader: the app, `npm run club-forms:sync` and `lodging:sync` (run by the
  entrypoint), `admin:create`, `admin:reset-mfa` and `key:restore-check`. A shell
  opened with `docker exec` inherits the container's variables, so those commands
  work unchanged. A one-off `docker run` of the image (not `exec`) must be given
  the same `-v` and `-e` pair.
- The **outbox sweeper does not use the key.** It is a `curl` loop that needs only
  `OUTBOX_SWEEP_TOKEN` (`scripts/outbox-sweep.sh`), so it gets no key file. Giving
  it one only widens who can read the key. (The `docker-compose.yml` development
  stack still passes `SECRET_ENCRYPTION_KEY` as a plain variable.)
- `/api/health` (with a bearer token, see "Uptime monitor") reports `"encryptionKey": {"configured": true, "source": "file"}`
  (or `"env"`). `configured: false` with `source: "file"` means the file variable
  is set but the file could not be used. The value is never shown.

**File ownership and mode.** The `Dockerfile` has no `USER` line, so the app
container runs as root (uid 0) and can read a root-owned `0400` file. Keep the
file `root:root` and `0400` on the host. If a `USER` line is ever added to the
`Dockerfile`, a root-owned `0400` file will not be readable inside and startup
will fail with "not readable by this process"; change the host file to that
user's uid (`chown <uid>:<uid> /etc/imsda/secret-encryption-key`, mode stays
`0400`), because a bind mount keeps the host's numeric owner. Check with
`docker exec <app> id`.

### One-time steps on the production server (a system administrator does these)

Run as root over SSH. Do not paste the key into chat, a ticket or a shell
history that is shared.

1. Create the file from the key the **running** container actually uses, so the
   copy is byte-for-byte what the app has today (an env file's quoting or
   whitespace can differ from what the app sees), with nothing printed:

```bash
install -d -m 0700 -o root -g root /etc/imsda
( umask 077; docker exec xcloud-site-<id>-app-1 printenv SECRET_ENCRYPTION_KEY | tr -d '\n' > /etc/imsda/secret-encryption-key )
chown root:root /etc/imsda/secret-encryption-key
chmod 0400 /etc/imsda/secret-encryption-key
ls -l /etc/imsda/secret-encryption-key      # expect: -r-------- 1 root root, size not 0
```

   Compare checksums (a hash, not the key). The two lines must be identical:

```bash
sha256sum < /etc/imsda/secret-encryption-key
docker exec xcloud-site-<id>-app-1 printenv SECRET_ENCRYPTION_KEY | tr -d '\n' | sha256sum
```

   If they differ, or the first file is empty, stop: do not continue and never
   generate a new key here, or every sealed value becomes unreadable.

2. Make the two backup copies of the key now (next section), **before** changing
   the running container.

3. Add the mount and variable to `/root/manual-deploy.sh`, on the app container's
   `docker run`, next to the other `-v` and `-e` lines. Use `--mount`, not `-v`:
   with `-v`, Docker silently creates a **directory** at a missing host path, and
   the app then refuses to start (both variables set, or an unreadable key).
   `--mount type=bind` fails the `docker run` with an error instead.

```bash
     --mount type=bind,source=/etc/imsda/secret-encryption-key,target=/run/secrets/encryption-key,readonly \
     -e SECRET_ENCRYPTION_KEY_FILE=/run/secrets/encryption-key \
```

   Do this only after step 1 has produced the file, and do the deploy (step 5)
   right after step 4. Deploying with the key already removed from the env file
   but no mount, or with the mount but the key still in the env file, leaves the
   app unable to start.

   The `imsda-outbox-sweeper` container needs no change (see above).

   **If the site is deployed through the xCloud Compose path** (the
   `docker-compose.env.yml` override and `scripts/xcloud-post-deploy.sh` /
   the runtime guard, "Permanent xCloud Dockerfile-only runtime override" above),
   that path recreates the app with only `.env` and `.env.dburl`, so the same
   mount has to go into the `app` service in
   `/home/u_events/.xcloud/docker-compose.env.yml`. **Do not add it ahead of time:**
   with the key still in `.env` and the file variable in the override, an xCloud
   recreate in between would start the app with both and it would refuse to start.
   Make this edit and the `.env` removal in step 4 together, with the guard paused
   (see "Compose path" under step 4):

```yaml
services:
  app:
    environment:
      SECRET_ENCRYPTION_KEY_FILE: /run/secrets/encryption-key
    volumes:
      - type: bind
        source: /etc/imsda/secret-encryption-key
        target: /run/secrets/encryption-key
        read_only: true
        bind:
          create_host_path: false   # fail if the file is missing; never create a directory
```

   (Merge this into the existing `app:` entry; keep its `env_file`, `APP_RELEASE_SHA`
   and `networks`.) The guard (`scripts/xcloud-post-deploy.sh`) refuses to recreate
   the app when the key is gone from `.env` and the override has no
   `SECRET_ENCRYPTION_KEY_FILE`, and also when **both** are present ("finish the
   move"). It fails a recreated container that has neither key variable and warns
   when a running container has neither. Blank and commented-out lines do not
   count as a key. It checks variable names only, never values.

4. Remove the key line from the env file, keeping a private copy of the old file
   until the deploy is confirmed:

```bash
cp -p /home/u_events/.xcloud/.env /root/env.before-876.bak     # contains the key; delete after step 6
sed -i '/^SECRET_ENCRYPTION_KEY=/d' /home/u_events/.xcloud/.env
grep -c '^SECRET_ENCRYPTION_KEY' /home/u_events/.xcloud/.env   # expect 0
```

   Also remove the variable from the hosting panel if it is stored there, or the
   container will have both and refuse to start.

   **Compose path (xCloud override).** Do the override edit from step 3 and the
   `.env` removal above as one change, with automatic redeploys stopped so nothing
   recreates the app halfway:

```bash
systemctl stop imsda-xcloud-runtime-guard.timer      # if the server-level guard is installed
# Also do not trigger an xCloud deploy until this block is finished.
cp -p /home/u_events/.xcloud/docker-compose.env.yml /root/docker-compose.env.before-876.bak
# 1. edit docker-compose.env.yml: add the environment + bind volume from step 3
# 2. remove the key line from .env (the cp / sed lines above)
docker compose -f /home/u_events/.xcloud/docker-compose.yml -f /home/u_events/.xcloud/docker-compose.env.yml config --quiet && echo config-ok
docker compose -f /home/u_events/.xcloud/docker-compose.yml -f /home/u_events/.xcloud/docker-compose.env.yml up -d --force-recreate app
systemctl start imsda-xcloud-runtime-guard.timer
```

   Then do step 6 (the `docker inspect` line there uses the compose container's
   name from `docker ps`). If the app does not come up healthy, roll back: stop the
   timer again, `cp -p /root/docker-compose.env.before-876.bak
   /home/u_events/.xcloud/docker-compose.env.yml`, restore the key line in `.env`
   from `/root/env.before-876.bak`, run the same `up -d --force-recreate app`
   command, and start the timer. The `--mount`-style failure for a missing file
   shows up here, in the `up` output, rather than as a restart loop.

5. Manual-deploy path: deploy with `/root/manual-deploy.sh` as usual (the rollback steps above still
   apply; the `-old` container still has the key in its own environment, so
   remove it once the new one is confirmed).

6. Confirm:

```bash
T="$(docker exec xcloud-site-239298-app-1 printenv OUTBOX_SWEEP_TOKEN)"; printf 'Authorization: Bearer %s\n' "$T" | curl -s -H @- http://127.0.0.1:8100/api/health | grep -o '"encryptionKey":{[^}]*}'
# expect: "encryptionKey":{"configured":true,"source":"file"}
docker inspect xcloud-site-<id>-app-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -c '^SECRET_ENCRYPTION_KEY='
# expect 0 (only SECRET_ENCRYPTION_KEY_FILE, a path, is listed)
```

   Then sign in as an administrator with MFA: that opens a sealed value, which is
   the real proof the file holds the right key. Once confirmed, delete
   `/root/env.before-876.bak` and the `-old` container.

7. Rollback: the `-old` container still has the key in its own environment and
   works unchanged, so the usual rename-back is enough. Rolling back to an
   **image built before this change** by starting a new container is different:
   older images do not know `SECRET_ENCRYPTION_KEY_FILE`, so put the
   `SECRET_ENCRYPTION_KEY=` line back in `/home/u_events/.xcloud/.env` first (from
   the file, or `/root/env.before-876.bak` if it still exists) and drop the
   `--mount` and `SECRET_ENCRYPTION_KEY_FILE` lines for that run. Move forward
   again with the steps above.

### Keeping and testing the key backup

The file on the server is not a backup. Losing it loses every sealed value for
good.

- Keep **two offline copies**: one entry in the conference password manager, and
  one sealed, printed copy held by the key custodian (not kept at the server).
- **Never** store the key with the database backups (`imsda_events_backups`, the
  off-host copy, #875) or in the same place as anything that can read them. The
  key and the dumps together open everything; apart, neither does.
- When the key is rotated, replace both copies and test again.

**Restore test (once before health records go live, then after any change to the
key or the backup process).** It restores a dump into a scratch database and opens
one sealed value using the *backup copy* of the key, not the server's file. Never
run it against the live database.

1. Fetch the key from the password manager onto the server into a temporary file
   readable only by root, outside the backup volume:

```bash
install -d -m 0700 /root/keytest
umask 077
vi /root/keytest/backup-key      # paste the key from the password manager; save
chmod 0400 /root/keytest/backup-key
```

2. Restore last night's dump into a scratch database and keep it. In the backup
   container (compose) or anywhere with `pg_restore` and the dump:

```bash
docker compose exec -e RESTORE_MODE=server -e RESTORE_KEEP_SCRATCH=true \
  -e RESTORE_SCRATCH_DB=imsda_events_keytest_restore_check \
  backup sh /usr/local/bin/pg-restore-verify.sh
```

   `RESTORE_MODE=server` is needed here: the nightly rehearsal restores into a
   private, throwaway server inside the backup container, but the key test
   needs the scratch database on the real database server so the app image can
   reach it. It needs the backup user to have CREATEDB.

   Check it ends with `restore rehearsal succeeded` and non-zero row counts (a
   failed rehearsal always drops its scratch database; a successful one prints
   the command to drop it). If
   this server's backups are not made by the compose `backup` service, create the
   scratch database by hand (`createdb imsda_events_keytest_restore_check`) and restore
   the dump into it with `pg_restore --no-owner --no-privileges --exit-on-error
   --dbname=imsda_events_keytest_restore_check <dump>`; the next step is the same.

3. Run the key check from a one-off container of the app image, using the backup
   key and the scratch database. Build a temporary owner-only env file from
   `.env.dburl` with the database name changed (the password never appears on a
   command line or in `docker inspect`):

```bash
( umask 077; sed -E 's#^(DATABASE_URL=postgres(ql)?://[^/]+/)[^?]*#\1imsda_events_keytest_restore_check#' \
    /home/u_events/.xcloud/.env.dburl > /root/keytest/db.env )
grep -c 'imsda_events_keytest_restore_check' /root/keytest/db.env     # expect 1

docker run --rm \
  --network postgresql_9kgaw_239292_xcloud-network \
  --env-file /root/keytest/db.env \
  --mount type=bind,source=/root/keytest/backup-key,target=/run/secrets/encryption-key,readonly \
  -e SECRET_ENCRYPTION_KEY_FILE=/run/secrets/encryption-key \
  --entrypoint npm imsda-events:manual-<short-sha> run key:restore-check
```

   The check refuses any database whose name is not `restore_check` or does not
   end in `_restore_check`. It needs only the key and `DATABASE_URL`, not the
   other production secrets.

   Expected: `canary seal and open: ok`, then `opened one sealed value from the
   restored database: ok`, then `PASSED`. The output never contains the key or any
   value. `FAILED: ... could NOT open` means the backup key is not the key that
   sealed that data: stop and find the right key before anything else. To test
   the key alone, add `-- --canary-only` (no database needed).

4. Clean up, then record the date:

```bash
docker compose exec backup psql --dbname=postgres -c 'DROP DATABASE IF EXISTS imsda_events_keytest_restore_check;'
shred -u /root/keytest/backup-key /root/keytest/db.env && rmdir /root/keytest
```

   Record the date and result in the log in `docs/SERVER-SECURITY-CHECKLIST.md`
   (item 3). The System readiness page (#870) does not exist yet; when it does,
   it will show the key status (configured, and loaded from a file or the
   environment) and the date of the last restore test, and this date goes there
   too.

## Message files: storage, the quota and the sweep (#845)

Attachments and pictures staff upload for email live on disk in
`ASSET_STORAGE_DIR/message-files/<eventId>/` (in Compose,
`/app/storage/event-assets/message-files/<eventId>/` on the `imsda_events_assets`
volume), with a row per file in the database. They are included in every backup
of that directory (the nightly assets archive; see `docs/BACKUPS.md`), so a
restore needs the database and the assets volume from the same time.

Three settings, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `MESSAGE_FILE_EVENT_QUOTA_MB` | `200` | The most one event may keep as message files, counting uploads in progress and files waiting to be removed from disk. A positive whole number of MB. |
| `MESSAGE_FILE_SWEEP_GRACE_HOURS` | `72` | How old an unused file must be before the sweep may remove it. Never less than `24`, whatever is set. |
| `MESSAGE_FILE_SWEEP_DELETE` | unset | Exactly `true` lets the scheduled sweep delete. Anything else, or nothing, is a **dry run**: it reports and removes nothing. |

The quota and the grace period are decisions for the organisation, not the
software: the defaults are only a starting point. System management > Email
shows each event's use against the quota and whether the scheduled sweep is in
dry-run or delete mode.

A file is "unused" only when it is older than the grace period and nothing refers
to it: no template version (any status, including old and archived ones), no
announcement, no queued or sent message links it, and no body (template,
announcement, scheduled batch or message snapshot, in any event) names it as a
picture. A file anything refers to is never removed.

**Turning deletion on, step by step (a person does each step):**

1. On the server, run `npm run message-files:sweep`. This is a dry run. It prints
   how many files and bytes would be removed, per event, and lists each file
   (id, event, size, upload time; never a storage path). File names are
   left out because they can be personal; add `--show-names` to print them.
2. Read the report. Anything that should not go means a body or message still
   needs it; fix that first.
3. Either run `npm run message-files:sweep -- --apply` once to delete now, or set
   `MESSAGE_FILE_SWEEP_DELETE=true` and redeploy so the scheduled sweep deletes
   (up to 100 files per run). `--grace-hours=N` on the command changes the grace
   period for one run (still never under 24).

A file's row is deleted first and its bytes after. If the disk delete fails, the
file is kept in a retry list (shown in the System management > Email usage
section) and still counts against its event's quota until the bytes are really
gone. Likewise an interrupted upload leaves a one-hour reservation that counts
against the quota. **Retrying failed byte deletes and clearing expired
reservations happen only in an apply run** (`--apply`, or
`MESSAGE_FILE_SWEEP_DELETE=true` for the scheduled sweep). A dry run reports how
many are waiting but changes nothing, so until an apply run they keep counting
against the event's quota. Deleting an event removes its files as before.

## Backups and restore rehearsals

> Production (the manually started container) runs the backup scheduler as its
> own `imsda-backup` container with an off-site copy to Cloudflare R2 and status
> in `/api/health`: see `docs/BACKUPS.md`. The rest of this section describes
> the Compose `backup` service.

The `backup` service writes PostgreSQL custom-format dumps and
`imsda-assets-*.tar.gz` upload archives to the `imsda_events_backups` volume,
checks that each asset archive is readable, prunes both sets after
`BACKUP_RETENTION_DAYS`, and every `BACKUP_VERIFY_EVERY` runs restores the newest
database dump into a scratch database and prints its row counts.

**Two things still need a decision from you:**

- **Get the dumps off the host.** Bind `imsda_events_backups` to off-host storage,
  or set `BACKUP_OFFSITE_COMMAND` (it receives the dump path as `$1`, e.g.
  `rclone copy $1 remote:imsda-backups`). A dump sitting on the same host as the
  database it came from does not survive losing that host.
- **Read the rehearsal output.** Search the logs for `restore-verify`. A line
  reading `RESTORE REHEARSAL FAILED` means the backups are not proven restorable.

To restore for real, into the live database:

```bash
docker compose stop app
docker compose exec backup pg_restore --dbname=imsda_events --clean --if-exists \
  --no-owner --no-privileges /backups/imsda-events-<stamp>.dump
docker compose start app
```

Restore a matching uploaded-file archive while the app is stopped:

```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh backup -c \
  'find /assets -mindepth 1 -maxdepth 1 -exec rm -rf {} + &&
   tar -xzf /backups/imsda-assets-<stamp>.tar.gz -C /assets'
docker compose start app
```

The database dump and asset archive should come from the same nightly run.

## Default local development is unchanged

For local work you still run only the database and the dev server on the host:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
npm run db:deploy
npm run db:seed
npm run club-forms:sync
npm run dev
```

`club-forms:sync` creates the club form templates (off) and brings them to the
code's version; run it once after `db:seed`, and again after pulling a change to
`modules/club-forms/definitions.ts`. Until it has run, the Club forms admin page
shows "Needs sync" and no form can be turned on.

`form-templates:sync` stores every form template the code defines (#153, #1064):
the seeded Women's Retreat, Camp Meeting and Spring Camporee (versions in
`prisma/seed-data/form-templates/`) and the rest of `formTemplates`, which are
versioned by content. The container entrypoint runs it after the migrations. It
is safe to run any number of times, writes a template only when it is missing or
the code's version is newer, never changes a template whose latest version a
system administrator saved in the app, and never changes an existing event,
registration form or published form version. Until it has run the app builds new
forms from the code's copy of the same templates.

`event-content:sync` stores the seeded event content (#919): the Camp Meeting
meal preset and cancellation rule preset (versions in
`prisma/seed-data/event-content/`). The container entrypoint runs it after the
migrations. It is safe to run any number of times and writes a row only when it
is missing or the code's version is newer. It never changes an existing event,
its meals, its cancellation rules, its lodging or its messages. Until it has
run the app offers the code's copy of the same presets. See
`docs/EVENT-TEMPLATE-CONTENT.md`.
