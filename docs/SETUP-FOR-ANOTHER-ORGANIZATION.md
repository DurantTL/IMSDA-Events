# Setting up your own copy (for another organization)

This guide takes a technical volunteer at another conference or ministry from
an empty server to a working copy of this app. It describes the app as it is on
`main`. It does not promise switches that do not exist.

**Permission first.** This repository has no license file, and the package is
marked private. Another organization needs the Iowa-Missouri Conference's
permission before running or changing a copy. To ask, open an issue on this
repository on GitHub.

This guide gives the steps in order and links to the longer runbooks for depth.
The main runbook is [`DEPLOY-DOCKER.md`](DEPLOY-DOCKER.md). It was written for
the conference's own host, so skip anything in it that names xCloud or
`ghcr.io`.

## Before you start (what you need)

- A Linux server you control, with Docker Engine and the Docker Compose plugin.
  The conference's server has 4 GB of memory. Building the image there takes a
  long time, so give yours more if you can.
- A domain name and a way to serve it over HTTPS. The app does not do HTTPS
  itself. A reverse proxy (nginx, Caddy or similar) must forward your domain to
  the app's port (`APP_PORT`, default `3100`).
- An email service for account email: Resend or Amazon SES (see Email).
- Optional: a Square account if you will take card payments (see Payments).
- A person who can keep secrets safe and make backups. Several secrets cannot
  be recovered if lost.

You do not need Node.js on the server. The Docker image builds the app.

## Install

1. Clone the repository onto the server and go into the folder.
2. Copy the example settings file: `cp .env.example .env`.
3. Fill in the required settings (next section). Docker Compose reads `.env` in
   this folder.
4. Build and start everything:

   ```bash
   docker compose up -d --build
   ```

   `docker-compose.yml` starts four services: `postgres` (the database), `app`,
   `outbox-sweeper` (retries email that failed its first try) and `backup`
   (nightly database and upload backups).
5. On every start the `app` container runs `prisma migrate deploy`, then the
   template sync scripts, then starts the web server. The first start can take
   several minutes. Watch it with `docker compose logs -f app`.
6. Point your reverse proxy at `APP_PORT` and check the site:

   ```bash
   docker compose ps
   curl --fail https://your-domain/api/health
   ```

   The public answer shows `status` and the database check.

If the app stops at startup, the message names the setting that is wrong. See
"Troubleshooting a failed deploy" in `DEPLOY-DOCKER.md`.

Do not run `npm run db:seed` on a real site. It writes made-up demo people and
payments with a shared password, and it refuses to run on a real database.

## Required settings

Put these in `.env`. The app refuses to start in production without them.

| Setting | What to put |
| --- | --- |
| `APP_BASE_URL` | Your final public HTTPS address, with no path. It is written into emailed links. |
| `POSTGRES_PASSWORD` | A new database password. Use `openssl rand -hex 32`. |
| `MANAGE_LINK_DERIVATION_SECRET` | 32 or more random characters. |
| `ATTENDEE_PASS_SIGNING_SECRET` | 32 or more random characters. |
| `RATE_LIMIT_HASH_SECRET` | 32 or more random characters. |
| `OUTBOX_SWEEP_TOKEN` | 32 or more random characters. |
| `SECRET_ENCRYPTION_KEY` | 32 or more random characters. |
| `ACCOUNT_EMAIL_SENDER_ADDRESS` | An address verified with your email service. |
| `RESEND_API_KEY` | Needed when `EMAIL_PROVIDER` is `resend` (the default). |

Make each secret with `openssl rand -base64 48`. Use a different value for
each one. Never reuse the conference's values or commit your `.env`.

Also set these:

- `EMBED_ALLOWED_ORIGINS`: the websites allowed to frame your public forms. The
  default in `.env.example` and `docker-compose.yml` lists the conference's
  sites. Replace it with your own, for example `'self' https://example.org`.
- `ACCOUNT_EMAIL_SENDER_NAME`: the name on account email. The default is not
  your organization's name.

Changing `APP_BASE_URL`, `EMBED_ALLOWED_ORIGINS` or the Square environment needs
`docker compose up -d --build`. A restart is not enough.

**Back up `SECRET_ENCRYPTION_KEY` somewhere separate from the database
backups.** Changing or losing it makes every enrolled authenticator unreadable.
`DEPLOY-DOCKER.md` ("Loading the encryption key from a protected file") covers
keeping it in a root-only file, and `BACKUPS.md` explains why it is kept apart.

Leave `HEALTH_RECORDS_ENABLED` as `false`. Real health records stay switched off
until the conference's decision on them is accepted.

