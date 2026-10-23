// A modal surface for the phone builder (#1071): the Move screen (full screen) and the question's More menu (a bottom
// sheet). It follows the #1046 picker's pattern: the page behind is inert and does not scroll, Tab stays inside, Escape
// closes it, a full-screen sheet covers exactly the visual viewport (so it ends at the keyboard) and focus goes back to
// the control that opened it. Closing only hides it: it never saves, discards or changes the draft.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tabStops, usePhoneModal } from "./use-phone-modal";

export function PhoneSheet({ title, closeLabel = "Close", variant = "full", onClose, children }: {
  title: string;
  /** The close button's words: "Done" on the Move screen, "Close" on a menu. */
  closeLabel?: string;
  variant?: "full" | "menu";
  onClose: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // A full-screen sheet covers exactly the visual viewport, so what it shows ends where the keyboard starts.
  usePhoneModal({ active: true, ref: rootRef, onClose, fit: variant === "full" });

  // Runs after the trap has noted what opened the sheet: focus goes to the first control (or the one marked), not the page.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? tabStops(panel)[0] ?? panel).focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div className={`fb-phone-sheet fb-phone-sheet-${variant}`} data-fb-sheet={variant} ref={rootRef}>
      {variant === "menu" && <div className="fb-phone-sheet-backdrop" aria-hidden="true" onClick={onClose} />}
      <div className="fb-phone-sheet-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
        <div className="fb-phone-sheet-bar">
          <h2 id={headingId}>{title}</h2>
          <button type="button" className="fb-btn outline" onClick={onClose}>{closeLabel}</button>
        </div>
        <div className="fb-phone-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
