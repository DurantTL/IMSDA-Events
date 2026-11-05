"use client";

import { ArrowLeft, CalendarPlus, ChevronRight, Files, Plus, UserPlus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { GuardedLink } from "@/components/guarded-link";
import { createEventHrefFor } from "@/components/system-navigation";
import { withCurrentEvent } from "@/components/staff-navigation";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import styles from "./staff-create-menu.module.css";

type Step = "start" | "event" | "form";

const titles: Record<Step, string> = {
  start: "Create something new",
  event: "Create an event",
  form: "What kind of form?",
};

/** Guides staff to existing creation workflows using their current permissions. */
export function StaffCreateMenu({ isSystemAdmin, clubFormsAccess, canManageForms, eventId }: {
  isSystemAdmin: boolean;
  clubFormsAccess: boolean;
  canManageForms: boolean;
  eventId: string;
}) {
  const [step, setStep] = useState<Step | null>(null);
  const titleId = useId();
  const close = () => setStep(null);
  const dialog = useAccessibleDialog<HTMLElement>(step !== null, close, { initialFocus: "dialog" });
  const open = step !== null;
  useEffect(() => {
    if (!open) return;
    const phone = window.matchMedia("(max-width: 800px)");
    const closeOnPhone = () => { if (phone.matches) setStep(null); };
    phone.addEventListener("change", closeOnPhone);
    return () => phone.removeEventListener("change", closeOnPhone);
  }, [open]);
  const eventHref = createEventHrefFor(isSystemAdmin);
  const forms = [
    ...(eventId && canManageForms ? [
      { href: withCurrentEvent("/registration-builder", eventId), label: "Event registration", description: "Register attendees for the selected event." },
      { href: withCurrentEvent("/information-forms", eventId), label: "Event information form", description: "Collect survey or interest responses for this event." },
    ] : []),
    ...(clubFormsAccess ? [{ href: "/admin/club-forms", label: "Club form", description: "Manage membership, consent, or club requirements." }] : []),
    ...(isSystemAdmin ? [{ href: "/admin/information-forms", label: "General information form", description: "Collect responses without an event." }] : []),
  ];
  if (!eventHref && !forms.length) return null;

  function show(next: Step) {
    setStep(next);
    dialog.current?.focus({ preventScroll: true });
  }

  return (
    <div className={styles.menu}>
      <button type="button" className={`primary-button ${styles.trigger}`} aria-haspopup="dialog" onClick={() => show("start")}>
        <Plus size={17} aria-hidden="true" /> Create
      </button>
      {step && createPortal(
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal-card ${styles.dialog}`}>
            <div className="modal-head">
              <h2 id={titleId}>{titles[step]}</h2>
              <button type="button" className={`icon-button modal-close-button ${styles.close}`} aria-label="Close create chooser" onClick={close}><X size={18} aria-hidden="true" /></button>
            </div>
            <div className={styles.choices}>
              {step === "start" && <>
                {eventHref && <button type="button" className={`secondary-button ${styles.choice}`} onClick={() => show("event")}>
                  <CalendarPlus size={20} aria-hidden="true" /><span><strong>Event</strong><small>Start blank, use a template, or copy a past event.</small></span><ChevronRight size={18} aria-hidden="true" />
                </button>}
                {forms.length > 0 && <button type="button" className={`secondary-button ${styles.choice}`} onClick={() => show("form")}>
                  <Files size={20} aria-hidden="true" /><span><strong>Form</strong><small>Choose its purpose and owner.</small></span><ChevronRight size={18} aria-hidden="true" />
                </button>}
                {clubFormsAccess && <GuardedLink href="/admin/clubs/applications" className={`secondary-button ${styles.choice}`} onNavigate={close}>
                  <UserPlus size={20} aria-hidden="true" /><span><strong>Club invitation</strong><small>Invite a director to apply for a new club.</small></span><ChevronRight size={18} aria-hidden="true" />
                </GuardedLink>}
              </>}
              {step === "event" && eventHref && [
                { href: "/event-setup/from-template", label: "Start from a template", description: "Reuse an existing event structure." },
                { href: "/event-setup/copy", label: "Copy a past event", description: "Bring forward settings and forms." },
                { href: `${eventHref}#blank-event`, label: "Start blank", description: "Create a private draft from the basics." },
              ].map(({ href, label, description }) => (
                <GuardedLink key={href} href={href} className={`secondary-button ${styles.choice}`} onNavigate={close}>
                  <CalendarPlus size={20} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span><ChevronRight size={18} aria-hidden="true" />
                </GuardedLink>
              ))}
              {step === "form" && forms.map(({ href, label, description }) => (
                <GuardedLink key={href} href={href} className={`secondary-button ${styles.choice}`} onNavigate={close}>
                  <Files size={20} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span><ChevronRight size={18} aria-hidden="true" />
                </GuardedLink>
              ))}
            </div>
            {step !== "start" && <div className="form-actions"><button type="button" className="secondary-button" onClick={() => show("start")}><ArrowLeft size={16} aria-hidden="true" /> Back</button></div>}
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
