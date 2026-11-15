# 0017: A sign-in key and a separate personal-data key (#1652)

Status: Accepted (Caleb, November 7 and November 14, 2026).

## Context

One key (`SECRET_ENCRYPTION_KEY`, `lib/secret-box.ts`) protected two different kinds of value:

- **Sign-in secrets:** staff and attendee authenticator secrets, one-time sign-in, confirmation, step-up and recovery codes,
  and Security check fallback codes. These must always be available, or nobody can sign in.
- **Personal data:** health records and health snapshots, club roster and background-check birth dates, sensitive club form
  answers, and imported calendar feed addresses.

Decisions: the sign-in key always unlocks automatically from a protected key file on the server (November 7). The
personal-data key is loaded from a cloud key service, Azure Key Vault under the Microsoft 365 organization (November 14,
option A). Health information must never depend on a person being available to unlock it after a restart.

## Decision

1. **Two keys.**
   - The **sign-in key** keeps its existing settings (`SECRET_ENCRYPTION_KEY` or `SECRET_ENCRYPTION_KEY_FILE`, its version,
     and the previous key during a rotation). Nothing about it changes.
   - The **data key** is a separate 32-byte random key. It is never stored in plain form on the server. The server holds only
     a wrapped copy (encrypted by a key that never leaves Azure Key Vault) and asks the vault to unwrap it at startup. The
     unwrapped key lives only in the server's memory.
2. **Where the data key comes from** (`DATA_KEY_SOURCE`):
   - not set: **not separate yet.** Personal data keeps using the sign-in key, exactly as before. This is the state until the
     vault is set up, and it keeps every existing deployment working unchanged.
   - `azure-key-vault`: production. The wrapped data key and the vault settings are in the server environment.
   - `dev-env`: **local development and CI only.** The data key is a plain value in the environment. Refused when
     `NODE_ENV=production`.
3. **Values say which key sealed them.** Data-key values use their own format (`d1.<version>.…`) with the version
   authenticated. Values already in the database (sealed with the sign-in key) stay readable with the sign-in key until they
   are moved, so turning the vault on needs no downtime.
4. **Versions, rotation and the key health check (#1516) work for both keys.** The sealed-column registry says which key each
   column uses. `npm run key:check` reports each column against its own key and counts personal-data values not moved yet.
   `npm run key:rotate -- --apply` moves them to the data key, and also rotates either key to a new version, as before.
5. **When the data key is unavailable** (vault unreachable, access switched off), only protected fields are locked:
   - pages show the field as locked, and ages worked out from a birth date show as unknown;
   - saving a protected value is refused with a plain message; everything else on the page still saves;
   - sign-in, registration, check-in and payments keep working;
   - the server keeps retrying in the background and unlocks itself when the vault answers again.
6. **The vault adapter** (`lib/data-key/`) uses the vault's REST interface over HTTPS with the standard Microsoft sign-in
   for an application (tenant, client ID, client secret). It needs only permission to unwrap with one key. No new package
   is added. It logs a reason category, never a key, a token or a secret.
7. **Human-run steps.** Creating the vault, creating the wrapped data key, granting access, moving existing values and
   retiring old keys are production steps a person runs, from `docs/DATA-KEY-AZURE-KEY-VAULT.md`. Automation never runs them.

## Not decided here

- Whether the paper health sheet (#416) changes now that the data key is separate.
- Medical-type questions on regular event registration forms are not encrypted by either key (separate decision).