## First administrator

A new database has no users and no sign-up screen. Create the first system
administrator from the server:

```bash
docker compose exec app npm run admin:create -- \
  --email you@example.org --name "Your Name"
```

It prints a one-time activation link. Open it and choose a password. The link
is shown once and expires after seven days.

If account email is not working yet, set the password directly instead:

```bash
docker compose exec -e IMSDA_ADMIN_PASSWORD='<a long passphrase>' app \
  npm run admin:create -- --email you@example.org --name "Your Name" \
  --password-from-env
```

This account can sign in at once. Change the password later and clear the
variable. System administrators must also enrol a second factor (an
authenticator app) the first time they sign in.

Invite colleagues from **People & access** (`/admin/team`). If an administrator
loses their authenticator and recovery codes, use
`docker compose exec app npm run admin:reset-mfa -- --email them@example.org`.

## Platform settings

Sign in and open **Platform settings** (`/admin/settings`). Only system
administrators can see it. Set:

1. **Organization**: name, logo URL and public website.
2. **New event defaults**: default timezone, for example `America/Chicago`.
3. **Homepage help contact**: help phone and email.
4. **Email header and footer**: header names and footer help email and phone.
5. **Invoice PDF header**: the lines at the top of invoices.
6. **Technical settings**: the passkey domain (your site's domain with no
   `https://`). Leave it blank to keep passkeys off.
7. **Homepage ministries**: the six tiles on the public homepage. The defaults
   are the conference's ministry names. Rename or relink them.

Then open **System readiness** (`/admin/readiness`) and **System report**
(`/admin/system-report`). The readiness page lists what a person must confirm.
The report shows each connection and has a "How to set this up" panel on each
row that is not configured.

## Using only the events side

There is no switch that turns off the club ministry side for the whole site.
Today, to use only events:

- Do not give anyone the Clubs Administrator, Youth Administrator or Area
  Coordinator role, or a club director role. Do not create entries under **Clubs and churches**
  (`/admin/organizations`). Staff see club menus by role, so people without
  those roles do not see them. A system administrator holds every role and sees
  the club areas too.
- Create events from `/event-setup`. Each event has a **Features** page
  (`/more/features`) where an event's optional features are switched on or off.
  See [`EVENT-FEATURES.md`](EVENT-FEATURES.md).
- What cannot be hidden: the public header still shows a **Club ministry**
  link, and the club pages still exist at `/clubs`.

## Using only the club ministry side

There is no switch that turns off events either. Club event registration, club
orders and visiting clubs all depend on an event, so events still exist
underneath. Today, to use only club ministry:

- Create the events that clubs register for. If you do not want public
  registration, keep them unpublished and off the public calendar. Both are set
  on the event's Features page (`/more/features`).
- Add clubs and churches under **Clubs and churches** (`/admin/organizations`)
  and give the Clubs Administrator role from **People & access**.
- Each club can switch on optional tools in its own Club settings. All are off
  by default. The list is in `modules/club-features/domain.ts`.
- What cannot be hidden: the public header still shows Events and Calendar
  links.

## Email

Account email (activation and password reset) is required. Pick one provider
with `EMAIL_PROVIDER`:

- **Resend** (the default, `resend`): set `RESEND_API_KEY`. For delivery
  reports, add a webhook to `<APP_BASE_URL>/api/webhooks/resend` and set
  `RESEND_WEBHOOK_SECRET`.
- **Amazon SES** (`ses`): set `SES_REGION`, `SES_SMTP_USERNAME` and
  `SES_SMTP_PASSWORD`. Bounce reports are optional. See "Sending email through
  Amazon SES" in `DEPLOY-DOCKER.md`.

Verify the sender address (`ACCOUNT_EMAIL_SENDER_ADDRESS`) with your provider
first. Event email settings (sender name, address, reply-to) are on **Email**
(`/admin/email`). A new event starts on local capture, so no registrant gets
email until someone turns real delivery on for that event.

The System report has an email test card. Use it before you invite anyone.

## Payments

The app runs with payments not set up. Registration works for free events
without them. Square is the only payment provider.

1. Create a Square application. Copy the sandbox Application ID, access token
   and Location ID.
2. Set `SQUARE_APPLICATION_ID`, `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID`.
   Leave `SQUARE_ENVIRONMENT=sandbox` (the default).
3. In Square, add a webhook to `<APP_BASE_URL>/api/webhooks/square`. Set
   `SQUARE_WEBHOOK_NOTIFICATION_URL` to the same address exactly, and
   `SQUARE_WEBHOOK_SIGNATURE_KEY` to the key Square gives you.
