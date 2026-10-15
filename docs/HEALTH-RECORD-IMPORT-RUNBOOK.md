# Health record import runbook (#878)

How a system administrator brings the 2026 **Pathfinder Health Record** entries
from Cognito Forms into the encrypted Health tab (#611), so parents don't refill
them. The import stays available: run it for a club that moves over later, a late
batch of forms, or another export in the same format. Each run is the same
preview-then-apply steps.

**Running this against production is a production import of medical data.** Only
a human approves and runs it (`AGENTS.md`). Automation builds and tests the
tooling with synthetic files only and never runs it on real data.

## Before you start

- `HEALTH_RECORDS_ENABLED=true` and the encryption key (`SECRET_ENCRYPTION_KEY`,
  backed up) are set. With the feature off the page does not exist.
- You are a **system administrator**. Nobody else can preview or apply, and an
  administrator acting as a director cannot.
- You have read and confirmed the health information privacy notice once. The
  import page shows it first if you haven't.
- The clubs being imported already exist and have **this club year's roster**.
  The import matches against the current roster only. Import the club roster
  (`docs/CLUB-IMPORT-RUNBOOK.md`) or have the director add members first.
- Take a database backup first (`docs/BACKUPS.md`), as for any production import.

The import never needs anyone to open a club's Health tab, so it stays inside the
break-glass-only rule for system administrators (ADR 0005 Addendum B). It writes
sealed records and never opens a stored health value (roster birth dates are
decrypted in memory for matching only).

## 1. Export from Cognito Forms

Entries for **Pathfinder Health Record** → Export → **Excel** (all three sheets in
one workbook), or CSV for each sheet. Keep the file on your computer only. Don't
email it, post it in an issue, or paste it into a chat.

The sheets are:

| Sheet | Holds |
| --- | --- |
| `PathfinderHealthRecord` | one row per form entry |
| `EmergencyContactsAndAuthorizedP` | several rows per entry, joined on `PathfinderHealthRecord_Id` |
| `CopyOfInsuranceCard` | file details only, joined the same way |

For CSV, choose the entries file and, with it, the other two files. The importer
recognises each sheet by its column names, so file names don't matter. The
entries sheet is required; the other two are optional.

## 2. Preview

System administration → Clubs and churches → **Import health records**. Choose the
file or files and press **Preview the import**.

The file is read in memory and never stored. The preview lists, for each entry,
the member's name, the club, a result, and which sections are on the form (for
example "allergies ✓, insurance ✓"). **It never shows a medical value.**

