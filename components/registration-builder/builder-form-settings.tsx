// Form-wide settings: who the form registers (roster mode) and the confirmation message.
import { AlertTriangle } from "lucide-react";
import { localId, blankPreviewAttendees } from "./builder-types";
import { useLoadedBuilder } from "./builder-context";

export function BuilderRosterSettings() {
  const { definition, setPreviewAttendees, attendeeFields, hasAttendeeNameFields, roster, canEdit, replaceDefinition } = useLoadedBuilder();
  return (
        <section className="panel roster-builder-settings">
          <div className="section-heading">
            <div><p className="eyebrow">Registration mode</p><h2>Who can this form register?</h2></div>
            {roster?.enabled && <span className="count-badge">{attendeeFields.length} repeating field{attendeeFields.length === 1 ? "" : "s"}</span>}
          </div>
          <div className="roster-mode-options" role="group" aria-label="Registration mode">
            <button aria-pressed={!roster?.enabled} className={!roster?.enabled ? "selected" : ""} type="button" disabled={!canEdit} onClick={() => {
              if (!roster?.enabled) return;
              replaceDefinition({ ...definition, attendeeRoster: undefined });
              setPreviewAttendees([]);
            }}><strong>One attendee</strong><small>Attendee fields are completed once.</small></button>
            <button aria-pressed={Boolean(roster?.enabled)} className={roster?.enabled ? "selected" : ""} type="button" disabled={!canEdit || attendeeFields.length === 0} onClick={() => {
              if (roster?.enabled) return;
              const next = { enabled: true, minAttendees: 1, maxAttendees: 8, attendeeLabel: "Attendee", addButtonLabel: "Add another attendee" };
              replaceDefinition({ ...definition, attendeeRoster: next });
              setPreviewAttendees(blankPreviewAttendees({ ...definition, attendeeRoster: next }));
            }}><strong>Household or group</strong><small>Attendee fields repeat for every person.</small></button>
          </div>
          {attendeeFields.length === 0 && <p className="builder-gate"><AlertTriangle size={15} /> Change at least one field’s “Applies to” setting to Each attendee before enabling a roster.</p>}
          {roster?.enabled && <>
            {!hasAttendeeNameFields && <p className="builder-gate"><AlertTriangle size={15} /> Add attendee first/last name fields or a supported full-name field before saving.</p>}
            <div className="roster-settings-grid">
              <label>Minimum attendees<input disabled={!canEdit} type="number" min={1} max={roster.maxAttendees} value={roster.minAttendees} onChange={(event) => {
                const minAttendees = Math.max(1, Math.min(roster.maxAttendees, Number(event.target.value) || 1));
                replaceDefinition({ ...definition, attendeeRoster: { ...roster, minAttendees } });
                setPreviewAttendees((current) => current.length >= minAttendees ? current : [...current, ...Array.from({ length: minAttendees - current.length }, () => ({ clientId: localId("preview_attendee"), responses: {} }))]);
              }} /></label>
              <label>Maximum attendees<input disabled={!canEdit} type="number" min={roster.minAttendees} max={50} value={roster.maxAttendees} onChange={(event) => {
                const maxAttendees = Math.max(roster.minAttendees, Math.min(50, Number(event.target.value) || roster.minAttendees));
                replaceDefinition({ ...definition, attendeeRoster: { ...roster, maxAttendees } });
                setPreviewAttendees((current) => current.slice(0, maxAttendees));
              }} /></label>
              <label>Person label<input autoComplete="off" name="builder-rb-field-3" disabled={!canEdit} value={roster.attendeeLabel} maxLength={40} onChange={(event) => replaceDefinition({ ...definition, attendeeRoster: { ...roster, attendeeLabel: event.target.value } })} /></label>
              <label>Add-button text<input autoComplete="off" name="builder-rb-field-4" disabled={!canEdit} value={roster.addButtonLabel} maxLength={80} onChange={(event) => replaceDefinition({ ...definition, attendeeRoster: { ...roster, addButtonLabel: event.target.value } })} /></label>
            </div>
          </>}
        </section>
  );
}

export function BuilderConfirmationEditor() {
  const { definition, canEdit, replaceDefinition } = useLoadedBuilder();
  return (
    <section className="panel confirmation-editor"><label>Confirmation message<textarea autoComplete="off" name="builder-rb-note-19" disabled={!canEdit} value={definition.confirmationMessage} rows={3} maxLength={500} onChange={(event) => replaceDefinition({ ...definition, confirmationMessage: event.target.value })} /></label></section>
  );
}
