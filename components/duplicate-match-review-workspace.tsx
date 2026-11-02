"use client";

import { useState } from "react";
import {
  Clock,
  GitMerge,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  Undo2,
  UsersRound,
  X,
} from "lucide-react";
import styles from "./duplicate-match-review-workspace.module.css";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import type { PersonMatchCandidateRecord } from "@/modules/people/duplicate-match-repository";
import type { PersonMergeRecord } from "@/modules/people/person-merge-repository";
import { EmptyState } from "@/components/empty-state";

const signalLabels: Record<string, string> = {
  PHONE_MATCH: "Same phone number",
  SAME_SURNAME: "Same last name",
  SAME_FULL_NAME: "Same first and last name",
  HOUSEHOLD_SHARED: "Share a household",
  EXTERNAL_IDENTITY_SHARED: "Same external system identity",
  PHONE_MISMATCH: "Different phone numbers",
};

function signalLabel(signal: string) {
  return signalLabels[signal] ?? signal;
}

function personLine(person: { firstName: string; lastName: string }) {
  return `${person.firstName} ${person.lastName}`;
}

function ConfidenceChip({ confidence }: { confidence: string }) {
  const className = confidence === "HIGH" ? "gold" : confidence === "MEDIUM" ? "purple" : "";
  return <span className={`status-chip ${className}`}>{confidence === "HIGH" ? "High confidence" : confidence === "MEDIUM" ? "Medium confidence" : "Low confidence"}</span>;
}

type CandidatesResponse = {
  candidates?: PersonMatchCandidateRecord[];
  merges?: PersonMergeRecord[];
  candidate?: PersonMatchCandidateRecord;
  merge?: { id: string; state: string };
  result?: { created: number; superseded: number; unchanged: number; evaluated: number };
  message?: string;
  issues?: Array<{ message?: string }>;
};

