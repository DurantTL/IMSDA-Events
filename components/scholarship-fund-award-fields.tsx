"use client";

import { Money } from "@/components/exact-value";
import { useEffect, useState } from "react";
import { formatCents } from "@/modules/payments/format-cents";
import type { FundView, SponsorDirectoryEntry } from "@/modules/scholarship-funds/repository";

/**
 * The "draw this scholarship on the event's fund" part of the scholarship adjustment form (#398). The fields are
 * plain named inputs the form reads on submit (`useFund`, `fundOrganizationId`, `fundSponsorName`, `fundPledged`);
 * the server checks the balance again, so what is shown here is only a hint.
 */
export function ScholarshipFundAwardFields({ eventId }: { eventId: string }) {
  const [useFund, setUseFund] = useState(false);
  const [pledged, setPledged] = useState(false);
  // A sponsor is a directory church or a typed name, never both: choosing one switches the other off.
  const [pickedOrganization, setPickedOrganization] = useState("");
  const [typedSponsor, setTypedSponsor] = useState("");
  const [info, setInfo] = useState<{ fund: FundView; directory: SponsorDirectoryEntry[] } | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!useFund || info) return;
    let cancelled = false;
    fetch(`/api/events/${encodeURIComponent(eventId)}/scholarship-fund`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The fund could not be loaded.");
        return response.json() as Promise<{ fund: FundView; directory: SponsorDirectoryEntry[] }>;
      })
      .then((loaded) => { if (!cancelled) setInfo(loaded); })
      .catch((caught: unknown) => { if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "The fund could not be loaded."); });
    return () => { cancelled = true; };
  }, [eventId, info, useFund]);

  return (
    <fieldset className="form-stack">
      <label className="checkbox-label">
        <input type="checkbox" name="useFund" checked={useFund} onChange={(event) => setUseFund(event.target.checked)} />
        {" "}Draw this on the event&apos;s scholarship fund
      </label>
      {useFund && (
        <>
          {loadError && <p className="form-error" role="alert">{loadError}</p>}
          {info && (
            <p className="quiet-copy">
              Fund balance <Money cents={info.fund.summary.balanceCents} />
              {info.fund.summary.pledgedCents > 0 ? ` · ${formatCents(info.fund.summary.pledgedCents)} pledged, not yet received` : ""}.
              {" "}An award can&apos;t take the balance below $0, or use more than its sponsor has given, unless it is marked pledged.
            </p>
          )}
          <label>Church or club from the directory
            <select name="fundOrganizationId" value={pickedOrganization} disabled={typedSponsor.trim() !== ""} onChange={(event) => setPickedOrganization(event.target.value)}>
              <option value="">{pledged ? "Not in the directory (type a name below)" : "Not tied to one sponsor"}</option>
              {(info?.directory ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}{entry.place ? ` · ${entry.place}` : ""}</option>
              ))}
            </select>
          </label>
          <label>Or type a sponsor name
            <input name="fundSponsorName" maxLength={120} autoComplete="off" value={typedSponsor} disabled={pickedOrganization !== ""} onChange={(event) => setTypedSponsor(event.target.value)} />
            {(pickedOrganization !== "" || typedSponsor.trim() !== "") && <small className="quiet-copy">{pickedOrganization !== "" ? "A directory church is chosen, so the name box is off." : "A name is typed, so the directory choice is off."}</small>}
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="fundPledged" checked={pledged} onChange={(event) => setPledged(event.target.checked)} />
            {" "}Pledged, not yet received
          </label>
          {pledged && <small className="quiet-copy">Name who pledged it. It shows as outstanding for that sponsor until the money is recorded and you mark it received.</small>}
        </>
      )}
    </fieldset>
  );
}
