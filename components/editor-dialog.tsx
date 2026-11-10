"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";

/**
 * The focused editor sheet: a modal dialog for one product, variant, kind of item and the like. Initial focus, Tab
 * containment, Escape and focus return to the opener come from `useAccessibleDialog`; the caller decides what closing
 * means, including the "discard your changes?" question for a dirty form (delivered for merchandise in #1108).
 * `className` is the caller's own sheet class (width, sticky save row).
 */
export function EditorDialog({ children, className = "", closeLabel, eyebrow, onRequestClose, title }: {
  children: ReactNode;
  className?: string;
  closeLabel: string;
  eyebrow?: string;
  onRequestClose: () => void;
  title: string;
}) {
  const titleId = useId();
  const dialogRef = useAccessibleDialog<HTMLElement>(true, onRequestClose);
  return <div className="modal-backdrop" role="presentation"><section className={`modal-card ${className}`.trim()} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-head"><div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h2 id={titleId}>{title}</h2></div><button className="icon-button modal-close-button" type="button" aria-label={closeLabel} onClick={onRequestClose}><X size={18} aria-hidden="true" /></button></div>{children}</section></div>;
}
