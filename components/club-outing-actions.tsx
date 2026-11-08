"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { announceClubForms } from "@/components/club-forms-status";
import { SubmitButton } from "@/components/submit-button";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { outingSendOutcomeText, type OutingSendOutcome } from "@/modules/club-forms/outing-domain";
import styles from "./club-outing-form.module.css";

type SendResult = { memberId: string; name: string; outcome: OutingSendOutcome };

async function postSend(organizationId: string, outingId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/forms/outings/${encodeURIComponent(outingId)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { message?: string; sent?: number; results?: SendResult[] };
  return { ok: response.ok, result };
}

/**
 * Sends the outing's slip to the chosen members' parents (#1672). Each family gets its own private link in its own
 * email, the same link and email flow as any club form link. A member with no parent email on the roster can't be
 * picked: the roster is where that is added.
 */
export function SendOutingPanel({
  organizationId,
  outingId,
  choices,
  defaultDays,
  rosterHref,
}: {
  organizationId: string;
  outingId: string;
  choices: Array<{ id: string; name: string; hasParentEmail: boolean }>;
  defaultDays: number;
  rosterHref: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState(String(defaultDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<SendResult[]>([]);
  useUnsavedChangesGuard(selected.length > 0, "You have not sent these slips yet. Leave this page and discard your choices?");

  const sendable = choices.filter((choice) => choice.hasParentEmail);
  const allSelected = sendable.length > 0 && selected.length === sendable.length;

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setResults([]);
    try {
      const { ok, result } = await postSend(organizationId, outingId, { memberIds: selected, expiresInDays: Number(days) });
      if (!ok) {
        setError(result.message ?? "The slips could not be sent.");
        return;
      }
      setResults(result.results ?? []);
      setSelected([]);
      announceClubForms(`${result.sent ?? 0} ${result.sent === 1 ? "slip" : "slips"} sent.`);
      router.refresh();
    } catch {
      setError("The slips could not be sent. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form-stack" noValidate onSubmit={send}>
      {choices.length === 0 ? (
        <p className="field-help">Every youth member on this year&apos;s roster already has a slip for this outing. Use Resend below to send one again.</p>
      ) : (
        <>
          <p className="field-help">Choose the members going. Each parent gets their own private link by email. A link works once and shows nothing else about the club.</p>
          <label className="checkbox-label">
            <input checked={allSelected} disabled={sendable.length === 0} onChange={(event) => setSelected(event.target.checked ? sendable.map((choice) => choice.id) : [])} type="checkbox" />
            Choose everyone with a parent email ({sendable.length})
          </label>
          <ul className={styles.choices}>
            {choices.map((choice) => (
              <li key={choice.id}>
                <label className="checkbox-label">
                  <input
                    checked={selected.includes(choice.id)}
                    disabled={!choice.hasParentEmail}
                    onChange={(event) => setSelected((current) => (event.target.checked ? [...current, choice.id] : current.filter((id) => id !== choice.id)))}
                    type="checkbox"
                  />
                  <span translate="no">{choice.name}</span>
                  {!choice.hasParentEmail && <small className="field-help"> No parent email on the roster</small>}
                </label>
              </li>
            ))}
          </ul>
          {choices.some((choice) => !choice.hasParentEmail) && (
            <p className="field-help"><a href={rosterHref}>Add a parent email on the roster</a>, then come back to send.</p>
          )}
          <label>Links expire after (days)
            <input max={30} min={1} onChange={(event) => setDays(event.target.value)} required type="number" value={days} />
          </label>
        </>
      )}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {results.length > 0 && (
        <ul aria-label="Send results" className={styles.results} role="status">
          {results.map((result) => (
            <li key={result.memberId}><span translate="no">{result.name || "Unknown member"}</span>: {outingSendOutcomeText[result.outcome]}</li>
          ))}
        </ul>
      )}
      {choices.length > 0 && (
        <div className="intro-actions">
          <SubmitButton className="primary-button" disabled={selected.length === 0} icon={<Send aria-hidden="true" size={14} />} label={`Send to ${selected.length} ${selected.length === 1 ? "family" : "families"}`} submitting={saving} submittingLabel="Sending…" />
        </div>
      )}
    </form>
  );
}

/** Sends one member's slip again: a lost email, or a link that expired. Only the newest link works. */
export function ResendOutingButton({ organizationId, outingId, memberId, name }: { organizationId: string; outingId: string; memberId: string; name: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function resend() {
    setSaving(true);
    setMessage("");
    setFailed(false);
    try {
      const { ok, result } = await postSend(organizationId, outingId, { memberIds: [memberId], resend: true });
      const outcome = result.results?.[0]?.outcome;
      if (!ok || outcome !== "SENT") {
        setFailed(true);
        setMessage(!ok ? result.message ?? "The slip could not be sent." : outcome ? outingSendOutcomeText[outcome] : "The slip could not be sent.");
        return;
      }
      setMessage("Sent again.");
      announceClubForms("Slip sent again.");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("The slip could not be sent. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="secondary-button" disabled={saving} onClick={resend} type="button">
        <Send aria-hidden="true" size={13} /> {saving ? "Sending…" : "Resend"}<span className="sr-only"> to the parent of {name}</span>
      </button>
      {message && <small className={failed ? "club-report-problem" : "field-help"} role={failed ? "alert" : "status"}>{message}</small>}
    </>
  );
}

/** Closes the outing: links still open stop working and nothing more can be sent. Signed slips stay. */
export function CloseOutingButton({ organizationId, outingId, openCount }: { organizationId: string; outingId: string; openCount: number }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { confirm: askConfirm, confirmDialog } = useConfirm();

  async function close() {
    if (!(await askConfirm({
      title: "Close this outing",
      body: <p>{openCount > 0 ? `${openCount} ${openCount === 1 ? "link that hasn't" : "links that haven't"} been signed will stop working. ` : ""}Slips already signed stay on file. You can&apos;t send more for this outing.</p>,
      confirmLabel: "Close outing",
      destructive: true,
    }))) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/attendee/clubs/${encodeURIComponent(organizationId)}/forms/outings/${encodeURIComponent(outingId)}/close`, { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { message?: string };
        setError(result.message ?? "The outing could not be closed.");
        return;
      }
      announceClubForms("Outing closed.");
      router.refresh();
    } catch {
      setError("The outing could not be closed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {confirmDialog}
      <button className="secondary-button" disabled={saving} onClick={close} type="button">{saving ? "Closing…" : "Close outing"}</button>
      {error && <small className="club-report-problem" role="alert">{error}</small>}
    </>
  );
}

