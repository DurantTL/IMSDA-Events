// Template picker panels: start a form from a template, or replace the draft
// of the open form with a template.
import { ChevronRight, Layers3, X } from "lucide-react";
import { templatesForPicker } from "@/modules/forms/definition";
import { useBuilder } from "./builder-context";

export function BuilderDraftTemplatePanel() {
  const { selectedForm, busy, showDraftTemplates, setShowDraftTemplates, setDraftTemplateTarget, setDraftTemplateError, eventAudience, eventBillingMode, templates } = useBuilder();
  if (!showDraftTemplates || !selectedForm) return null;
  return (
    <section className="panel builder-template-panel" aria-labelledby="draft-template-picker-title"><div className="section-heading"><div><p className="eyebrow">Keep the same form and web address</p><h2 id="draft-template-picker-title">Update the draft of {selectedForm.name} from a template</h2></div><button className="icon-button modal-close-button" aria-label="Close templates" type="button" onClick={() => setShowDraftTemplates(false)}><X size={18} /></button></div><div className="template-card-grid">{templatesForPicker(templates, eventAudience, eventBillingMode).map((template) => <article className="template-card" key={template.key}><span><Layers3 size={20} /></span><small>{template.audience}</small><h3>{template.name}</h3><p>{template.description}</p><div>{template.sectionCount} sections · {template.fieldCount} fields</div><button className="secondary-button" type="button" disabled={busy !== null} onClick={() => { setDraftTemplateError(""); setDraftTemplateTarget({ key: template.key, name: template.name }); }}>Use for the draft <ChevronRight size={15} /></button></article>)}</div></section>
  );
}

export function BuilderNewTemplatePanel() {
  const { busy, showTemplates, setShowTemplates, createFromTemplate, eventAudience, eventBillingMode, templates } = useBuilder();
  if (!showTemplates) return null;
  return (
    <section className="panel builder-template-panel"><div className="section-heading"><div><p className="eyebrow">Start with a safe foundation</p><h2>Choose a template</h2></div><button className="icon-button modal-close-button" aria-label="Close templates" type="button" onClick={() => setShowTemplates(false)}><X size={18} /></button></div><div className="template-card-grid">{templatesForPicker(templates, eventAudience, eventBillingMode).map((template) => <article className="template-card" key={template.key}><span><Layers3 size={20} /></span><small>{template.audience}</small><h3>{template.name}</h3><p>{template.description}</p><div>{template.sectionCount} sections · {template.fieldCount} fields</div><button className="secondary-button" type="button" disabled={busy !== null} onClick={() => createFromTemplate(template.key)}>Use template <ChevronRight size={15} /></button></article>)}</div></section>
  );
}
