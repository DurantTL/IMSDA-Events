# Health records shutdown kit (#1550)

What to do with the sealed health copies if the events site is ever retired.
Decided by the Communication Director on 2026-11-12: a written kit, no new
software (ADR 0005, Addendum H). The **conference IT lead** is the custodian
(named 2026-11-14). Nothing here is needed while the site is running.

**Why a kit is needed.** ADR 0005 keeps a sealed copy of a member's health form
for each event attended until its keep-until date, or longer under a legal hold.
Those copies must stay openable after the site stops, and the daily retention
job that deletes expired copies stops when the site stops. The kit keeps the
copies openable and names who deletes them.

## 1. What is in the kit

| Part | What it is | Where it is kept |
| --- | --- | --- |
| Site image | The last production image (`ghcr.io/duranttl/imsda-events:<commit sha>`), saved to a file with `docker save`, plus the commit sha | Kit storage A |
| Final backup | The final database dump and asset archive (`docs/BACKUPS.md`), taken after the site stopped taking changes | Kit storage A, and a second copy in kit storage B |
| Key | `SECRET_ENCRYPTION_KEY` and its key version (and the previous key and version, if the final backup was taken during a rotation) | The two offline copies `docs/DEPLOY-DOCKER.md` already requires ("Keeping and testing the key backup"): the conference password manager and a sealed printed copy held by the custodian |
| Kit index | This runbook, the commit sha, the backup's file names and checksum, the next keep-until date, and the number of copies under a legal hold (counts and dates only, never names) | In the password manager entry, and a printed copy with the custodian |

**Together but stored apart.** The kit is one set: every part is needed to open
a copy, and the index says where each part is. The key is never stored with the
image or the backup, on the same drive, in the same account or in the same
folder. Kit storage A and B are conference-owned, encrypted storage that only the
custodian (and a deputy the custodian names in the index) can open.

## 2. At shutdown (the custodian, once)

1. Confirm the custodian and the deputy each have a system administrator account
   on the site with a working second sign-in factor (break-glass is limited to
   system administrators). Record the account emails in the index.
2. Confirm the last sweep recorded its "Sealed health copies" counts on the
   System report, then stop the site.
3. Take the final backup, save the image, write the kit index and store the
   parts as in section 1.
4. Run the key restore test against the final dump, using the key from the
   password manager: restore the dump into a scratch database whose name ends in
   `_restore_check` and run `npm run key:restore-check` from the saved image
   (`docs/DEPLOY-DOCKER.md`, "Keeping and testing the key backup").
5. Do one practice lookup (section 3) from the kit, not from the old server.
6. Only then delete the server, its disks, and the nightly backups in R2.
7. Record in the kit index the date and who did each step.

## 3. A lookup (the custodian)

A lookup happens only for a reason ADR 0005 already allows (for example an
injury claim), and only the custodian runs it.

1. On a conference computer the custodian controls, create an empty local
   PostgreSQL database and restore the final dump into it with `pg_restore
   --no-owner --no-privileges`. The asset archive is not needed for a lookup.
2. Start the saved image against that database, published on `127.0.0.1` only
   (for example `-p 127.0.0.1:3000:3000`) so no other machine can reach it.
   - Load the key from a protected file (`docs/DEPLOY-DOCKER.md`, "Loading the
     encryption key from a protected file"), with the same key version.
   - Set `HEALTH_RECORDS_ENABLED=true`; opening a copy needs it.
   - Leave out the email and payment provider settings so the copy cannot send
     messages or take payments.
3. Sign in with the custodian's own system administrator account and open the
   record through the normal break-glass screen (`/admin/health-access`), with
   a typed reason. The normal permissions apply, and the access log records the
   lookup exactly as it did when the site was live. If the second factor is
   lost, the documented `admin:reset-mfa` or `admin:create` commands
   (`docs/DEPLOY-DOCKER.md`) run inside the local container.
4. Take a new backup of the local database, so the access log entry is kept.
   Replace the kit's final backup (both copies) with it and update the index.
5. Stop the site, delete the local database and every working file, and note
   the date and reason in the kit index.

## 4. Deleting records as each keep-until date passes (the custodian)

The custodian, the conference IT lead, deletes the remaining copies. Check the
kit index's next keep-until date at least once a year and on that date.

1. Start the old site locally as in section 3, steps 1 and 2, also setting
   `OUTBOX_SWEEP_TOKEN` (32 or more random characters). Deletion works with
   `HEALTH_RECORDS_ENABLED` on or off.
2. Call the sweep once by hand: `curl -X POST -H "Authorization: Bearer
   <token>" http://127.0.0.1:3000/api/internal/outbox/sweep`. (Do not start
   `scripts/outbox-sweep.sh`; it repeats every five minutes.) The sweep runs the
   same retention job as the live site: it deletes the copies whose keep-until
   date has passed and skips any copy under a legal hold. Other sweep steps that
   need email or payment providers report failures; that is expected.
3. Confirm the result: the "Sealed health copies" row on the System report (or
   the `HEALTH_SNAPSHOT_RETENTION_RUN` audit entry) shows how many were deleted
   and how many were skipped for a hold.
4. Take a new backup, replace both kit copies, and destroy the older backup
   files. Record the new next keep-until date and hold count in the index.
5. Stop and clean up as in section 3, step 5.

Legal holds are placed and lifted through the same screen, under the existing
ADR 0005 rules. When no copy remains and no hold is open, the custodian
destroys the whole kit (image, backups and both key copies) and records the
date in the password manager entry, which is then the only thing left.

## 5. If the custodian changes

The outgoing custodian hands over the password manager entry, the printed key
copy and access to kit storage A and B; the incoming custodian does a practice
lookup, and the index records the handover date. The role stays with the
conference IT lead unless the Communication Director names another role.