| Result | Meaning | What happens on Apply |
| --- | --- | --- |
| Matched | Exactly one member of the club's current roster has this first and last name **and** either the same birth date or the parent's email on their guardian contacts. If both birth dates are present and differ, it is never a match, even when the parent's email agrees (it can be a sibling's form) | Imported |
| Needs check | More than one club or member fits, or the name fits but neither birth date nor parent email confirms it, or the birth date differs | Not imported. Fix the roster (birth date, guardian email) and run again, or let the parent refill |
| Not matched | No club matches the church and club name on the form, or nobody with that name is on the roster | Not imported. The director can match them from the club's side, or the parent refills through the private link |
| Already has a record | The member already has a health record in the new system (this year, or an earlier year's for the same person in this club) | Skipped. The newer entry wins and nothing is overwritten |
| Newer entry in this file | Two entries match one member; the later-submitted one is used | The earlier one is skipped |
| Incomplete form | Cognito's status is "Incomplete" | Never imported |

A name alone never matches, because two children can share a name. A parent email
shared with a sibling doesn't match the sibling, because the name must match too.
Two birth dates that differ rule a member out, so that row is *Needs check*.

The club is matched from the church and club name on the form (the two Cognito
name parts joined back together) against the club's name, or its sponsoring
church's name, ignoring "SDA", "Church" and "Pathfinders". A name that fits two
clubs is *Needs check*.

Fields that fail the shared phone, email or ZIP checks (#855) are kept exactly as
entered and shown to the director as "needs correcting". The preview says how many
fields per entry. Nothing is dropped. Emergency contacts beyond the Health tab's
limit of six are not imported and the preview says how many.

## 3. Apply

Untick anyone you don't want, then press **Import**. The browser sends the same
file again, with the rows you ticked as entry-and-member pairs from the preview. The
server matches the file again and writes a sealed record only where the new match
gives the **same member** and is still *Matched*; any other ticked row is reported
as **Changed since the preview** and nothing is written for it. Nothing is ticked
by default on the server side. Each club is its own transaction, so one failure never blocks
the others (the failed rows say **Could not import**; run again after checking).

Imported records:

- are encrypted field by field, like any record, and **marked "Imported from the
  2026 online form, director please review"** on the Health tab;
- count as **needing confirmation** under the yearly re-confirmation rule: they
  read "Needs update" until the director saves or confirms them (either clears the
  mark);
- carry the **three consents** (emergency treatment, activities, photocopy) when the
  entry's `Signature` cell is not empty, marked as imported from the 2026 online form
  (version `cognito-pathfinder-health-record-2026`). A typed name is kept as the
  signature; an image link counts as signed but is never stored or fetched, so the
  typed name stays blank. The consent date is the form's `Date` column when it parses,
  otherwise blank. With no signature, no consent is imported and the Health tab says
  "No consent has been given in the new system yet"; a director's Confirm keeps an
  imported consent and creates none;
- keep the combined "insurance group and policy numbers" answer whole in the
  **Group number** field (it can't be split reliably) and leave **Policy number**
  for the director.

**Insurance cards are not imported.** The export holds only links into Cognito
storage, and the importer never fetches them. The record shows "Uploaded on the old
online form. Ask the parent to upload it again here." Nothing else about the card
(link, file name, size) is stored.

## 4. Running it again

Re-running the same file changes nothing: members who already have a record are
skipped, whether the first run imported them or a director entered them. Use this
for a late batch (export again; only the new members are written) or after fixing
a roster for a *Needs check* or *Not matched* row.

## 5. Audit

Every run is recorded with who ran it, when, the club, and **counts only**:

- `HEALTH_IMPORT_PREVIEWED`: entry, club and result counts;
- `HEALTH_RECORD_IMPORTED`: one per record, with record, member and club ids and a
  field count;
- `HEALTH_IMPORT_CLUB_APPLIED`: per club, records imported and skipped;
- `HEALTH_IMPORT_APPLIED`: per run, the counts by result.

No name, value, birth date, email or phone number is ever in an audit row, a log
line or an error message.

## 6. Afterwards: clean-up checklist

The page shows this list too.

1. **Delete the export file** you downloaded from Cognito, from your computer and
   your downloads folder.
2. Ask each director to open the Health tab, check the imported records, and
   confirm them (or edit and save).
3. Ask parents to upload insurance cards in the new system.
4. Once a club's import is verified, **stop using Cognito for that club and delete
   its entries there.**

## Assumptions to confirm

The header-only export left these open; the importer does the following until told
otherwise:

- Only entries whose `Entry_Status` is **Incomplete** are skipped. Any other status
  (Submitted, Reviewed, and so on) is imported.
- The `Allergies` column is read as Yes/No when it is one; any other text in it
  (for example "Penicillin") is kept as allergy text and counts as Yes. Allergy
  details win over a "No", so a note is never lost. A **blank answer stores
  nothing**: it is never turned into "No". The insurance answer works the same way.
- Text longer than the Health tab form's limit (for example 2,000 characters for
  allergy details) is kept whole, never cut, and the row is counted as needing
  correction. The director shortens it on the next save. A cell over 20,000
  characters is never cut either: that entry is *Needs check* and is not imported.
- On the Health tab and in its form, every stored answer that needs correcting is
  named: phones, emails and ZIP codes that fail the checks, a tetanus booster that
  isn't a year-month-day date (shown as typed, for example "2019"), and text over the
  form's limits. A refused save names the field. An unanswered allergy or insurance
  question reads "Not answered" and must be answered before the director can save.
- A truncated or damaged Excel file is refused outright rather than read as far as it
  goes. Phonetic guide text in a cell is ignored.
- A four-digit number in a date column (a year such as 2019) is kept as typed. Only a
  five-digit Excel date serial (10000 to 60000) is read as a date.

## Decisions

**Decided by Caleb Durant, 2026-10-15: a signed 2026 Cognito form counts as consent.**
Only a non-empty `Signature` cell counts as signed (a typed name or an image link).

Also decided on 2026-10-15:

- **Event health copies** (the sealed per-event copies taken at check-in or event
  start, #924) may include imported records a director has not reviewed yet. That is
  the current behaviour and is intended.
- **Club year:** the forms apply to the **current** roster when the Pathfinder's name
  matches. Matching stays as described above (name plus birth date or parent email,
  current club year).
- **Confirm is never blocked** by "needs correcting" flags or by unanswered
  questions. A director can confirm an imported record as it stands.

## Checks

- Unit tests: `npx vitest run tests/health-import-*.test.ts`.
- Real database: `npm run test:health-import` (local database only, synthetic rows
  it creates and removes itself).
