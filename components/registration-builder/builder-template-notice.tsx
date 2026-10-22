// The "template changed" notice (#1065). It only informs: nothing here changes the form. "Update draft from a template"
// opens the same replace-the-draft confirmation as the picker (pinned to the version the notice names), and "Dismiss for
// this version" hides the notice until the template changes again.
import { Layers3 } from "lucide-react";
import { useBuilder } from "./builder-context";

export function BuilderTemplateNotice() {
  const { selectedForm, busy, canEdit, setDraftTemplateError, setDraftTemplateTarget, dismissTemplateNotice } = useBuilder();
  const notice = selectedForm?.templateNotice;
  if (!selectedForm || !notice) return null;
  return (
    <section className="panel" data-testid="template-changed-notice" aria-labelledby="template-changed-title">
      <p className="eyebrow">Template changed</p>
      <h3 id="template-changed-title">The {notice.templateName} template has changed since this form was made</h3>
      <p className="field-help" role="status">
        This form was made from version {notice.appliedVersion}; the template is now at version {notice.latestVersion}. Nothing on this form has changed, and nothing will change unless you choose to update the draft.
      </p>
      <div className="builder-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={!canEdit || busy !== null}
          onClick={() => { setDraftTemplateError(""); setDraftTemplateTarget({ key: notice.templateKey, name: notice.templateName, versionId: notice.latestVersionId }); }}
        >
          <Layers3 size={15} /> Update draft from a template
        </button>
        <button className="secondary-button" type="button" disabled={busy !== null} onClick={dismissTemplateNotice}>
          {busy === "dismiss-notice" ? "Dismissing…" : "Dismiss for this version"}
        </button>
      </div>
    </section>
  );
}
