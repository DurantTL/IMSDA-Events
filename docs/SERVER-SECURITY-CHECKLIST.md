# Server security checklist (club rosters and WR26)

The to-do list for the server work that must be finished before **real club
directors enter birth dates** (H2, #356), as required by ADR 0005 Addendum A.
Several items are also WR26 go-live items (`docs/WR26-GO-LIVE-REVIEW.md`, Block 1),
so doing them once covers both.

**In the app:** system administrators can also tick these items, with their name and date, on the
**System readiness** page (`/admin/readiness`), which also shows the checks the app can do itself (#870).
Ticking only records that someone did the work. This sheet remains the full instructions.

**How to use this sheet**

- Each item has an **owner**, a **how**, and a **proof**. It is only done when the
  proof exists.
- When an item is finished, fill in **Done** (date and initials) and add a line to
  the log at the bottom saying where the evidence is kept.
- Never paste the encryption key, passwords, server addresses, or database
  contents into this file, GitHub, or chat. Say *where* something is kept, never
  *what* it is.
- Owners marked *(fill in)* still need a name. Caleb assigns them.

## Status at a glance

| # | Item | Owner | Blocks | Done |
| --- | --- | --- | --- | --- |
| 1 | Build the external, on-premises backup server | Jonathan Swena | 2, 3, 4 | ☐ |
| 2 | Keep a copy of the encryption key, apart from the database dumps | Jonathan Swena | Real birth dates | ☐ |
| 3 | Test-restore the key copy | Jonathan Swena | Real birth dates | ☐ |
| 4 | Send nightly database backups off the host | Server operator *(fill in)* | Real birth dates, WR26 | ☐ |
| 5 | Confirm an unattended restore rehearsal passes | Server operator *(fill in)* | Real birth dates, WR26 | ☐ |
| 6 | Confirm the database is reachable only from the app | Server operator *(fill in)* | Real birth dates | ☐ |
| 7 | Confirm HTTPS end to end | Server operator *(fill in)* | Real birth dates | ☐ |
| 8 | Confirm MFA for everyone who can see club data | Caleb Durant | Real birth dates | ☐ |
| 9 | Write the key rotation procedure | Jonathan Swena | Before the first rotation | ☐ |
| 10 | Tell club directors how removal works | Caleb Durant | Director onboarding | ☐ |
| 11 | Lock down how the encryption key is reached | Jonathan Swena | Real birth dates | ☐ |

## The items

### 1. Build the external, on-premises backup server
- **Why:** it holds the encryption key copy (item 2) and can receive the
  database backups (item 4). Decided: external and on-premises, not a cloud
  service.
- **How:** a machine that does not live on the same host as the events server,
  with disk encryption, a strong login, and only the people who need it having
  access.
- **Proof:** the server exists, and the owner has written down who can log in to
  it.

### 2. Keep a copy of the encryption key, apart from the database dumps
- **Why:** birth dates are encrypted with `SECRET_ENCRYPTION_KEY`. If the key is
  lost, every birth date is lost for good. If the key sits next to the database
  dumps, anyone who takes both can read everything.
- **How:** make two offline copies of the production key: one entry in the
  conference password manager, and one sealed printout held by the key
  custodian. Neither may sit with the database dumps (item 4, #875) or on any
  machine that can read them. If a copy is also kept on the backup server
  (item 1), it goes in a separate, access-restricted place from the dumps. The
  steps are in "Keeping and testing the key backup" in `docs/DEPLOY-DOCKER.md`.
  Record *where* each copy is, never the value.
- **Proof:** the custodian confirms the copy exists and matches (compare a
  checksum, never the key itself on screen or in chat).

### 3. Test-restore the key copy
- **Why:** a backup that has never been restored is not a backup.
- **How:** restore the latest database dump into a scratch database and run
  `npm run key:restore-check` with the key from the backup copy (never the
  server's file) to open one sealed value. Exact commands: "Keeping and testing
  the key backup" in `docs/DEPLOY-DOCKER.md`. It prints pass or fail only, never
  the key or a value. Record the date here and on the System readiness page
  (#870). Test once before health records go live.
- **Proof:** date of the test and its result, in the log below.

### 4. Send nightly database backups off the host
- **Why:** backups already run nightly (`backup` service in
  `docker-compose.yml`), but they land on the same server as the database. They
  won't survive losing that server. (WR26 finding F5.)
- **How:** set `BACKUP_OFFSITE_COMMAND` in the server's environment so each dump
  is copied to the backup server (item 1), for example with `rsync` or `scp`
  over SSH. See `docs/DEPLOY-DOCKER.md`. The dumps are not encrypted by the
  backup script, so the destination must be encrypted and access-restricted.
- **Proof:** a dump from the last 24 hours is on the backup server.

### 5. Confirm an unattended restore rehearsal passes
- **Why:** the backup service restores into a scratch database every few runs to
  prove the dumps work.
- **How:** read the `backup` container logs for `restore-verify`. A line reading
  `RESTORE REHEARSAL FAILED` means the backups are not proven.
- **Proof:** the date of a passing rehearsal, in the log below.

### 6. Confirm the database is reachable only from the app
- **Why:** the database should never be reachable from the internet.
- **How:** in production, PostgreSQL runs inside Docker's private network, and
  `docker-compose.yml` does not publish port 5432. Confirm that the
  development override file (`docker-compose.dev.yml`) is not loaded on the
  server, and that no firewall rule opens 5432.
- **Proof:** from a computer outside the server, a connection to port 5432 on
  the server's address fails.

### 7. Confirm HTTPS end to end
- **Why:** directors sign in and view minors' details over the web.
- **How:** the reverse proxy serves the site only over HTTPS with a valid
  certificate and redirects plain HTTP. The app and database talk on the
  server's private Docker network, never over the internet.
- **Proof:** the site shows a valid certificate, and `http://` redirects to
  `https://`.

### 8. Confirm MFA for everyone who can see club data
- **Why:** full birth dates are visible only to that club's directors and system
  administrators (ADR 0005 Addendum A). Both must use MFA.
- **How:** system administrators already need MFA. H2 makes a director turn on
  MFA before the roster opens. Before launch, check that every system
  administrator account has MFA set up.
- **Proof:** the list of system administrators, each with MFA on.

### 9. Write the key rotation procedure
- **Why:** if the key is ever exposed, it must be replaced without losing data.
- **How:** a short written procedure: keep the old and new keys available, run
  the re-seal step, confirm, then retire the old key and update the backup copy
  (item 2). The engineering side of the re-seal step is built when it's first
  needed.
- **Proof:** the procedure is written and kept with the key copy.

### 10. Tell club directors how removal works
- **Why:** retention is each club's decision. Nothing is deleted automatically.
- **How:** in director onboarding, explain the difference:
  - **Deactivate** keeps the person for later years (for example, members who
    become staff).
  - **Remove** erases their birth date and personal details.
- **Proof:** the onboarding note or email is sent.

### 11. Lock down how the encryption key is reached
- **Why:** the question was whether the key should sit behind a separate login
  account or inside SSH, whichever is more secure to set, reach, rotate, and
  manage. The answer is **both, in layers**: SSH is the only way in, and a
  separate account owns the key. Today the key sits in
  `/home/u_events/.xcloud/.env` (mode 600) together with every other
  production secret (`docs/DEPLOY-DOCKER.md`). So anyone who can log in as the
  site user, or reveal environment variables in the hosting panel, can read it,
  and it shows in `docker inspect`. #876 moves it to a root-only file,
  `/etc/imsda/secret-encryption-key` (root, mode 0400), mounted read-only into the
  app container and named by `SECRET_ENCRYPTION_KEY_FILE`. The exact steps are in
  "Loading the encryption key from a protected file" in `docs/DEPLOY-DOCKER.md`;
  once done, the env file and the panel no longer hold the key. The app container
  runs as root (the `Dockerfile` has no `USER`), so root-owned 0400 is readable;
  recheck this if a `USER` is ever added.
- **Recommended setup** (the custodian adapts it to the host):
  1. **Only SSH, with keys.** Log in to the server by SSH key only. Turn off
     password login. Give access only to the named people on item 1's list.
  2. **The key isn't shown in a web panel.** If the hosting panel (xCloud) can
     display environment variables, anyone with a panel login can read the
     key. Keep the key out of the panel and in the server file only, or, if the
     panel must hold it, require MFA on every panel login and limit panel access
     to the same named people.
  3. **A separate account for the master copy.** The master copy of the key
     lives on the backup server (item 2) under an account used only by the
     custodian. It is not the account that receives the database dumps
     (item 4).
  4. **The app never shows or changes the key.** There's no admin screen for
     it, on purpose. Setting and rotating it are server tasks done over SSH,
     following item 9. Nobody should ever be able to read it back through the
     app.
  5. **The daily "touch" job must keep running.** The host's 30-day cleanup
     deletes `.xcloud/.env` unless the touch job in `docs/DEPLOY-DOCKER.md`
     keeps it fresh. Losing that file loses the running copy of the key. The
     backup copy (item 2) is what makes that recoverable.
  6. **Never paste it** into chat, email, tickets, GitHub, or screenshots.
     Compare checksums, never the value.
- **What changing the key breaks:** it seals authenticator (MFA) secrets and
  club roster birth dates. If it's changed without the re-seal procedure
  (item 9), every roster birth date is lost and everyone must set up MFA again.
  Any future health records would be sealed with it too
  (`docs/HEALTH-RECORDS-OPTIONS-REPORT.md`).
- **Proof:**
  - the custodian records who has SSH and panel access to the production
    server;
  - password login is off;
  - the panel either doesn't hold the key or requires MFA;
  - the master copy's account is separate from the backup account;
  - `/etc/imsda/secret-encryption-key` is `root:root` mode 0400, the env file and
    panel have no `SECRET_ENCRYPTION_KEY`, and `/api/health` (read with the token-from-the-container command next to `APP_RELEASE_SHA` in `docs/DEPLOY-DOCKER.md`) shows
    `"encryptionKey":{"configured":true,"source":"file"}`.

## Behind Cloudflare

`events.imsda.org` is served through Cloudflare, with xCloud's Nginx on the
server behind it. These three steps make sure Cloudflare's protection can't be
skipped and that the app's rate limits see each visitor's real address. Do them
in this order: the rate-limit setting in step C is only safe after step A.

The reasons are in `docs/CLOUDFLARE-SECURITY-AUDIT-2026-10.md` (findings 2 and
3, and the recommended settings table). As with the rest of this sheet, never
write the server's address, firewall rules or certificate files into this file,
GitHub or chat.

| Step | What | Done |
| --- | --- | --- |
| A | Only Cloudflare can reach the server | ☐ |
| B | SSL/TLS mode is Full (strict) | ☐ |
| C | Rate-limit settings match Cloudflare | ☐ |

### A. Only Cloudflare can reach the server

- **Why:** if someone learns the server's address, they can skip Cloudflare
  and talk to Nginx directly. That skips Cloudflare's firewall and bot rules.
  It also lets them write any visitor address they like into the header the
  app trusts, which defeats the app's per-visitor limits (step C).
- **Choose one of these two.** Both block ordinary visitors who skip
  Cloudflare. Neither can tell our Cloudflare account from someone else's: a
  person with their own Cloudflare account could still route traffic to this
  server. That leftover risk is small, and we accept it for now. A custom
  origin-pull certificate for our zone (ask xCloud support) or Cloudflare
  Tunnel would close it.

**Option 1: firewall allowlist (recommended to start).**

1. Open Cloudflare's published address list:
   `https://www.cloudflare.com/ips/`. It has an IPv4 list and an IPv6 list.
2. In the server firewall (or xCloud's firewall screen for this server), allow
   ports **80** and **443** only from the addresses on both lists. Block 80 and
   443 from everywhere else.
3. Don't touch the SSH rule. Changing it could lock everyone out.
4. If other websites run on the same server, they are blocked from direct
   visits too. Check each one is also behind Cloudflare first.
5. Put a reminder on the calendar to compare the firewall with Cloudflare's
   list every three months. Cloudflare adds addresses occasionally, and a
   missing one means some visitors get errors.

- **Trade-offs:** no change to Nginx, and xCloud's panel or support can usually
  do it. But the list must be kept up to date by hand.

**Option 2: Authenticated Origin Pulls.** Cloudflare shows a certificate on
every request, and Nginx refuses any request without it.

1. Cloudflare dashboard → select the `imsda.org` zone → **SSL/TLS** →
   **Origin Server** → turn **Authenticated Origin Pulls** on. Nothing changes
   for visitors yet.
2. Ask xCloud support to make this site's Nginx require Cloudflare's
   origin-pull client certificate (the `ssl_client_certificate` and
   `ssl_verify_client on` lines, using the certificate from Cloudflare's
   Authenticated Origin Pulls page). Do step 1 before this step, or the site
   goes down until Cloudflare starts sending the certificate.
3. After xCloud confirms, open `https://events.imsda.org` and check it loads.

- **Trade-offs:** nothing to keep up to date by hand, but it needs an Nginx
  change only xCloud can make, and xCloud's own config updates could undo it.
  If it's undone, the site still works but the lock is gone silently, so
  recheck after any xCloud change to the site.

**For either option:**

- In Cloudflare **DNS**, the `events` record must show the orange cloud
  (**Proxied**). Check that no grey-cloud (**DNS only**) record points to the
  same server, because that would reveal its address.
- A third choice, **Cloudflare Tunnel**, is the strongest but the biggest
  change (a connector on the server and no public 80 or 443). It's described
  in the audit, finding 3.

- **Proof:** from a computer outside the server, a direct request to the
  server's address (not through `events.imsda.org`) is refused or times out,
  and `https://events.imsda.org` still loads. Record the date and which option
  was used in the log below, never the address.

### B. SSL/TLS mode is Full (strict)

- **Why:** it makes Cloudflare check the server's certificate, so the
  connection from Cloudflare to the server is encrypted and can't be
  impersonated. Never use **Flexible**: it sends traffic to the server
  unencrypted.
- **How:**
  1. Make sure the server has a valid certificate for `events.imsda.org`:
     xCloud's Let's Encrypt certificate, or a **Cloudflare Origin
     Certificate** (Cloudflare dashboard → **SSL/TLS** → **Origin Server** →
     **Create Certificate**, then give it to xCloud support to install).
  2. Cloudflare dashboard → `imsda.org` zone → **SSL/TLS** → **Overview** →
     set the encryption mode to **Full (strict)**.
  3. Open `https://events.imsda.org`. If it shows Cloudflare error 526, the
     server's certificate isn't valid: switch back to **Full** for the moment
     and ask xCloud to fix the certificate, then try again.
- **Proof:** the mode shows **Full (strict)** and the site loads.

### C. Rate-limit settings match Cloudflare

- **Why:** the app limits how often one visitor can try to sign in or
  register. Behind Cloudflare, the wrong settings make every visitor who
  shares a Cloudflare server look like one person, so a busy registration
  opening can lock out real families. Settings that trust too much let an
  attacker get around the limits.
- **How:** **do step A first.** Then, in the xCloud environment panel for this
  site, set exactly this pair:

  ```
  RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip
  RATE_LIMIT_TRUSTED_PROXY_HOPS=1
  ```

  The app then reads each visitor's address from the `CF-Connecting-IP` header
  Cloudflare sets. The hops value must be `1`: `0` turns the lookup off and
  puts every visitor in one shared limit, and `2` or more stops the app from
  starting with this header. The compose default
  (`x-forwarded-for` with hops `1`) is right only with no Cloudflare in front.
  Redeploy after saving. See also "Rate limits behind Cloudflare" in
  `docs/DEPLOY-DOCKER.md`.
- **Proof:** the two-network test in `docs/WR26-GO-LIVE-REVIEW.md` (finding F1,
  step 3) passes: test registrations from one network don't block a second
  network. Use a test event, and delete the test registrations afterwards.

## Log

| Date | Item | What was done | Evidence kept at | Initials |
| --- | --- | --- | --- | --- |
| | | | | |
