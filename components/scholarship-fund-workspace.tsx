"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, HandCoins, WalletCards } from "lucide-react";
import { postJson } from "@/lib/post-json";
import {
  CONTRIBUTION_METHODS,
  contributionMethodLabels,
  formatCents,
  type ContributionMethod,
} from "@/modules/scholarship-funds/domain";
import type { FundView, SponsorDirectoryEntry } from "@/modules/scholarship-funds/repository";

/**
 * The event's scholarship fund (#398): the balance, contributions received against awards made per sponsor or
 * church, and every line. One fund per event; nothing carries over to another event or year. It records money and
 * never moves any: no refund, payment, or transfer starts here. Awards are made from a registration's
 * Payments screen as a scholarship adjustment that draws on this fund. Every request is checked again on the server
 * for MANAGE_FINANCE on this event; hiding a control is never the protection.
 */
export function ScholarshipFundWorkspace({
  eventId,
  eventName,
  initialFund,
  directory,
}: {
  eventId: string;
  eventName: string;
  initialFund: FundView;
  directory: SponsorDirectoryEntry[];
}) {
  const router = useRouter();
  const [fund, setFund] = useState(initialFund);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  // A sponsor is a directory church or a typed name, never both: choosing one switches the other off.
  const [pickedOrganization, setPickedOrganization] = useState("");
  const [typedSponsor, setTypedSponsor] = useState("");
  const { summary } = fund;
  const base = `/api/events/${encodeURIComponent(eventId)}/scholarship-fund`;

  async function send(url: string, payload: unknown, fallback: string, success: string) {
    setSaving(true); setError(""); setNotice("");
    const result = await postJson(url, payload, fallback);
    setSaving(false);
    if (!result.ok) {
      setError(String(result.body.message ?? fallback));
      return false;
    }
    setFund(result.body.fund as FundView);
    setNotice(success);
    router.refresh();
    return true;
  }

  async function addContribution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send(`${base}/contributions`, {
      organizationId: String(form.get("organizationId") ?? "") || undefined,
      sponsorName: String(form.get("sponsorName") ?? "").trim() || undefined,
      amountCents: Math.round(Number(form.get("amount") ?? 0) * 100),
      receivedOn: String(form.get("receivedOn") ?? ""),
      method: String(form.get("method") ?? "CHECK") as ContributionMethod,
      note: String(form.get("note") ?? "").trim() || undefined,
    }, "Unable to record the contribution.", "Contribution recorded.");
    if (ok) { formElement.reset(); setPickedOrganization(""); setTypedSponsor(""); }
  }

  async function reverseContribution(event: React.FormEvent<HTMLFormElement>, contributionId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send(`${base}/contributions/${encodeURIComponent(contributionId)}/reverse`, { reason: String(form.get("reason") ?? "") }, "Unable to reverse the contribution.", "Contribution reversed.");
    if (ok) setReversing(null);
  }

  async function settle(awardId: string) {
    await send(`${base}/awards/${encodeURIComponent(awardId)}/settle`, {}, "Unable to mark the pledge received.", "Pledge marked received.");
  }

  const sponsorUnallocated = new Map(summary.sponsors.map((sponsor) => [sponsor.key, sponsor.unallocatedCents]));
  /** Why "Mark received" is off, or null: the pledging sponsor's own money (and the fund) must cover it. */
  const settleBlock = (award: FundView["awards"][number]) => {
    const own = award.sponsorKey ? sponsorUnallocated.get(award.sponsorKey) ?? 0 : 0;
    if (award.amountCents > own) return `${award.sponsorName ?? "This sponsor"} has only ${formatCents(Math.max(0, own))} unspent. Record their contribution first.`;
    if (award.amountCents > summary.balanceCents) return "The fund doesn't hold enough yet. Record the contribution first.";
    return null;
  };
  const pledgedAwards = fund.awards.filter((award) => award.active && award.pledged && !award.settled && !award.registrationCancelled);
  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Financial operations</p>
          <h2>Scholarship fund</h2>
          <p>
            {eventName} has one scholarship fund. Contributions and awards belong to this event alone; nothing carries over to another event or year.
            This page records money. It never refunds, charges, or moves any. To award from the fund, add a scholarship from a registration on the Payments screen and choose &quot;Draw this on the event&apos;s scholarship fund&quot;.
          </p>
        </div>
        <div className="page-intro-actions">
          <a className="secondary-button" href={`/finance?event=${encodeURIComponent(eventId)}`}><WalletCards aria-hidden="true" size={17} /> Payments</a>
          <a className="secondary-button" href={`/api/events/${encodeURIComponent(eventId)}/exports/scholarship-fund`}><Download aria-hidden="true" size={17} /> Export CSV</a>
        </div>
      </div>

      <section className="finance-summary" aria-label="Scholarship fund balance">
        <article className="finance-stat"><span><HandCoins aria-hidden="true" size={18} /></span><small>Received</small><strong>{formatCents(summary.receivedCents)}</strong></article>
        <article className="finance-stat"><span><HandCoins aria-hidden="true" size={18} /></span><small>Awarded from received money</small><strong>{formatCents(summary.fundedCents)}</strong></article>
        <article className="finance-stat"><span><HandCoins aria-hidden="true" size={18} /></span><small>Fund balance</small><strong data-testid="fund-balance">{formatCents(summary.balanceCents)}</strong></article>
        <article className={`finance-stat${summary.pledgedCents > 0 ? " warning" : ""}`}>
          <span><HandCoins aria-hidden="true" size={18} /></span><small>Pledged, not yet received</small><strong data-testid="fund-pledged">{formatCents(summary.pledgedCents)}</strong>
        </article>
      </section>
      {summary.afterPledgesCents < 0 && (
        <p className="inline-notice" role="note">
          Awards marked pledged add up to more than the fund holds. The fund is {formatCents(-summary.afterPledgesCents)} short until those pledges arrive.
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <section className="panel finance-list" aria-label="Contributions received against awards made, by sponsor or church">
        <div className="finance-row finance-head"><span>Sponsor or church</span><span>Received</span><span>Awarded</span><span>Still outstanding (pledged)</span></div>
        {summary.sponsors.map((sponsor) => (
          <div className="finance-row" key={sponsor.key}>
            <span><strong>{sponsor.name}</strong>{sponsor.unallocatedCents > 0 ? <small>{formatCents(sponsor.unallocatedCents)} received, not yet awarded</small> : null}</span>
            <span>{formatCents(sponsor.receivedCents)}</span>
            <span>{formatCents(sponsor.awardedCents)}</span>
            <span>{sponsor.outstandingCents > 0 ? <strong>{formatCents(sponsor.outstandingCents)}</strong> : formatCents(0)}</span>
          </div>
        ))}
        {summary.generalAwardedCents > 0 && (
          <div className="finance-row">
            <span><strong>Fund in general (no one sponsor)</strong></span><span /><span>{formatCents(summary.generalAwardedCents)}</span><span />
          </div>
        )}
        {summary.sponsors.length === 0 && <p className="quiet-copy">No contributions or sponsored awards yet.</p>}
      </section>

      <section className="panel" aria-label="Record a contribution">
        <h3>Record a contribution</h3>
        <form className="form-stack" onSubmit={addContribution}>
          <label>Church or club from the directory
            <select name="organizationId" value={pickedOrganization} disabled={typedSponsor.trim() !== ""} onChange={(event) => setPickedOrganization(event.target.value)}>
              <option value="">Not in the directory (type a name below)</option>
              {directory.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.place ? ` · ${entry.place}` : ""}</option>)}
            </select>
          </label>
          <label>Or type who it is from
            <input name="sponsorName" maxLength={120} autoComplete="off" value={typedSponsor} disabled={pickedOrganization !== ""} onChange={(event) => setTypedSponsor(event.target.value)} />
            {(pickedOrganization !== "" || typedSponsor.trim() !== "") && <small className="quiet-copy">{pickedOrganization !== "" ? "A directory church is chosen, so the name box is off." : "A name is typed, so the directory choice is off."}</small>}
          </label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Date received<input name="receivedOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label>Method
            <select name="method" defaultValue="CHECK">
              {CONTRIBUTION_METHODS.map((method) => <option key={method} value={method}>{contributionMethodLabels[method]}</option>)}
            </select>
          </label>
          <label>Note (such as a check number)<input name="note" maxLength={200} autoComplete="off" /></label>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Record contribution"}</button></div>
        </form>
      </section>

      {pledgedAwards.length > 0 && (
        <section className="panel finance-list" aria-label="Pledges not yet received">
          <div className="finance-row finance-head"><span>Pledged by</span><span>Registration</span><span>Amount</span><span /></div>
          {pledgedAwards.map((award) => (
            <div className="finance-row" key={award.id}>
              <span><strong>{award.sponsorName}</strong><small>Awarded {award.createdOn}</small></span>
              <span><a className="text-link scholarship-fund-code-link" href={`/finance?event=${encodeURIComponent(eventId)}&registration=${encodeURIComponent(award.registrationId)}`}>{award.confirmationCode}</a></span>
              <span>{formatCents(award.amountCents)}</span>
              <span>
                <button className="secondary-button" type="button" disabled={saving || settleBlock(award) !== null} onClick={() => settle(award.id)}>Mark received</button>
                {settleBlock(award) && <small>{settleBlock(award)}</small>}
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="panel finance-list" aria-label="Contributions">
        <div className="finance-row finance-head"><span>Contribution</span><span>Date</span><span>Method</span><span>Amount</span></div>
        {fund.contributions.map((line) => (
          <div className="finance-row" key={line.id}>
            <span>
              <strong>{line.sponsorName}</strong>
              <small>{line.reversesContributionId ? `Reversal · ${line.note ?? ""}` : line.reversed ? "Reversed" : line.note ?? ""}</small>
              {!line.reversesContributionId && !line.reversed && (
                reversing === line.id ? (
                  <form className="form-stack" onSubmit={(event) => reverseContribution(event, line.id)}>
                    <label>Reason<input name="reason" minLength={3} maxLength={200} required autoComplete="off" /></label>
                    <div className="form-actions">
                      <button className="secondary-button" type="button" onClick={() => setReversing(null)}>Cancel</button>
                      <button className="primary-button" type="submit" disabled={saving}>Reverse</button>
                    </div>
                  </form>
                ) : (
                  <button className="text-button" type="button" onClick={() => { setError(""); setReversing(line.id); }}>Reverse</button>
                )
              )}
            </span>
            <span>{line.receivedOn}</span>
            <span>{contributionMethodLabels[line.method]}</span>
            <span>{line.amountCents < 0 ? "−" : ""}{formatCents(Math.abs(line.amountCents))}</span>
          </div>
        ))}
        {fund.contributions.length === 0 && <p className="quiet-copy">No contributions recorded.</p>}
      </section>

      <section className="panel finance-list" aria-label="Awards from the fund">
        <div className="finance-row finance-head"><span>Award</span><span>Registration</span><span>Status</span><span>Amount</span></div>
        {fund.awards.map((award) => (
          <div className="finance-row" key={award.id}>
            <span><strong>{award.sponsorName ?? "Fund (no one sponsor)"}</strong><small>{award.createdOn}</small></span>
            <span><a className="text-link scholarship-fund-code-link" href={`/finance?event=${encodeURIComponent(eventId)}&registration=${encodeURIComponent(award.registrationId)}`}>{award.confirmationCode}</a></span>
            <span>
              {!award.active ? "Reversed" : award.pledged ? (award.settled ? "Pledge received" : "Pledged, not yet received") : "Funded"}
              {award.registrationCancelled && <small className="form-error">Registration cancelled — reverse to return to fund</small>}
            </span>
            <span>{formatCents(award.amountCents)}</span>
          </div>
        ))}
        {fund.awards.length === 0 && <p className="quiet-copy">No awards from the fund yet.</p>}
      </section>
    </section>
  );
}
