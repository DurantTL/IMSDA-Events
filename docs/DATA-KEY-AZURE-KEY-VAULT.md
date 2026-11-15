# The personal-data key and Azure Key Vault (#1652)

Decision record: `docs/decisions/0017-sign-in-key-and-data-key.md`.

This is the runbook for giving health records, birth dates, sensitive club form
answers and imported calendar addresses their own key, kept in Azure Key Vault
under the organization's Microsoft 365 account. It is for Caleb and the people
who run the organization's IT.

**Every production step below is done by a person, never by automation.** That
includes creating the vault, creating and wrapping the key, giving access,
turning the setting on, moving the existing values, and retiring old keys.

## What this is, in plain words

The server has two keys now:

- The **sign-in key** protects the sign-in secrets and codes. It is the key
  file the server already has. It stays exactly as it is, and it unlocks by
  itself when the server starts.
- The **personal-data key** protects health records, birth dates, sensitive club
  form answers and imported calendar addresses. It is a separate random key.
  The server never stores it in plain form. It stores only a **wrapped** copy
  (locked by a key that never leaves Azure Key Vault) and asks the vault to
  unlock it when the server starts. The unlocked key lives only in the server's
  memory.

Until you finish these steps, nothing changes: the personal-data key is "not
separate yet" and personal data keeps using the sign-in key.

If the vault cannot be reached, only the protected fields are locked. Sign-in,
registration, check-in and payments keep working. The server keeps trying and
unlocks itself when the vault answers again (see step 11).

## What you need

- A person with the Owner or Contributor role on the organization's Azure
  subscription, and permission to register an app in the directory.
- The Azure command line (`az`) signed in as that person, or the Azure portal.
- The server's outbound internet address (the events server's public IP).
- The offline key backup process in `docs/DEPLOY-DOCKER.md`, "Keeping and
  testing the key backup".

Use the names you choose in place of the examples below. Nothing secret goes in
this document, in chat, in GitHub or in a ticket.

## Steps

### 1. Create the vault (human-run)

In the organization's Azure subscription create a Key Vault with:

- Tier: **Standard**.
- Permission model: **Azure role-based access control**.
- **Soft delete** on, and **purge protection** on.
- A **network rule** that allows only the events server's outbound IP address
  (and your own address while you set things up).

Write down the vault's address, `https://<vault-name>.vault.azure.net`.

### 2. Create the vault key (human-run)

