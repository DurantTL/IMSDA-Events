// Event forms and version history: the form switcher beside the editor.
import { ChevronRight, FileClock } from "lucide-react";
import { statusLabel } from "./builder-types";
import { useBuilder } from "./builder-context";

export function BuilderFormList() {
  const { forms, selectedFormId, selectedForm, selectedVersion, chooseForm, chooseVersion } = useBuilder();
  return (
    <aside className="panel builder-form-list"><div className="section-heading"><div><p className="eyebrow">Event forms</p><h2>{forms.length} form{forms.length === 1 ? "" : "s"}</h2></div></div><div className="builder-form-buttons">{forms.map((form) => <button aria-pressed={form.id === selectedFormId} className={form.id === selectedFormId ? "selected" : ""} type="button" key={form.id} onClick={() => chooseForm(form)}><span><strong>{form.name}</strong><small>Version {form.activeVersion.versionNumber} · {statusLabel(form.activeVersion.status)}</small></span><ChevronRight size={16} /></button>)}</div>{selectedForm && <div className="version-history"><p className="eyebrow">Version history</p>{selectedForm.versions.map((version) => <button aria-pressed={version.id === selectedVersion?.id} className={version.id === selectedVersion?.id ? "selected" : ""} type="button" key={version.id} onClick={() => chooseVersion(version)}><FileClock size={15} /><span><strong>Version {version.versionNumber}</strong><small>{statusLabel(version.status)} · {version.testSubmissionCount} tests</small></span></button>)}</div>}</aside>
  );
}
