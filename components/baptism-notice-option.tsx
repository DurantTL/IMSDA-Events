"use client";

import baptismStyles from "@/components/registration-amendment-baptism.module.css";

export type BaptismNoticeOffer = { names: number; recipients: Array<"lead" | "pastor"> };

/**
 * The staff choice to send the baptism follow-up notice with an edit (#1680). Rendered only when the review says the edit adds
 * baptism names not notified before; unchecked by default. Names the roles that would be told, never an address.
 */
export function BaptismNoticeOption({ offer, checked, disabled, onChange }: { offer: BaptismNoticeOffer | undefined; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  if (!offer) return null;
  return (
    <div className={baptismStyles.notice}>
      <label className="checkbox-row" htmlFor="amendment-send-baptism">
        <input aria-describedby="amendment-send-baptism-help" checked={checked} disabled={disabled} id="amendment-send-baptism" onChange={(event) => onChange(event.target.checked)} type="checkbox" />
        Send baptism follow-up notice
      </label>
      <p className={baptismStyles.help} id="amendment-send-baptism-help">
        This edit adds {offer.names === 1 ? "a baptism name" : `${offer.names} baptism names`} not sent before. It goes to the event lead{offer.recipients.includes("pastor") ? " and the club's church pastor" : " only; no pastor is on file"}. Left unticked, nothing is sent.
      </p>
    </div>
  );
}
