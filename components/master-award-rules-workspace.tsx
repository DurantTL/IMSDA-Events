"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Pencil, Plus, Trash2, Trophy, X } from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { useAccessibleDialog } from "@/components/use-accessible-dialog";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { EmptyState } from "@/components/empty-state";
import catalogStyles from "@/components/catalog-workspace.module.css";
import styles from "@/components/club-supplies.module.css";
import ruleStyles from "@/components/master-award-rules.module.css";
import { masterAwardStatusLabels, masterAwardStatusTone } from "@/modules/earned-awards/domain";
import type { MasterAwardImportPlan } from "@/modules/earned-awards/master-award-import";
import type { MasterAwardRuleRecord } from "@/modules/earned-awards/rules-repository";

export type RuleChoices = {
  honors: Array<{ id: string; name: string }>;
  items: Array<{ id: string; name: string }>;
};

type ImportResponse = Partial<MasterAwardImportPlan> & {
  fingerprint?: string;
  plan?: MasterAwardImportPlan;
  rules?: MasterAwardRuleRecord[];
  error?: string;
  message?: string;
  issues?: Array<{ message?: string }>;
};

type Preview = { json: string; plan: MasterAwardImportPlan; fingerprint: string };

type DraftGroup = { minimum: number; honors: Array<{ id: string; name: string }>; unmatchedHonorNames: string[] };

function draftGroups(rule: MasterAwardRuleRecord): DraftGroup[] {
  return rule.groups.map((group) => ({ minimum: group.minimum, honors: group.honors, unmatchedHonorNames: group.unmatchedHonorNames }));
}

/**
 * One rule's review form (#532): its honor groups (minimum and honor list),
 * catalog item and note, then save, activate or deactivate. A rule flagged for
 * a manual check can only be activated after the administrator ticks that they
 * checked it against the official requirements.
 */
