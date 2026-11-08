import Link from "next/link";
import { Plus } from "lucide-react";
import { OutingListTable } from "@/components/club-outing-tables";
import type { OutingListRow } from "@/modules/club-forms/outings";

/**
 * The Forms tab's outing permission slips (#1672): the director's own outings and a way to start one. The slip is the
 * conference's Off-Premises Permission Slip; while it is switched off the section says who can turn it on and offers no button.
 */
export function ClubOutingsSection({ base, outings, slipEnabled }: { base: string; outings: OutingListRow[]; slipEnabled: boolean }) {
  return (
    <section aria-labelledby="club-forms-outings" className="club-form-group" data-testid="club-outings">
      <h2 id="club-forms-outings">Outing permission slips</h2>
      <p className="field-help">Set up a slip for one outing, send it to the families going and see who has signed. Parents review the details and sign.</p>
      <section className="public-manage-card">
        {slipEnabled ? (
          <div className="club-form-template-actions">
            <Link className="primary-button" href={`${base}/outings/new`}><Plus aria-hidden="true" size={14} /> New outing slip</Link>
          </div>
        ) : (
          <p data-testid="outing-slip-off">The Off-Premises Permission Slip is not turned on yet, so outing slips can&apos;t be started. Ask a system administrator at the conference office to turn it on.</p>
        )}
        {outings.length === 0
          ? <p className="field-help">{slipEnabled ? "No outing slips yet. Choose New outing slip to set up your first one." : "Your outings will be listed here once the slip is turned on."}</p>
          : <OutingListTable base={base} outings={outings} />}
      </section>
    </section>
  );
}
