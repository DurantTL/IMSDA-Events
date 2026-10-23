// Event forms and version history: the form switcher beside the editor.
import { ChevronRight, FileClock, RotateCcw } from "lucide-react";
import { canRestoreVersion, restoreButtonId, versionStateLabel, versionWhoWhen } from "./version-history";
import { statusLabel } from "./builder-types";
import { useBuilder } from "./builder-context";

// A form's versions. The editor shell's History tab (#1132, #1140) shows who and when for each and offers Restore as
// draft; the form switcher's list stays the compact read-only one.
export function BuilderVersionHistory({ detailed = false }: { detailed?: boolean }) {
  const { selectedForm, selectedVersion, chooseVersion, restoreVersion, busy, information } = useBuilder();
  if (!selectedForm) return null;
  const versions = selectedForm.versions;
  if (!detailed) {
    return <div className="version-history"><p className="eyebrow">Version history</p>{versions.map((version) => <button aria-pressed={version.id === selectedVersion?.id} className={version.id === selectedVersion?.id ? "selected" : ""} type="button" key={version.id} onClick={() => chooseVersion(version)}><FileClock size={15} /><span><strong>Version {version.versionNumber}</strong><small>{statusLabel(version.status)}{information ? "" : ` · ${version.testSubmissionCount} tests`}</small></span></button>)}</div>;
  }
  return (
    <div className="version-history version-history-detailed"><p className="eyebrow">Version history</p>
      <ul className="version-history-list">{versions.map((version) => (
        <li className="version-history-row" key={version.id}>
          <button aria-pressed={version.id === selectedVersion?.id} className={version.id === selectedVersion?.id ? "selected" : ""} type="button" onClick={() => chooseVersion(version)}>
            <FileClock size={15} />
            <span><strong>Version {version.versionNumber} · {versionStateLabel(version, versions)}</strong><small>{versionWhoWhen(version)}</small>{!information && <small>{version.testSubmissionCount} tests</small>}</span>
          </button>
          {canRestoreVersion(version) && <button className="version-restore" id={restoreButtonId(version.id)} type="button" disabled={busy !== null} onClick={() => restoreVersion(version)}><RotateCcw size={14} /> Restore version {version.versionNumber} as draft</button>}
        </li>
      ))}</ul>
    </div>
  );
}

export function BuilderFormList() {
  const { forms, selectedFormId, selectedForm, chooseForm, information } = useBuilder();
  return (
    <aside className="panel builder-form-list"><div className="section-heading"><div><p className="eyebrow">{information ? "Information form" : "Event forms"}</p><h2>{forms.length} form{forms.length === 1 ? "" : "s"}</h2></div></div><div className="builder-form-buttons">{forms.map((form) => <button aria-pressed={form.id === selectedFormId} className={form.id === selectedFormId ? "selected" : ""} type="button" key={form.id} onClick={() => chooseForm(form)}><span><strong>{form.name}</strong><small>Version {form.activeVersion.versionNumber} · {statusLabel(form.activeVersion.status)}</small></span><ChevronRight size={16} /></button>)}</div>{selectedForm && <BuilderVersionHistory />}</aside>
  );
}
