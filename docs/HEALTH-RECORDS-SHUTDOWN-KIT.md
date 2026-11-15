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
| Key | `SECRET_ENCRYPTION_KEY` and its key version (and the previous key, if a rotation was under way) | The conference password manager only |
| Kit index | This runbook, the commit sha, the backup's file names and checksum, the next keep-until date, and the number of copies under a legal hold (counts and dates only, never names) | With the key in the password manager, and a printed copy with the custodian |

**Together but stored apart.** The kit is one set: every part is needed to open
a copy, and the index says where each part is. The key is never stored with the
image or the backup, on the same drive, in the same account or in the same
folder. Kit storage A and B are conference-owned, encrypted storage that only the
custodian (and a deputy the custodian names in the index) can open.

## 2. At shutdown (the custodian, once)

1. Confirm the key restores: run `npm run key:restore-check` with the key from
   the password manager (`docs/DEPLOY-DOCKER.md`).
2. Let the last daily retention job run, then stop the site.
3. Take the final backup, save the image, write the kit index and store the
   parts as in section 1.
4. Do one practice lookup (section 3) from the kit, not from the old server.
5. Only then delete the server, its disks, and the nightly backups in R2.
6. Record in the kit index the date and who did each step.

## 3. A lookup (the custodian)

A lookup happens only for a reason ADR 0005 already allows (for example an
injury claim), and only the custodian runs it.

1. On a conference computer the custodian controls, restore the final backup
   into a local, empty PostgreSQL database (`docs/BACKUPS.md`, "Restoring from
   R2", pointed at the local database).
2. Start the saved image against that database, reachable from that computer
   only. Load the key from a protected file (`docs/DEPLOY-DOCKER.md`, "Loading
   the encryption key from a protected file"). Leave out the email and payment
   provider settings so the copy cannot send messages or take payments.
3. Sign in with the custodian's own system administrator account and open the
   record through the normal break-glass screen (`/admin/health-access`), with
   a typed reason. The normal permissions apply, and the access log records the
   lookup exactly as it did when the site was live.
4. Take a new backup of the local database, so the access log entry is kept.
   Replace the kit's final backup (both copies) with it and update the index.
5. Stop the site, delete the local database and every working file, and note
   the date and reason in the kit index.

## 4. Deleting records as each keep-until date passes (the custodian)

The custodian, the conference IT lead, deletes the remaining copies. Check the
kit index's next keep-until date at least once a year and on that date.

1. Start the old site locally as in section 3, steps 1 and 2.
2. Run the outbox sweep once (`scripts/outbox-sweep.sh` calls it). It runs the
   same retention job as the live site: it deletes the copies whose keep-until
   date has passed, skips any copy under a legal hold, and writes its counts to
   the audit log.
3. Take a new backup, replace both kit copies, and destroy the older backup
   files. Record the new next keep-until date and hold count in the index.
4. Stop and clean up as in section 3, step 5.

Legal holds are placed and lifted through the same screen, under the existing
ADR 0005 rules. When no copy remains and no hold is open, the custodian
destroys the whole kit (image, backups and key) and records the date in the
password manager entry, which is then the only thing left.

## 5. If the custodian changes

The outgoing custodian hands over the password manager entry and access to kit
storage A and B, the incoming custodian does a practice lookup, and the index
records the handover date. The role stays with the conference IT lead unless the
Communication Director names another role.
