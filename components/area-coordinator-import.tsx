"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { useConfirm } from "@/components/use-confirm";
import { CLUB_KINDS, type ClubKindValue } from "@/modules/organizations/club-kind";
import styles from "./people-directory.module.css";

const BASE = "/api/admin/area-coordinator-invites";

/**
 * People & access, system administrators only (#1608): upload the Area Coordinator list (saved as pending invites, nothing
 * emailed), then one button sends them all after a confirmation that states how many emails go out.
 */
export function AreaCoordinatorImport({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [chosen, setChosen] = useState<ClubKindValue[]>(["PATHFINDER"]);
  const ministries = CLUB_KINDS.filter((kind) => chosen.includes(kind));

  async function send() {
    const noun = `Area Coordinator invite${pendingCount === 1 ? "" : "s"}`;
    if (!(await confirm({
      title: `Send ${pendingCount} ${noun}?`,
      body: <p>This emails {pendingCount} {pendingCount === 1 ? "person" : "people"} now. Each invite expires in 14 days. You can still cancel an invite from the pending list afterwards.</p>,
      confirmLabel: `Send ${pendingCount} ${noun}`,
      cancelLabel: "Not yet",
    }))) return;
    setBusy(true);
    setMessage("");
    setError("");
    setNotConfigured(false);
    try {
      const response = await fetch(`${BASE}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedCount: pendingCount }) });
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) {
        setNotConfigured(result.error === "EMAIL_NOT_CONFIGURED");
        throw new Error(result.message ?? "The invites could not be sent.");
      }
      setMessage(result.message ?? "Invites sent.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invites could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {confirmDialog}
      <CsvImportDialog
        eyebrow="Area Coordinators"
        help={(
          <p>
            Upload a CSV with the columns First name, Last name and Email. A FluentCRM contacts export works as it is. Saving only
            creates pending invites; nothing is emailed until you press Send. People who are already Area Coordinators or already
            have an open invite are skipped.
          </p>
        )}
        extraBody={{ ministries }}
        importUrl={`${BASE}/import`}
        options={(
          <div className={styles.inviteForm}>
          <fieldset>
            <legend>Ministries these Area Coordinators see</legend>
            {CLUB_KINDS.map((kind) => (
              <label className={styles.check} key={kind}>
                <input
                  checked={chosen.includes(kind)}
                  onChange={(event) => setChosen((current) => (event.target.checked ? [...current, kind] : current.filter((value) => value !== kind)))}
                  type="checkbox"
                />
                <span>{kind === "ADVENTURER" ? "Adventurer clubs" : "Pathfinder clubs"}</span>
              </label>
            ))}
            {ministries.length === 0 ? <p className={styles.statusError} role="alert">Choose at least one ministry.</p> : null}
          </fieldset>
          </div>
        )}
        onImported={() => router.refresh()}
        templateLabel="Area Coordinator CSV template"
        templateHref={`${BASE}/template`}
        title="Import Area Coordinators"
        uploadLabel="Import Area Coordinators"
        variant="staff"
      />
      {pendingCount > 0 ? (
        <button className="secondary-button" disabled={busy} onClick={() => void send()} type="button">
          <Send aria-hidden="true" size={16} /> {busy ? "Sending…" : `Send ${pendingCount} Area Coordinator invite${pendingCount === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {message ? <p aria-live="polite" role="status">{message}</p> : null}
      {error ? (
        <div className="inline-notice error" role="alert">
          {error}{notConfigured ? <> Check the <Link href="/admin/system-report">System report</Link> to see what is missing.</> : null}
        </div>
      ) : null}
    </>
  );
}
