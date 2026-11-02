"use client";

// The list of information forms (#1149) with "New form", shared by the system-admin page (general forms) and the event
// workspace page (an event's forms). Creating a form goes to the information-forms API for that scope and then opens it
// in the builder. The list only links: the builder and the responses page are separate pages.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { cardCell } from "@/components/table-card-labels";
import { useTableSort, type ColumnSpec } from "@/components/use-table-sort";
import { informationApiBase, informationBuilderHref, informationPublicPath, informationResponsesHref, type InformationBuilderConfig, type InformationFillAccess, type InformationFormStatus } from "@/components/registration-builder/information-mode";

export type InformationFormListItem = {
  id: string;
  name: string;
  slug: string;
  status: InformationFormStatus;
  fillAccess: InformationFillAccess;
  responseCount: number;
  /** Whether a version has been published. */
  published: boolean;
  updatedAt: string;
};

export type InformationFormTemplateChoice = { key: string; name: string; description: string };

const statusWords: Record<InformationFormStatus, string> = { DRAFT: "Not open yet", OPEN: "Open", CLOSED: "Closed" };
const accessWords: Record<InformationFillAccess, string> = { ANYONE_WITH_LINK: "Anyone with the link", SIGNED_IN: "Signed-in people" };

// Sorts from its headers (#1458); the keys here are the whitelist.
const FORM_SORT: Record<"form" | "status" | "access" | "answers" | "link", ColumnSpec<InformationFormListItem>> = {
  form: { value: (form) => form.name, label: "form" },
  status: { value: (form) => statusWords[form.status], label: "status" },
  access: { value: (form) => accessWords[form.fillAccess], label: "who can fill it" },
  answers: { value: (form) => form.responseCount, label: "answers", kind: "number" },
  link: { value: (form) => form.slug, label: "public link" },
};

export function InformationFormsHome({ config, forms, templates }: { config: InformationBuilderConfig; forms: InformationFormListItem[]; templates: InformationFormTemplateChoice[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(forms.length === 0);
  const [name, setName] = useState("");
  const [fillAccess, setFillAccess] = useState<InformationFillAccess>("ANYONE_WITH_LINK");
  const [templateKey, setTemplateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sorted = useTableSort(forms, FORM_SORT);

  async function create() {
    if (name.trim().length < 3) { setError("Give the form a name of at least 3 characters."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(informationApiBase(config), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), fillAccess, ...(templateKey ? { templateKey } : {}) }),
      });
      const result = await response.json().catch(() => ({})) as { form?: { id: string }; message?: unknown };
      if (!response.ok || !result.form) throw new Error(typeof result.message === "string" && result.message ? result.message : "Unable to create this form.");
      router.push(informationBuilderHref(config, result.form.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create this form.");
      setBusy(false);
    }
  }

  return (
    <section className="page-stack information-forms-home">
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">{config.scope === "EVENT" ? config.ownerLabel : "General forms"}</p><h2>{`${forms.length} information form${forms.length === 1 ? "" : "s"}`}</h2></div>
          <button className="secondary-button" type="button" aria-expanded={creating} onClick={() => setCreating((open) => !open)}><Plus size={16} aria-hidden="true" /> New form</button>
        </div>
        <p className="quiet-copy">Surveys, interest forms and post-event forms that gather answers only. They never register anyone, and they cannot take payment or ask for health or other sensitive answers.</p>
        {creating && (
          <form className="form-stack information-forms-new" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label>Form name<input autoComplete="off" name="information-form-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
            <label>Who can fill it
              <select name="information-form-access" value={fillAccess} onChange={(event) => setFillAccess(event.target.value as InformationFillAccess)}>
                <option value="ANYONE_WITH_LINK">Anyone with the link</option>
                <option value="SIGNED_IN">Signed-in people only</option>
              </select>
            </label>
            <label>Start from
              <select name="information-form-template" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
                <option value="">A blank form</option>
                {templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
              </select>
            </label>
            {templateKey && <p className="field-help">{templates.find((template) => template.key === templateKey)?.description}</p>}
            {templates.length === 0 && <p className="field-help">No information form templates yet. A system administrator can add one in Form templates by setting who it is for to &ldquo;Information&rdquo;.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating…" : "Create form"}</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => { setCreating(false); setError(""); }}>Cancel</button>
            </div>
          </form>
        )}
      </section>
      {forms.length > 0 && (
        <section className="panel">
          <div className="report-table-wrap">
            {sorted.note}
            <table role="table" className="report-table table-cards">
              <caption className="sr-only">Information forms</caption>
              <thead role="rowgroup">
                <tr role="row">{sorted.header("form", "Form")}{sorted.header("status", "Status")}{sorted.header("access", "Who can fill it")}{sorted.header("answers", "Answers")}{sorted.header("link", "Public link")}<th role="columnheader" scope="col"><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody role="rowgroup">
                {sorted.rows.map((form) => (
                  <tr role="row" key={form.id}>
                    <th role="rowheader" scope="row">{form.name}</th>
                    <td {...cardCell("Status")}>{statusWords[form.status]}{form.status === "DRAFT" && form.published ? " (published)" : ""}</td>
                    <td {...cardCell("Who can fill it")}>{accessWords[form.fillAccess]}</td>
                    <td {...cardCell("Answers")}><Link href={informationResponsesHref(config, form.id)}>{form.responseCount}</Link></td>
                    <td {...cardCell("Public link")}><code>{informationPublicPath(config, form.slug)}</code></td>
                    <td {...cardCell(null)}><Link className="secondary-button" href={informationBuilderHref(config, form.id)}>Edit<span className="sr-only"> {form.name}</span></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
