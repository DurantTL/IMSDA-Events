"use client";

import { useId } from "react";
import { MoveRight, TriangleAlert, Users, X } from "lucide-react";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import {
  ALL_SESSIONS_COLUMN,
  type BoardCard,
  type BoardSection,
  type MoveTarget,
  seatStatus,
  seatStatusLabels,
} from "@/modules/honors/schedule-board";
import styles from "./honors-schedule-agenda.module.css";

type TargetProblem = (card: BoardCard, target: MoveTarget) => string | null;

function columnsOf(section: BoardSection) {
  return [...section.sessions.map((session) => ({ key: session.id, name: session.name })), { key: ALL_SESSIONS_COLUMN, name: "All sessions" }];
}

/**
 * The schedule board as a list (#1580): per site, per session (and "All sessions"), each class with its room, seats,
 * instructors and the same chips as the board. "Move…" opens a dialog that lists every place with "Move here" or the reason
 * the place can't take the class. Nothing here decides a move: the board's own `onMove` and the server do.
 */
export function HonorsScheduleAgenda({ section, clashes, busy, onOpenMove }: {
  section: BoardSection;
  clashes: Map<string, string[]>;
  busy: boolean;
  onOpenMove: (card: BoardCard) => void;
}) {
  return (
    <div aria-label={`Agenda for ${section.name}`} className={styles.agenda} role="group">
      {columnsOf(section).map((column) => {
        const entries = section.rows.flatMap((row) => (row.cells.get(column.key) ?? []).map((card) => ({ card, room: row.room })));
        return (
          <div className={styles.group} key={column.key}>
            <h3>{column.name}</h3>
            {entries.length === 0 ? (
              <p className={styles.empty}>No classes.</p>
            ) : (
              <ul className={styles.list}>
                {entries.map(({ card, room }) => {
                  const status = seatStatus(card.seatsTaken, card.capacity);
                  const clash = clashes.get(card.id) ?? [];
                  const people = card.instructors.map((instructor) => instructor.name);
                  return (
                    <li className={styles.item} key={card.id}>
                      <strong>{card.title}</strong>
                      <div className={styles.meta}>
                        <span translate={room ? "no" : undefined}>{room ? room.name : "No room yet"}</span>
                        <span><Users aria-hidden="true" size={14} /> {card.seatsTaken} / {card.capacity} seats</span>
                        {status !== "OPEN" && <span className={`schedule-chip is-${status === "FULL" ? "full" : "nearly"}`}>{seatStatusLabels[status]}</span>}
                        {!card.isActive && <span className="schedule-chip">Inactive</span>}
                      </div>
                      {people.length > 0
                        ? <p>Instructor{people.length === 1 ? "" : "s"}: <span translate="no">{people.join(", ")}</span></p>
                        : card.teacherName && <p>Teacher: <span translate="no">{card.teacherName}</span></p>}
                      {clash.map((message) => (
                        <p key={message}><TriangleAlert aria-hidden="true" size={14} /> <span className="schedule-chip is-clash">Clash</span> {message}</p>
                      ))}
                      <button
                        aria-haspopup="dialog"
                        aria-label={`Move ${card.title}`}
                        className="secondary-button"
                        disabled={busy}
                        id={`sb-agenda-move-${card.id}`}
                        onClick={() => onOpenMove(card)}
                        type="button"
                      >
                        <MoveRight aria-hidden="true" size={14} /> Move…
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Every place (session by room) a class could go, each with "Move here" or why not. Escape or Close returns focus to Move. */
export function HonorsMoveDialog({ card, sections, targetProblem, busy, onMove, onClose }: {
  card: BoardCard | null;
  sections: BoardSection[];
  targetProblem: TargetProblem;
  busy: boolean;
  onMove: (card: BoardCard, target: MoveTarget) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useAccessibleDialog<HTMLElement>(card !== null, onClose);
  if (!card) return null;
  const hasSites = sections.length > 1 || sections.some((section) => section.siteId !== null);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <section aria-labelledby={titleId} aria-modal="true" className="modal-card" ref={dialogRef} role="dialog" tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>Move {card.title}</h2>
          <button aria-label="Close" className="icon-button modal-close-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className={styles.dialogBody}>
          <p className="field-help">Choose a place. A place that can&apos;t take the class says why.</p>
          {sections.map((section) => (
            <div key={section.siteId ?? "none"}>
              {hasSites && <p className={styles.dialogSite}><strong translate="no">{section.name}</strong></p>}
              {section.rows.map((row) => (
                <div key={row.room?.id ?? "none"}>
                  <p className={styles.dialogSite}><strong translate={row.room ? "no" : undefined}>{row.room ? row.room.name : "No room yet"}</strong></p>
                  <ul className={styles.places}>
                    {columnsOf(section).map((column) => {
                      const target: MoveTarget = { siteId: section.siteId, roomId: row.room?.id ?? null, column: column.key };
                      const problem = targetProblem(card, target);
                      return (
                        <li className={styles.place} key={column.key}>
                          <span>{column.name}</span>
                          {problem
                            ? <span className={styles.reason}>{problem}</span>
                            : (
                              <button
                                aria-label={`Move ${card.title} to ${row.room?.name ?? "no room"}, ${column.name}`}
                                className="primary-button"
                                disabled={busy}
                                onClick={() => onMove(card, target)}
                                type="button"
                              >
                                Move here
                              </button>
                            )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
