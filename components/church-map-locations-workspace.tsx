"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HeldButton } from "@/components/organization-form-parts";
import { useRegisterOrganizationAction } from "@/components/organization-header-action";
import styles from "@/components/organization-pages.module.css";
import { cardCell } from "@/components/table-card-labels";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import type { GeocodeReviewItem } from "@/modules/organizations/church-geocoding";

type ApiError = { message?: string; issues?: Array<{ message?: string }> };
type RunSummary = { processed: number; matched: number; noMatch: number };

// Sorts from its headers (#1458); the keys here are the whitelist.
const LOCATION_SORT: Record<"church" | "address" | "result", ColumnSpec<GeocodeReviewItem>> = {
  church: { value: (item) => item.name, label: "church" },
  address: { value: (item) => item.address, label: "address" },
  result: { value: (item) => (item.status === "MATCHED" ? "Matched" : "No match"), label: "result" },
};

/**
 * "Find map locations" (#724). Staff start the lookup, then review the
 * results: accept a match, adjust the point on the church's location page, or
 * skip. Nothing reaches the public map until a match is accepted. The page
 * header's one filled button starts the lookup (#1592); a match is a proposal
 * until it is accepted.
 */
export function ChurchMapLocationsWorkspace({ enabled, eligible, items }: { enabled: boolean; eligible: number; items: GeocodeReviewItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sorted = useTableSort(items, LOCATION_SORT);
  const latest = useRef<() => void>(() => {});
  const run_ = useCallback(() => latest.current(), []);
  const registerAction = useRegisterOrganizationAction();
  const blocked = !enabled || eligible === 0 || busy !== null;
  const looking = busy === "run";
  useEffect(() => {
    registerAction({ run: run_, busy: looking, blocked, label: "Find map locations", busyLabel: "Looking up…" });
    return () => registerAction(null);
  }, [registerAction, run_, looking, blocked]);

  async function post(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as ApiError & Partial<RunSummary>;
    if (!response.ok) throw new Error(result.message ?? result.issues?.[0]?.message ?? "That didn't work. Nothing was changed.");
    return result;
  }

  async function run() {
    setBusy("run");
    setError("");
    setNotice("");
    try {
      const result = await post("/api/admin/organizations/map-locations") as RunSummary;
      setNotice(result.processed === 0
        ? "No churches need a lookup right now."
        : `Looked up ${result.processed} ${result.processed === 1 ? "church" : "churches"}: ${result.matched} matched, ${result.noMatch} with no match. Review the matches below.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  // The latest handler is kept in an effect, so the stable `run_` the header button calls is never stale.
  useEffect(() => {
    latest.current = () => { if (!blocked) void run(); };
  });

  async function decide(item: GeocodeReviewItem, decision: "accept" | "skip") {
    setBusy(item.organizationId);
    setError("");
    setNotice("");
    try {
      await post(`/api/admin/organizations/${encodeURIComponent(item.organizationId)}/map-location`, { decision });
      setNotice(decision === "accept" ? `${item.name} is on the map.` : `Skipped ${item.name}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel form-stack org-map-locations">
      {!enabled && (
        <div className="inline-notice" role="status">
          Finding map locations is turned off on this server. Set <code>GEOCODING_ENABLED=true</code> to use it.
        </div>
      )}
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <p className={styles.note}>
        {eligible} {eligible === 1 ? "church has" : "churches have"} a street address and no map point yet. Only each church&apos;s public street
        address, city, state and ZIP are sent to the U.S. Census Bureau geocoder. Groups that meet in homes, towns-only addresses and locations set by hand are never sent.
        {" "}Nothing reaches the public map until you accept a match.
      </p>
      <p className="org-result-summary" role="status">
        {items.length} {items.length === 1 ? "result" : "results"} to review.
      </p>
      {items.length === 0 && enabled && eligible > 0 && (
        <p className={styles.note}>Nothing is waiting for review. Choose Find map locations at the top of the page to look up the churches that need a point.</p>
      )}
      {items.length > 0 && (
        <div className="report-table-wrap">
          {sorted.note}
          <table className="report-table table-cards table-cards-wide" role="table">
            <thead role="rowgroup">
              <tr role="row">
                {sorted.header("church", "Church")}
                {sorted.header("address", "Address on file")}
                {sorted.header("result", "Proposed location")}
                <th role="columnheader" scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {sorted.rows.map((item) => (
                <tr key={item.organizationId} role="row">
                  <th className="org-cell-name" role="rowheader" scope="row" translate="no">{item.name}</th>
                  <td {...cardCell("Address on file")}>{item.address}</td>
                  <td {...cardCell("Proposed location")}>
                    {item.status === "MATCHED" ? (
                      <>
                        <span className="status-chip green">Proposed match</span>
                        <span className="org-cell-sub">{item.matchedAddress}</span>
                        <span className="org-cell-sub">{item.latitude?.toFixed(4)}, {item.longitude?.toFixed(4)}</span>
                        <span className="org-cell-sub">Not on the map until accepted.</span>
                      </>
                    ) : (
                      <span className="status-chip gold">No match</span>
                    )}
                  </td>
                  <td {...cardCell(null)} className="org-cell-actions">
                    <div className={styles.reviewActions}>
                      {item.status === "MATCHED" && (
                        <HeldButton ariaLabel={`Accept match for ${item.name}`} held={busy !== null} onAction={() => void decide(item, "accept")}>Accept</HeldButton>
                      )}
                      {/* A plain anchor: the map page needs its own Content-Security-Policy (#542). */}
                      <a className={styles.textLink} href={`/admin/organizations/${item.organizationId}/location`}>Set on map<span className="sr-only"> for {item.name}</span></a>
                      <HeldButton ariaLabel={`Skip ${item.name}`} held={busy !== null} onAction={() => void decide(item, "skip")}>Skip</HeldButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