Create a key in that vault: type **RSA**, size **3072**, operations at least
**wrap key** and **unwrap key**. This key stays in the vault. Write down the key
name and its **version id** (a long run of letters a-f and digits, shown on the
key's page).

### 3. Register the app and give it one permission (human-run)

1. Register an application (a service principal) in the directory. Write down
   the **directory (tenant) id** and the **application (client) id**.
2. Create a **client secret** for it. Give it an **expiry** and put a renewal
   reminder in the shared calendar a month before it ends. The secret's value is
   shown once: put it straight into the password manager.
3. On the vault key (not the whole vault), assign the app the role
   **Key Vault Crypto Service Encryption User**. That role allows wrapping and
   unwrapping with this one key and nothing else.

### 4. Wrap a new data key (human-run)

On a machine you trust (not the events server), download the vault key's public
part. It is not secret.

```
az keyvault key download --vault-name <vault-name> --name <key-name> \
  --version <version-id> --encoding PEM --file kek-public.pem
```

Then, in a copy of this repository:

```
npm run data-key:wrap -- --public-key kek-public.pem --kek-version <version-id>
```

It makes a new random data key in memory, wraps it with the public part, and
prints one line:

```
DATA_ENCRYPTION_KEY_WRAPPED=<version-id>.<wrapped key>
```

The plain data key is never printed or saved. Keep the line (it is safe to store
with the deployment settings: only the vault can unlock it). Delete
`kek-public.pem`.

### 5. Put the settings on the server (human-run)

Add these to the server environment (the xCloud environment panel or `.env`,
see `.env.example`):

| Setting | Value |
| --- | --- |
| `DATA_KEY_SOURCE` | `azure-key-vault` |
| `AZURE_KEY_VAULT_URL` | the vault address from step 1 |
| `AZURE_KEY_VAULT_KEY_NAME` | the key name from step 2 |
| `AZURE_TENANT_ID` | the directory (tenant) id |
| `AZURE_CLIENT_ID` | the application (client) id |
| `DATA_ENCRYPTION_KEY_WRAPPED` | the wrapped value printed in step 4 |
| `DATA_ENCRYPTION_KEY_VERSION` | `1` (keep it set permanently) |

The client secret is the one setting that must not sit in `.env` in plain form.
Keep it in a protected file, the same way as the sign-in key file:

1. As root, write the secret to `/etc/imsda/azure-client-secret` with mode 0400
   and the container user as owner (as for the sign-in key file), then delete
   any temporary copy.
2. Set `AZURE_CLIENT_SECRET_FILE` to `/run/secrets/azure-client-secret` and
   mount the file read-only at that path. In `deploy/xcloud/docker-compose.env.yml`
   uncomment the `AZURE_CLIENT_SECRET_FILE` line and its bind mount. In
   `docker-compose.yml` do the same with its commented lines.
3. Do not also set `AZURE_CLIENT_SECRET` (the server refuses to start with both).

For a deployment made with `scripts/manual-deploy.sh`, which passes `.env` into
the container and mounts only the sign-in key file, ask the developer to add
the client secret file mount first; until then use `AZURE_CLIENT_SECRET` in the
protected `.env` (mode 600).

`DATA_KEY_SOURCE=dev-env` exists for local development and CI only. The server
refuses it in production.

### 6. Restart and check (human-run)

Redeploy so the container is recreated with the new settings (a plain restart is
not enough). Then:

1. Open **System management, System readiness** (or the System report). The
   **Personal-data key** row should read "Yes, version 1".
2. On the server run `npm run key:check`. It should print `data key: version 1`
   and list how many personal-data values are **not moved to the data key yet**.
   It fails until step 7 is done, which is expected.

If the row says the key is not loaded, read the reason in step 11.

### 7. Move the existing values (human-run, one time)

Existing health records, birth dates, sensitive answers and calendar addresses
are still sealed with the sign-in key. They keep working. This step moves them
to the data key. It needs no downtime.

1. **Take a fresh backup** and keep the offline copy of the sign-in key (and of
   the vault key backup, step 9).
2. Dry run: `npm run key:rotate`. It writes nothing and prints, for each
   personal-data column, how many values would move.
3. Apply: `npm run key:rotate -- --apply`. Run it again if it says some values
   changed while it ran; a rerun only finishes what is left. A second complete
   run changes nothing.
4. `npm run key:check` must now pass.

The command refuses to apply while the data key is not loaded, so it cannot
write anything it cannot read back.

### 8. Narrow the sign-in key (human-run)

The sign-in key file on the server still opens the personal data it sealed
before the move. Once step 7 has passed `key:check`, rotate the sign-in key with
the existing procedure ("Rotating the encryption key" in
`docs/DEPLOY-DOCKER.md`). Afterwards the key file on the server covers only
sign-in values, and the old key (which could read the old personal data) is
retired with the rest of that procedure. Test the new backup with
`npm run key:restore-check` as that procedure says.

### 9. Back up the key (human-run)

- **Vault key:** `az keyvault key backup --vault-name <vault-name> --name <key-name> --file <file>`.
  Store the file with the existing offline key backup (the password manager
  entry and the sealed printout held by the key custodian), never with the
  database dumps. The backup file can only be restored into an Azure Key Vault
  in the same subscription and region group.
- **Wrapped data key:** record `DATA_ENCRYPTION_KEY_WRAPPED` and the vault key
  version id with the deployment settings. Keep every wrapped value you ever
  used while any value could still be sealed with it.
- **Client secret:** it is not a key to your data. If it is lost, make a new one
  in the directory (step 3).

Losing the vault key **and** its backup means the personal data cannot be read
again, the same as losing the sign-in key. Add both to the key custodian's
checklist (`docs/SERVER-SECURITY-CHECKLIST.md`).

### 10. Rotating the data key (human-run)

1. Take a fresh backup.
2. Run step 4 again (a new wrapped value, wrapped with the same vault key
   version or a newer one).
3. Set the new value as `DATA_ENCRYPTION_KEY_WRAPPED` with
   `DATA_ENCRYPTION_KEY_VERSION` one higher. Move the old wrapped value to
   `DATA_ENCRYPTION_PREVIOUS_KEY_WRAPPED` with `DATA_ENCRYPTION_PREVIOUS_KEY_VERSION`
   set to the old version. Redeploy.
4. `npm run key:rotate` (dry run), then `npm run key:rotate -- --apply`, then
   `npm run key:check` must pass.
5. Remove the two `PREVIOUS` settings, redeploy, and run `npm run key:check`
   again. Keep the old wrapped value in the backup record from step 9.

### 11. If the vault cannot be reached or access is switched off

What people see: protected fields show as locked ("Locked: the personal-data key
is unavailable right now"), ages worked out from a birth date show as unknown,
exports that include birth dates are refused, and saving a protected value says
it cannot be saved right now. Everything else keeps working. Sign-in,
registration, check-in and payments are not affected.

What the server does: it tries again in the background every minute and unlocks
itself as soon as the vault answers. It writes one log line when the key becomes
unavailable (a reason, never a key) and one when it loads again.

What to check, in this order, using the reason shown on System readiness:

- **The key vault could not be reached:** the vault's status in the Azure portal,
  and the vault's **network rule** (it must allow the events server's current
  outbound address).
- **The key vault refused access:** the client secret's **expiry** (make a new
  secret, replace the file, redeploy), and the app's role on the vault key.
- **The key vault could not unwrap the data key:** that
  `DATA_ENCRYPTION_KEY_WRAPPED` was copied whole, and that its key version id is
  still enabled on the vault key.
- **The settings are not usable:** `npm run key:check` names the setting.

### 12. Going back (human-run)

- **Before step 7:** unset `DATA_KEY_SOURCE` and redeploy. Personal data was
  never moved, so it keeps using the sign-in key as before.
- **After step 7:** keep the vault. Values moved to the data key can only be
  opened with it. Do not unset `DATA_KEY_SOURCE` after the move; the server
  would then be unable to open them.

## What the commands print

`npm run key:check` and `npm run key:rotate` print counts and key versions, never
a value, key, token or secret. The data key line reads one of:

- `not separate yet (using the sign-in key)`
- `version N; previous not loaded` (or `previous loaded (version M)` while rotating)
- `unavailable (<reason>)`, where the reason is one of `vault-unreachable`,
  `access-denied`, `unwrap-failed` or `misconfigured`.