function RuleEditor({
  rule,
  choices,
  onSaved,
  onDirtyChange,
  onCancel,
}: {
  rule: MasterAwardRuleRecord;
  choices: RuleChoices;
  onSaved: (rules: MasterAwardRuleRecord[], message: string) => void;
  /** Whether the form holds work that is not saved, so the dialog can ask before it closes. */
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const [groups, setGroups] = useState<DraftGroup[]>(() => draftGroups(rule));
  const [itemId, setItemId] = useState(rule.itemId ?? "");
  const [note, setNote] = useState(rule.reviewNote);
  const [checked, setChecked] = useState(!rule.needsManualCheck);
  const [adding, setAdding] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listId = `master-award-honors-${rule.id}`;
  const snapshot = (value: { groups: DraftGroup[]; itemId: string; note: string; checked: boolean }) => JSON.stringify([
    value.groups.map((group) => [group.minimum, group.honors.map((honor) => honor.id)]), value.itemId, value.note, value.checked,
  ]);
  const [saved] = useState(() => snapshot({ groups, itemId, note, checked }));
  const dirty = snapshot({ groups, itemId, note, checked }) !== saved;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  function addHonor(index: number) {
    const text = (adding[index] ?? "").trim().toLowerCase();
    const honor = choices.honors.find((entry) => entry.name.toLowerCase() === text);
    if (!honor) {
      setError("Choose an honor from the list.");
      return;
    }
    setError("");
    setGroups((current) => current.map((group, position) => (position === index && !group.honors.some((entry) => entry.id === honor.id)
      ? { ...group, honors: [...group.honors, honor].sort((a, b) => a.name.localeCompare(b.name)) }
      : group)));
    setAdding((current) => ({ ...current, [index]: "" }));
  }

  async function save(status?: "ACTIVE" | "INACTIVE") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/master-award-rules/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: groups.map((group) => ({ minimum: group.minimum, honorIds: group.honors.map((honor) => honor.id) })),
          itemId: itemId || null,
          reviewNote: note,
          ...(rule.needsManualCheck && checked ? { needsManualCheck: false } : {}),
          ...(status ? { status } : {}),
        }),
      });
      const result = await response.json().catch(() => ({})) as ImportResponse;
      if (!response.ok || !result.rules) throw new Error(result.message ?? result.issues?.[0]?.message ?? "The rule could not be saved.");
      onSaved(result.rules, status === "ACTIVE" ? `${rule.name} is active.` : status === "INACTIVE" ? `${rule.name} is inactive.` : `${rule.name} saved.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The rule could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={ruleStyles.editor}>
      {rule.problems.length > 0 && rule.status !== "ACTIVE" && (
        <ul className={ruleStyles.problems}>
          {rule.problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      {rule.groups.some((group) => group.unmatchedHonorNames.length > 0) && (
        <p className={ruleStyles.flag} role="status">
          <AlertTriangle aria-hidden="true" size={14} /> Some honors in the club&apos;s sheet matched nothing in the honor list. Add the right honor to the group, or leave them out.
        </p>
      )}
      {groups.map((group, index) => (
        <fieldset className={ruleStyles.group} key={index}>
          <legend>Group {index + 1}</legend>
          <label className={ruleStyles.field}>
            <span>Minimum honors needed</span>
            <input
              inputMode="numeric"
              min={1}
              onChange={(event) => setGroups((current) => current.map((entry, position) => (position === index ? { ...entry, minimum: Number(event.target.value) || 0 } : entry)))}
              type="number"
              value={group.minimum}
            />
          </label>
          <ul className={ruleStyles.chips}>
            {group.honors.map((honor) => (
              <li key={honor.id}>
                <span translate="no">{honor.name}</span>
                <button
                  aria-label={`Remove ${honor.name} from group ${index + 1}`}
                  onClick={() => setGroups((current) => current.map((entry, position) => (position === index ? { ...entry, honors: entry.honors.filter((other) => other.id !== honor.id) } : entry)))}
                  type="button"
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </li>
            ))}
          </ul>
          {group.unmatchedHonorNames.length > 0 && (
            <p className={ruleStyles.unmatched}>No match in the honor list: {group.unmatchedHonorNames.join(", ")}</p>
          )}
          <div className={ruleStyles.addRow}>
            <label className={ruleStyles.field}>
              <span>Add an honor</span>
              <input
                list={listId}
                onChange={(event) => setAdding((current) => ({ ...current, [index]: event.target.value }))}
                placeholder="Start typing an honor name"
                value={adding[index] ?? ""}
              />
            </label>
            <button className="secondary-button" onClick={() => addHonor(index)} type="button"><Plus aria-hidden="true" size={14} /> Add</button>
            {groups.length > 1 && (
              <button className="secondary-button" onClick={() => setGroups((current) => current.filter((_, position) => position !== index))} type="button">
                <Trash2 aria-hidden="true" size={14} /> Remove group
              </button>
            )}
          </div>
        </fieldset>
      ))}
      <datalist id={listId}>
        {choices.honors.map((honor) => <option key={honor.id} value={honor.name} />)}
      </datalist>
      <div className={styles.actions}>
        <button className="secondary-button" onClick={() => setGroups((current) => [...current, { minimum: 1, honors: [], unmatchedHonorNames: [] }])} type="button">
          <Plus aria-hidden="true" size={14} /> Add a group
        </button>
      </div>
      <label className={ruleStyles.field}>
        <span>Catalog item (the award&apos;s patch)</span>
        <select onChange={(event) => setItemId(event.target.value)} value={itemId}>
          <option value="">Not linked</option>
          {choices.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className={ruleStyles.field}>
        <span>Review note</span>
        <textarea maxLength={1000} onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
      </label>
      {rule.needsManualCheck && (
        <label className={ruleStyles.check}>
          <input checked={checked} onChange={(event) => setChecked(event.target.checked)} type="checkbox" />
          <span>I checked this rule against the official requirements.</span>
        </label>
      )}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">Cancel</button>
        <button className="secondary-button" disabled={busy} onClick={() => save()} type="button">Save changes</button>
        {rule.status !== "ACTIVE" ? (
          <button className="primary-button" disabled={busy || !checked} onClick={() => save("ACTIVE")} type="button">
            <CheckCircle2 aria-hidden="true" size={16} /> Save and activate
          </button>
        ) : (
          <button className="secondary-button" disabled={busy} onClick={() => save("INACTIVE")} type="button">Deactivate</button>
        )}
      </div>
    </div>
  );
}

/**
 * Staff page for Master Award rules (#532), system administrators only:
 * import the reviewed rules file (dry run first, nothing saved until the
 * preview is confirmed), then review, edit and activate each rule one by one.
 * Imported rules are drafts; only active rules are used for club progress.
 */
export function MasterAwardRulesWorkspace({ initialRules, choices }: { initialRules: MasterAwardRuleRecord[]; choices: RuleChoices }) {
  const [rules, setRules] = useState(initialRules);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The focused editor for one rule: closed until the rule's Review button opens it (#1590).
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [ruleDirty, setRuleDirty] = useState(false);
  const openRule = rules.find((rule) => rule.id === openRuleId) ?? null;
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  useUnsavedChangesGuard(Boolean(openRule) && ruleDirty);
  const editorRef = useAccessibleDialog<HTMLElement>(Boolean(openRule), closeEditor);

  async function closeEditor() {
    if (ruleDirty && !(await askConfirm({
      title: `Discard changes to ${openRule?.name ?? "this rule"}`,
      body: <p>This rule has changes that haven&apos;t been saved. Discarding closes the editor and loses them.</p>,
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      destructive: true,
    }))) return;
    setRuleDirty(false);
    setOpenRuleId(null);
  }

  async function send(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/master-award-rules/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, result: await response.json().catch(() => ({})) as ImportResponse };
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const json = await file.text();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { response, result } = await send({ json, confirm: false });
      if (!response.ok || !result.steps || !result.summary || !result.fingerprint) {
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "That file couldn't be read.");
      }
      setPreview({ json, fingerprint: result.fingerprint, plan: { steps: result.steps, summary: result.summary, unmatched: result.unmatched ?? [] } });
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "That file couldn't be read.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const { response, result } = await send({ json: preview.json, confirm: true, fingerprint: preview.fingerprint });
      if (!response.ok || !result.rules || !result.plan) throw new Error(result.message ?? "The rules could not be saved.");
      setRules(result.rules);
      setNotice(`Imported ${result.plan.summary.added} rule${result.plan.summary.added === 1 ? "" : "s"} as drafts. Review and activate each one below.`);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The rules could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const counts: Array<[string, number]> = preview ? [
    ["Rules to add", preview.plan.summary.added],
    ["Already on file", preview.plan.summary.existing],
    ["Need a manual check", preview.plan.summary.needsManualCheck],
    ["Honors matched", preview.plan.summary.honorsMatched],
    ["Honors unmatched", preview.plan.summary.honorsUnmatched],
  ] : [];

  const uploadAction = (
    <label className={`primary-button ${styles.upload}`}>
      <FileUp aria-hidden="true" size={16} /> {busy && !preview ? "Reading…" : "Upload rules file"}
      <input accept=".json,application/json" className="sr-only" disabled={busy} onChange={chooseFile} type="file" />
    </label>
  );

  return (
    <>
      <section className="page-stack">
        <p className={catalogStyles.definition} data-catalog-definition="">
          A rule is the definition; progress is worked out from the active rules each time a club views it, so changing a rule changes the progress
          clubs see from then on. It does not change honors members have already earned. Imported rules are drafts until you review and activate them.
        </p>
        <ul aria-label="Related pages" className={catalogStyles.links}>
          <li><span className={catalogStyles.linksLabel}>Honors in a rule come from the</span> <Link href="/admin/honors">Honor catalog</Link></li>
        </ul>
        {notice && <div className="inline-notice success" role="status">{notice}</div>}
        {error && <div className="inline-notice error" role="alert">{error}</div>}
        <div className={catalogStyles.toolbar}>{uploadAction}</div>
        <details className={catalogStyles.importHelp}>
          <summary>How the rules import works</summary>
          <p className="field-help">
            Upload <code>docs/reference/master-award-rules.json</code>. Rules already on file are never changed. Honors are
            matched to the honor list by name; the preview lists any that don&apos;t match. Nothing is saved until you confirm.
          </p>
        </details>

        {preview && (
          <section aria-labelledby="master-award-preview" className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Dry run</p>
                <h2 id="master-award-preview">What this import would do</h2>
              </div>
            </div>
            <ul className={styles.counts}>
              {counts.map(([label, value]) => <li key={label}><strong>{value}</strong><span>{label}</span></li>)}
            </ul>
            <ul className={ruleStyles.steps}>
              {preview.plan.steps.map((step) => (
                <li key={step.normalizedName}>
                  <strong translate="no">{step.name}</strong>
                  <small>{step.action === "ADD" ? "Will be added as a draft" : "Already on file: left as it is"}{step.itemId ? "" : " · no catalog item found"}</small>
                  {step.action === "ADD" && step.reasons.map((reason) => (
                    <small className={ruleStyles.reason} key={reason}><AlertTriangle aria-hidden="true" size={12} /> {reason}</small>
                  ))}
                </li>
              ))}
            </ul>
            {preview.plan.unmatched.length > 0 && (
              <>
                <h3 className={ruleStyles.subhead}>Honors that matched nothing ({preview.plan.unmatched.length})</h3>
                <ul className={ruleStyles.unmatchedList}>
                  {preview.plan.unmatched.map((entry) => <li key={`${entry.award}:${entry.honor}`}><span translate="no">{entry.honor}</span> <small>in {entry.award}</small></li>)}
                </ul>
              </>
            )}
            <div className="form-actions">
              <button className="secondary-button" disabled={busy} onClick={() => setPreview(null)} type="button">Cancel</button>
              <button className="secondary-button" disabled={busy || preview.plan.summary.added === 0} onClick={confirm} type="button">
                <CheckCircle2 aria-hidden="true" size={16} /> {busy ? "Saving…" : `Save ${preview.plan.summary.added} draft rule${preview.plan.summary.added === 1 ? "" : "s"}`}
              </button>
            </div>
          </section>
        )}

        <section className="panel dense-rows" aria-labelledby="master-award-rule-list">
          <div className="section-heading">
            <div>
              <h2 id="master-award-rule-list"><Trophy aria-hidden="true" size={16} /> Rules</h2>
            </div>
            <span className="count-badge">{rules.length} {rules.length === 1 ? "rule" : "rules"}</span>
          </div>
          {rules.length === 0 ? (
            <EmptyState hint="Use Upload rules file to import the reviewed rules as drafts." icon={<Trophy aria-hidden="true" size={27} />} title="No rules yet">There are no Master Award rules.</EmptyState>
          ) : (
            <ul className={catalogStyles.rowList}>
              {rules.map((rule) => (
                <li className={catalogStyles.rowCard} key={rule.id}>
                  <span className={catalogStyles.rowText}>
                    <strong translate="no">{rule.name}</strong>
                    <small className={catalogStyles.detail}>
                      {rule.groups.map((group) => `${group.minimum} of ${group.honors.length + group.unmatchedHonorNames.length}`).join(" + ")}
                      {rule.itemName ? ` · ${rule.itemName}` : " · no catalog item linked"}
                    </small>
                    {rule.reviewNote && <small className={catalogStyles.detail}>{rule.reviewNote}</small>}
                  </span>
                  <span className={`row-actions ${catalogStyles.rowMeta}`}>
                    <span className={`status-chip ${masterAwardStatusTone[rule.status]}`}>{masterAwardStatusLabels[rule.status]}</span>
                    {rule.status !== "ACTIVE" && <span className="status-chip gold">Not used for club progress</span>}
                    {rule.needsManualCheck && <span className="status-chip coral">Manual check</span>}
                    <button
                      aria-label={`Review ${rule.name}`}
                      className="secondary-button"
                      onClick={() => { setOpenRuleId(rule.id); setRuleDirty(false); setNotice(""); setError(""); }}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={14} /> Review
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      {openRule && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void closeEditor(); }} role="presentation">
          <section aria-labelledby="master-award-editor-title" aria-modal="true" className="modal-card modal-card-wide" ref={editorRef} role="dialog" tabIndex={-1}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Review rule</p>
                <h2 id="master-award-editor-title" translate="no">{openRule.name}</h2>
              </div>
              <button aria-label="Close rule editor" className="icon-button modal-close-button" onClick={() => void closeEditor()} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <RuleEditor
              choices={choices}
              key={openRule.id}
              onCancel={() => void closeEditor()}
              onDirtyChange={setRuleDirty}
              onSaved={(next, message) => { setRules(next); setNotice(message); setError(""); setRuleDirty(false); setOpenRuleId(null); }}
              rule={openRule}
            />
          </section>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
