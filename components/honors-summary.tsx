"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  type CurrentMemberHonor,
  type MemberHonorStatus,
  honorSummaryCounts,
  memberHonorStatusLabels,
} from "@/modules/honors/member-honor-domain";
import { formatCalendarDate } from "@/modules/club-registrations/domain";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";

const statusWords: Record<MemberHonorStatus, string> = { COMPLETED: "completed", IN_PROGRESS: "in progress" };

/**
 * The club Honors page's Honors column (#1012): the person's total with a
 * smaller completed / in-progress line, and a View button that opens the full
 * list. Every row is the same height however many honors a person has. With
 * no honors it says "None yet" and offers no View button.
 *
 * `honors` is always the whole person. While the page is filtered, the cell
 * says what the filter found for this person: an honor filter adds that
 * honor's status, and a status filter alone shows "N of TOTAL <status>".
 */
export function HonorsSummaryCell({
  honors,
  person,
  onView,
  honorFilter,
  statusFilter,
}: {
  honors: readonly CurrentMemberHonor[];
  person: string;
  onView: () => void;
  /** The honor the page is filtered to, when one is chosen. */
  honorFilter?: { id: string; name: string } | null;
  statusFilter?: MemberHonorStatus | null;
}) {
  const counts = honorSummaryCounts(honors);
  if (counts.total === 0) return <span className="honors-summary-none">None yet</span>;
  const noun = counts.total === 1 ? "honor" : "honors";
  const chosen = honorFilter ? honors.find((honor) => honor.honorId === honorFilter.id) : undefined;
  // Zero parts are left out ("8 completed", not "8 completed · 0 in progress").
  const parts = [
    counts.completed > 0 ? `${counts.completed} completed` : "",
    counts.inProgress > 0 ? `${counts.inProgress} in progress` : "",
  ].filter(Boolean);
  const statusOnly = statusFilter && !honorFilter;
  const matching = statusFilter === "COMPLETED" ? counts.completed : counts.inProgress;
  return (
    <div className="honors-summary">
      <div className="honors-summary-text">
        <strong>{counts.total} {noun}</strong>
        {chosen && honorFilter && (
          <small className="honors-summary-filter">
            <span translate="no">{honorFilter.name}</span>: {memberHonorStatusLabels[chosen.status]}
            {chosen.status === "COMPLETED" && chosen.completionDate ? ` ${formatCalendarDate(chosen.completionDate)}` : ""}
          </small>
        )}
        {statusOnly ? (
          <small>{matching} of {counts.total} {statusWords[statusFilter]}</small>
        ) : (
          <small>
            {parts.map((part, index) => (
              <Fragment key={part}>
                {index > 0 && <><span aria-hidden="true"> · </span><span className="sr-only">, </span></>}
                {part}
              </Fragment>
            ))}
          </small>
        )}
      </div>
      <button aria-haspopup="dialog" aria-label={`View ${noun} for ${person}`} className="secondary-button honors-summary-view" onClick={onView} type="button">View</button>
    </div>
  );
}

/** A read-only list of one person's current honors with their status, in the standard modal. */
export function MemberHonorsViewDialog({
  honors,
  person,
  onClose,
}: {
  honors: readonly CurrentMemberHonor[];
  person: string;
  onClose: () => void;
}) {
  const dialogRef = useAccessibleDialog<HTMLElement>(true, onClose);
  // The list scrolls inside a capped height, so it is a keyboard stop only while it actually scrolls.
  const listRef = useRef<HTMLUListElement>(null);
  const [listScrolls, setListScrolls] = useState(false);
  useEffect(() => {
    const node = listRef.current;
    setListScrolls(Boolean(node && node.scrollHeight > node.clientHeight + 1));
  }, [honors]);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <section aria-label={`Honors for ${person}`} aria-modal="true" className="modal-card member-honors-dialog" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="modal-head">
          <div>
            <p className="public-registration-eyebrow">Honors</p>
            <h2 translate="no">{person}</h2>
          </div>
          <button aria-label="Close" className="icon-button modal-close-button" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </div>
        {honors.length === 0 ? (
          <p className="public-manage-empty">No honors recorded yet.</p>
        ) : (
          <ul aria-label="Recorded honors" className="public-manage-club-list member-honors-list" ref={listRef} tabIndex={listScrolls ? 0 : undefined}>
            {honors.map((entry) => (
              <li key={entry.honorId}>
                <span>
                  <strong translate="no">{entry.honorName}</strong>
                  <small>
                    <span className="member-honor-status">{memberHonorStatusLabels[entry.status]}</span>{entry.completionDate ? ` · ${entry.completionDate}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="form-actions">
          <button className="secondary-button" onClick={onClose} type="button">Close</button>
        </div>
      </section>
    </div>
  );
}