4. Rebuild, then test a payment in the sandbox end to end.
5. Going live is a separate, deliberate step. It needs your production
   credentials, `SQUARE_ENVIRONMENT=production`, `SQUARE_ENABLE_PRODUCTION=true`,
   and a production `SQUARE_API_URL` (the default points at the sandbox).
   Do it only after your sandbox test passes.

Square's setup steps are also in the System report ("How to set this up").

Optional extras, all off until you set their values: Cloudflare Turnstile on
public forms (`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, see
[`TURNSTILE.md`](TURNSTILE.md)), Google sign-in for registrants
(`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`), church map
locations (`GEOCODING_ENABLED`), and a key vault for personal data
(`DATA_KEY_SOURCE`; see `DATA-KEY-AZURE-KEY-VAULT.md`).

## Backups and monitoring

- The `backup` service in `docker-compose.yml` writes a nightly database dump and
  an archive of uploaded files to the `imsda_events_backups` volume, and
  rehearses a restore. **That volume is on the same server.** Either bind it to
  storage on another machine or set `BACKUP_OFFSITE_COMMAND`.
- Read the `restore-verify` lines in `docker compose logs backup`. A line
  reading `RESTORE REHEARSAL FAILED` means the backups are not proven.
- Back up `SECRET_ENCRYPTION_KEY` separately (see Required settings).
- Do not run `docker compose down --volumes`. It erases the database, uploads
  and on-server backups.
- For alerts, set `ALERT_WEBHOOK_URL` (a Slack or Teams incoming webhook). Point
  an uptime monitor at `/api/health`.

Depth: [`BACKUPS.md`](BACKUPS.md) (written for the conference's host, so adapt
its R2 steps), [`MONITORING.md`](MONITORING.md), and
[`SERVER-SECURITY-CHECKLIST.md`](SERVER-SECURITY-CHECKLIST.md). Do the security
checklist before real club directors enter birth dates.

## Check it worked

1. `docker compose ps` shows all four services running and `app` healthy.
2. `https://your-domain/api/health` answers `status` ok with the database ok.
3. You are signed in as a system administrator with a second factor enrolled.
4. **Platform settings** shows your organization's name and contacts.
5. The System report email test arrives in a real inbox, with links to your
   domain and not `localhost`.
6. **System readiness** shows no unexplained failures.
7. Create a test event, register for it from a private browser window, and
   confirm the confirmation email and the link in it work.
8. If you set up Square: complete a sandbox payment and see it recorded.
9. Look in `docker compose logs backup` for a finished backup.

## What is still specific to the Iowa-Missouri Conference

Today the app is not fully rebranded. Expect these:

- **Wording in code.** About 120 places say "IMSDA", and the product name
  ("IMAdventist") is set in `lib/brand.ts`. A request to let Platform settings
  change branding everywhere is tracked in issue
  [#2026](https://github.com/DurantTL/IMSDA-Events/issues/2026). Until then,
  changing it means editing the code and rebuilding.
- **Content loaded on every start.** The `app` container's entrypoint runs
  `npm run club-forms:sync`, `lodging:sync`, `form-templates:sync`,
  `event-content:sync` and `conference-supplies:sync`. They add the Camp
  Heritage and Sunnydale lodging templates, the Women's Retreat, Camp Meeting
  and Spring Camporee form templates, the Camp Meeting meal and cancellation
  presets, the club form templates and the conference's club supplies. They
  add or update their own rows only, and run again on each start. Treat them as
  examples you can ignore, not content you can remove today.
- **Fallback contact addresses.** Some screens and emails fall back to
  conference addresses at `imsda.org` when you have not set your own. Set the
  contacts in Platform settings and check what a registrant sees.
- **Embed origins** (see Required settings) and the repository variables in
  `.github/workflows/docker-image.yml` name the conference's sites.
- `deploy/xcloud/` and the `ghcr.io/duranttl` image are for the conference's
  host. Build your own image with `docker compose up -d --build`.

## Getting updates

1. Check the repository for new commits and read the changes. Only deploy a
   commit whose GitHub checks passed.
2. On the server: `git pull`, then `docker compose up -d --build`.
3. The `app` container applies new database migrations on start. Take a backup
   before every update.
4. If a new required setting appears, the app names it at startup. Compare
   your `.env` with the new `.env.example`.
5. If you changed code (for example branding), merge each update into your
   changes yourself.

To move to a new server, see "Moving to a clean server and a new URL" in
`DEPLOY-DOCKER.md`.
