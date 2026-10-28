"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { systemRoleText } from "@/modules/access/role-descriptions";
import { roleLabel } from "@/modules/access/role-display";
import { clubDirectorRoleLabels } from "@/modules/organizations/director-grants-domain";
import type { GrantPlanRow, GrantPlanState } from "@/modules/system-admin/people-directory-model";
import styles from "./people-directory.module.css";

type Names = Record<string, string>;

function itemLabel(row: GrantPlanRow, eventNames: Names, clubNames: Names) {
  const { item } = row;
  if (item.type === "sa") return systemRoleText.SYSTEM_ADMIN.name;
  if (item.type === "ca") return systemRoleText.CLUBS_ADMIN.name;
  if (item.type === "ac") return systemRoleText.AREA_COORDINATOR.name;
  if (item.type === "event") return `${eventNames[item.eventId] ?? "An event"}: ${roleLabel(item.role)}`;
  return `${clubNames[item.organizationId] ?? "A club"}: ${clubDirectorRoleLabels[item.role]}`;
}

const stateText: Record<GrantPlanState, string> = {
  save: "Ready to save",
  change: "Will change their role here",
  has: "Already has this",
  "other-role": "Has another role here. Revoke it first to change it.",
  "needs-staff": "Needs a staff login",
  "needs-account": "Needs a website account",
};

async function call(url: string, method: string, json?: unknown) {
  const response = await fetch(url, {
    method,
    headers: json === undefined ? undefined : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const result = await response.json().catch(() => ({})) as { message?: string; issues?: Array<{ message?: string }> };
  if (!response.ok) throw new Error(result.message ?? result.issues?.[0]?.message ?? "That could not be saved.");
}

/**
 * "Chosen in the invite" (#1276): the access picked in Invite a person for someone who already has an account, ready to
 * save here. Save applies each ready item through the same route its own control on this page calls, so the server
 * decides every one; failures are listed per item and the link is kept so they can be retried.
 */
export function PersonGrantPanel({ rows, person, eventNames, clubNames, cleanHref }: {
  rows: readonly GrantPlanRow[];
  person: { staffId: string | null; accountId: string | null; staffEmail: string | null; accountEmail: string | null; displayName: string };
  eventNames: Names;
  clubNames: Names;
  /** This page without `?grant=`. */
  cleanHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Array<{ key: string; label: string; message: string }>>([]);
  const [saved, setSaved] = useState(0);
  const saveable = rows.filter((row) => row.state === "save" || row.state === "change");

  async function apply(row: GrantPlanRow) {
    const { item } = row;
    if (item.type === "sa") await call(`/api/users/${encodeURIComponent(person.staffId!)}/global-role`, "PATCH", { globalRole: "SYSTEM_ADMIN" });
    else if (item.type === "ca") await call(`/api/admin/users/${encodeURIComponent(person.staffId!)}/clubs-administrator`, "PUT");
    else if (item.type === "ac") await call(`/api/admin/accounts/${encodeURIComponent(person.accountId!)}`, "POST", { action: "area-coordinator", on: true });
    else if (item.type === "event") await call(`/api/events/${encodeURIComponent(item.eventId)}/memberships`, "POST", { email: person.staffEmail, displayName: person.displayName, role: item.role });
    else await call(`/api/admin/organizations/${encodeURIComponent(item.organizationId)}/director-grants`, "POST", { email: person.accountEmail, role: item.role, reason: "Invited from People & access." });
  }

  async function save() {
    setBusy(true);
    setFailures([]);
    const failed: typeof failures = [];
    let done = 0;
    for (const row of saveable) {
      try {
        await apply(row);
        done += 1;
      } catch (caught) {
        failed.push({ key: row.key, label: itemLabel(row, eventNames, clubNames), message: caught instanceof Error ? caught.message : "That could not be saved." });
      }
    }
    setSaved(done);
    setFailures(failed);
    setBusy(false);
    if (failed.length === 0) router.replace(cleanHref);
    router.refresh();
  }

  return (
    <section aria-labelledby="people-chosen" className={styles.box}>
      <h2 id="people-chosen">Chosen in the invite</h2>
      <ul className={styles.chosenList}>
        {rows.map((row) => (
          <li className={styles.chosenItem} key={row.key}>
            <strong>{itemLabel(row, eventNames, clubNames)}</strong>
            <span className={styles.note}>{stateText[row.state]}</span>
          </li>
        ))}
      </ul>
      {saveable.length > 0 ? (
        <div>
          <button className="primary-button" disabled={busy} onClick={() => void save()} type="button">
            {busy ? "Saving…" : `Save ${saveable.length === 1 ? "this access" : `these ${saveable.length} items`}`}
          </button>
        </div>
      ) : (
        <p className={styles.note}>Nothing here can be saved right now.</p>
      )}
      <div className={styles.status}>
        {saved > 0 ? <p aria-live="polite" role="status">Saved {saved} {saved === 1 ? "item" : "items"}.</p> : null}
        {failures.length > 0 ? (
          <ul className={styles.chosenList} role="alert">
            {failures.map((failure) => <li className={styles.statusError} key={failure.key}>{failure.label}: {failure.message}</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