export function DuplicateMatchReviewWorkspace({
  initialCandidates,
  initialMerges = [],
}: {
  initialCandidates: PersonMatchCandidateRecord[];
  initialMerges?: PersonMergeRecord[];
}) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [merges, setMerges] = useState(initialMerges);
  const [busyId, setBusyId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dismissing, setDismissing] = useState<PersonMatchCandidateRecord | null>(null);
  const [reason, setReason] = useState("");
  const dialogRef = useAccessibleDialog<HTMLElement>(Boolean(dismissing), closeDismiss);
  const [merging, setMerging] = useState<PersonMatchCandidateRecord | null>(null);
  const [primaryPersonId, setPrimaryPersonId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const mergeDialogRef = useAccessibleDialog<HTMLElement>(Boolean(merging), closeMerge);
  const [unmerging, setUnmerging] = useState<PersonMergeRecord | null>(null);
  const [unmergeReason, setUnmergeReason] = useState("");
  const unmergeDialogRef = useAccessibleDialog<HTMLElement>(Boolean(unmerging), closeUnmerge);

  function closeDismiss() {
    if (busyId) return;
    setDismissing(null);
    setReason("");
  }

  function closeMerge() {
    if (busyId) return;
    setMerging(null);
    setPrimaryPersonId("");
    setMergeReason("");
  }

  function closeUnmerge() {
    if (busyId) return;
    setUnmerging(null);
    setUnmergeReason("");
  }

  async function readResponse(response: Response) {
    const result = await response.json().catch(() => ({})) as CandidatesResponse;
    if (!response.ok) {
      throw new Error(result.message ?? result.issues?.[0]?.message ?? "That request could not be completed.");
    }
    return result;
  }

  /** Reloads both lists so the screen shows what is actually stored. */
  async function refreshLists() {
    const [candidateResult, mergeResult] = await Promise.all([
      fetch("/api/people/matches", { cache: "no-store" }).then(readResponse),
      fetch("/api/people/merges", { cache: "no-store" }).then(readResponse),
    ]);
    setCandidates(candidateResult.candidates ?? []);
    setMerges(mergeResult.merges ?? []);
  }

  async function runGeneration() {
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/people/matches", { method: "POST" });
      const result = await readResponse(response);
      setCandidates(result.candidates ?? []);
      setNotice(
        result.result
          ? `Scan complete: ${result.result.created} new or updated candidate${result.result.created === 1 ? "" : "s"}, ${result.result.unchanged} unchanged.`
          : "Scan complete.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That scan could not be completed.");
    } finally {
      setGenerating(false);
    }
  }

  async function defer(candidate: PersonMatchCandidateRecord) {
    setBusyId(candidate.id);
    setError("");
    setNotice("");
    try {
      await fetch(`/api/people/matches/${candidate.id}/defer`, { method: "POST" });
      setNotice(`Deferred ${personLine(candidate.personA)} / ${personLine(candidate.personB)} — it stays in the queue for later review.`);
    } catch {
      setError("That candidate could not be deferred.");
    } finally {
      setBusyId("");
    }
  }

  async function submitDismiss(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dismissing) return;
    setBusyId(dismissing.id);
    setError("");
    try {
      const response = await fetch(`/api/people/matches/${dismissing.id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      await readResponse(response);
      setCandidates((current) => current.filter((candidate) => candidate.id !== dismissing.id));
      setNotice(`Dismissed ${personLine(dismissing.personA)} / ${personLine(dismissing.personB)}.`);
      setDismissing(null);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That candidate could not be dismissed.");
    } finally {
      setBusyId("");
    }
  }

  async function submitMerge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!merging || !primaryPersonId) return;
    setBusyId(merging.id);
    setError("");
    try {
      const response = await fetch(`/api/people/matches/${merging.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryPersonId, reason: mergeReason }),
      });
      await readResponse(response);
      const primary = merging.personA.id === primaryPersonId ? merging.personA : merging.personB;
      const secondary = merging.personA.id === primaryPersonId ? merging.personB : merging.personA;
      setCandidates((current) => current.filter((candidate) => candidate.id !== merging.id));
      // The stored link can differ from the pair picked (a person who was already merged resolves to its primary).
      await refreshLists().catch(() => undefined);
      setNotice(`Merged ${personLine(secondary)} with ${personLine(primary)}. Both records are kept, and you can unmerge below.`);
      setMerging(null);
      setPrimaryPersonId("");
      setMergeReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those people could not be merged.");
    } finally {
      setBusyId("");
    }
  }

  async function submitUnmerge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unmerging) return;
    setBusyId(unmerging.id);
    setError("");
    try {
      const response = await fetch(`/api/people/merges/${unmerging.id}/unmerge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: unmergeReason }),
      });
      await readResponse(response);
      setMerges((current) => current.filter((merge) => merge.id !== unmerging.id));
      await refreshLists().catch(() => undefined);
      setNotice(`Unmerged ${personLine(unmerging.secondaryPerson)} from ${personLine(unmerging.primaryPerson)}. They are separate people again, and the pair is back in the queue if it is still a candidate.`);
      setUnmerging(null);
      setUnmergeReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That merge could not be reversed.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Identity</p>
          <h2>Possible duplicate people</h2>
          <p>
            People who may be the same person, based on rule-based evidence — never applied
            automatically. Review the evidence for each pair, then dismiss it, defer it for later,
            or merge the records. A merge links the two records and keeps both with their full
            history, and it can be undone.
          </p>
        </div>
        <div className="intro-actions">
          <button className="secondary-button" type="button" onClick={runGeneration} disabled={generating}>
            <RefreshCw aria-hidden="true" size={15} /> {generating ? "Scanning…" : "Scan for new candidates"}
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}

      {candidates.length === 0 ? (
        <EmptyState action={{ label: "Scan for new candidates", onClick: runGeneration }} actionClass="secondary-button" canCreate={!generating} className="panel empty-state" icon={<ShieldCheck aria-hidden="true" size={24} />} title="Nothing open for review">A scan looks for shared phone numbers, household and surname overlaps, or shared external identities.</EmptyState>
      ) : (
        <section className="panel duplicate-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Open candidates</p>
              <h2>{candidates.length} pair{candidates.length === 1 ? "" : "s"} to review</h2>
            </div>
          </div>
          {candidates.map((candidate) => (
            <article className="duplicate-group" key={candidate.id}>
              <header>
                <ConfidenceChip confidence={candidate.confidence} />
                <strong>{personLine(candidate.personA)} &amp; {personLine(candidate.personB)}</strong>
                <small>Rule version {candidate.ruleVersion} · computed {new Date(candidate.computedAt).toLocaleString()}</small>
              </header>

              <ul className="duplicate-member-list">
                {[candidate.personA, candidate.personB].map((person) => (
                  <li key={person.id}>
                    <span>
                      <strong>{personLine(person)}</strong>
                      <small className="duplicate-contact">
                        {person.normalizedEmail && <span><Mail aria-hidden="true" size={12} /> {person.normalizedEmail}</span>}
                        {person.phone && <span><Phone aria-hidden="true" size={12} /> {person.phone}</span>}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="quiet-copy">
                <strong>Matched:</strong>{" "}
                {candidate.matchedSignals.length > 0
                  ? candidate.matchedSignals.map(signalLabel).join(" · ")
                  : "—"}
                {candidate.contradictingSignals.length > 0 && (
                  <>
                    <br /><strong>Contradicting:</strong>{" "}
                    {candidate.contradictingSignals.map(signalLabel).join(" · ")}
                  </>
                )}
              </div>

              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyId === candidate.id}
                  onClick={() => { setDismissing(candidate); setReason(""); }}
                >
                  <X aria-hidden="true" size={15} /> Dismiss
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyId === candidate.id}
                  onClick={() => defer(candidate)}
                >
                  <Clock aria-hidden="true" size={15} /> Defer
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={busyId === candidate.id}
                  onClick={() => { setMerging(candidate); setPrimaryPersonId(candidate.personA.id); setMergeReason(""); }}
                >
                  <GitMerge aria-hidden="true" size={15} /> Merge
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {merges.length > 0 && (
        <section className="panel duplicate-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Merged people</p>
              <h2>{merges.length} active merge{merges.length === 1 ? "" : "s"}</h2>
            </div>
          </div>
          {merges.map((merge) => (
            <article className="duplicate-group" key={merge.id}>
              <header>
                <strong>{personLine(merge.secondaryPerson)} merged under {personLine(merge.primaryPerson)}</strong>
                <small>Merged {new Date(merge.mergedAt).toLocaleString()} · {merge.reason}</small>
              </header>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyId === merge.id}
                  onClick={() => { setUnmerging(merge); setUnmergeReason(""); }}
                >
                  <Undo2 aria-hidden="true" size={15} /> Unmerge
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {merging && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) closeMerge(); }}>
          <section className="modal-card" ref={mergeDialogRef} role="dialog" aria-modal="true" aria-labelledby="merge-match-title" tabIndex={-1}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Same person</p>
                <h2 id="merge-match-title">Merge these people</h2>
              </div>
              <button className="icon-button modal-close-button" type="button" aria-label="Close dialog" onClick={closeMerge}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="confirm-copy">
              {personLine(merging.personA)} and {personLine(merging.personB)} will be linked as one person.
              Both records and everything that points at them stay exactly as they are, and you can
              unmerge later.
            </p>
            <form className="form-stack" onSubmit={submitMerge}>
              <fieldset className={styles.primaryChoice}>
                <legend>Keep as the primary person</legend>
                {[merging.personA, merging.personB].map((person) => (
                  <label className={styles.radioRow} key={person.id}>
                    <input
                      type="radio"
                      name="primaryPersonId"
                      value={person.id}
                      checked={primaryPersonId === person.id}
                      onChange={() => setPrimaryPersonId(person.id)}
                    />
                    {personLine(person)}
                  </label>
                ))}
              </fieldset>
              <label>
                Reason <small>Required, at least five characters</small>
                <textarea
                  name="reason"
                  rows={3}
                  required
                  minLength={5}
                  maxLength={500}
                  value={mergeReason}
                  onChange={(event) => setMergeReason(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={closeMerge} disabled={Boolean(busyId)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={Boolean(busyId) || !primaryPersonId || mergeReason.trim().length < 5}>
                  {busyId ? "Merging…" : "Merge people"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {unmerging && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) closeUnmerge(); }}>
          <section className="modal-card" ref={unmergeDialogRef} role="dialog" aria-modal="true" aria-labelledby="unmerge-title" tabIndex={-1}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Undo a merge</p>
                <h2 id="unmerge-title">Unmerge these people</h2>
              </div>
              <button className="icon-button modal-close-button" type="button" aria-label="Close dialog" onClick={closeUnmerge}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="confirm-copy">
              {personLine(unmerging.secondaryPerson)} will be a separate person again, apart from {personLine(unmerging.primaryPerson)}.
              The merge is kept in the history as reversed.
            </p>
            <form className="form-stack" onSubmit={submitUnmerge}>
              <label>
                Reason <small>Required, at least five characters</small>
                <textarea
                  name="reason"
                  rows={3}
                  required
                  minLength={5}
                  maxLength={500}
                  value={unmergeReason}
                  onChange={(event) => setUnmergeReason(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={closeUnmerge} disabled={Boolean(busyId)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={Boolean(busyId) || unmergeReason.trim().length < 5}>
                  {busyId ? "Unmerging…" : "Unmerge people"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {dismissing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) closeDismiss(); }}>
          <section className="modal-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dismiss-match-title" tabIndex={-1}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Not the same person</p>
                <h2 id="dismiss-match-title">Dismiss this candidate</h2>
              </div>
              <button className="icon-button modal-close-button" type="button" aria-label="Close dialog" onClick={closeDismiss}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="confirm-copy">
              {personLine(dismissing.personA)} and {personLine(dismissing.personB)} will be marked as reviewed
              and not the same person. This pair will not reappear unless something about their
              records changes.
            </p>
            <form className="form-stack" onSubmit={submitDismiss}>
              <label>
                Reason <small>Required, at least five characters</small>
                <textarea
                  name="reason"
                  rows={3}
                  required
                  minLength={5}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={closeDismiss} disabled={Boolean(busyId)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={Boolean(busyId) || reason.trim().length < 5}>
                  {busyId ? "Dismissing…" : "Dismiss candidate"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <section className="boundary-callout">
        <UsersRound aria-hidden="true" size={20} />
        <span>
          <strong>Evidence, not action</strong>
          <small>
            Nothing here merges records on its own at any confidence; a merge always needs a choice
            and a reason from staff. This queue shows only the names, contact fields, and matched signals needed to decide whether two people are the same
            — not registrations, payments, medical, or consent records.
          </small>
        </span>
      </section>
    </section>
  );
}
