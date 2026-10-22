"use client";

import { SubmitButton } from "@/components/submit-button";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Creates a form template as a copy of an existing one (#1064), then opens it in
 * the editor. Nothing that exists changes: not the source template, and no form
 * or live form version made from it.
 */
export function FormTemplateCopy({ templates }: { templates: Array<{ key: string; name: string }> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sourceKey, setSourceKey] = useState(templates[0]?.key ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function copy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/form-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceKey, name }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string; key?: string };
      if (!response.ok || !result.key) {
        setError(result.message ?? "The template could not be created.");
        return;
      }
      router.push(`/admin/form-templates/${encodeURIComponent(result.key)}`);
    } catch {
      setError("The template could not be created. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel form-stack" onSubmit={copy}>
      <h3>New template</h3>
      <p className="field-help">Start a new template as a copy of an existing one. The original and every form already made from it stay as they are. Event staff can pick the new template when they create a form.</p>
      <div className="form-grid two-column">
        <label>Name
          <input maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label>Copy of
          <select onChange={(event) => setSourceKey(event.target.value)} value={sourceKey}>
            {templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
          </select>
        </label>
      </div>
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <div>
        <SubmitButton className="primary-button" disabled={name.trim().length < 2 || !sourceKey} label="Create template" submitting={saving} submittingLabel="Creating…" />
      </div>
    </form>
  );
}
