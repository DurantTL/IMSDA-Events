"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { checkThemeContrast } from "@/modules/registration-themes/contrast";
import type { RegistrationThemeEditorState, RegistrationThemeVersionView } from "@/modules/registration-themes/repository";
import { themeCssVariables } from "@/modules/registration-themes/resolve";
import {
  PLATFORM_DEFAULT_THEME,
  THEME_COLOR_KEYS,
  THEME_FONT_KEYS,
  THEME_FONT_LABELS,
  type RegistrationThemeTokens,
  type ThemeColorKey,
} from "@/modules/registration-themes/tokens";
import { FormMessage, notSavedMessage, savedMessage } from "@/components/form-message";
import { useConfirm } from "@/components/use-confirm";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import styles from "./registration-theme-panel.module.css";

const HEX = /^#[0-9a-fA-F]{6}$/;

const COLOR_LABELS: Record<ThemeColorKey, string> = {
  primary: "Main color (buttons, links, headings)",
  accent: "Accent (focus and selected options)",
  surface: "Card background",
  text: "Text",
  muted: "Hint text",
  success: "Success",
  warning: "Warning",
  error: "Error",
  pageBackground: "Page background",
};

const WIDTH_OPTIONS = [["narrow", "Narrow"], ["standard", "Standard"], ["wide", "Wide"]] as const;
const DENSITY_OPTIONS = [["comfortable", "Comfortable"], ["compact", "Compact"]] as const;
const RADIUS_OPTIONS = [["square", "Square corners"], ["soft", "Soft corners"], ["round", "Round corners"]] as const;
const SHADOW_OPTIONS = [["none", "No shadow"], ["subtle", "Subtle shadow"], ["raised", "Raised shadow"]] as const;
const BUTTON_OPTIONS = [["rounded", "Rounded"], ["pill", "Pill"], ["square", "Square"]] as const;

const formatDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");

function describeVersion(version: RegistrationThemeVersionView) {
  const who = version.publishedByName ?? "an event administrator";
  return `Version ${version.versionNumber}, published ${formatDay(version.publishedAt)} by ${who}`;
}

function startingTokens(state: RegistrationThemeEditorState): RegistrationThemeTokens {
  return state.draft?.tokens ?? state.published?.tokens ?? PLATFORM_DEFAULT_THEME;
}

type ChoiceKey = "headingFont" | "bodyFont" | "contentWidth" | "density" | "cardRadius" | "shadow" | "buttonShape";

/**
 * The event's registration look (#283): colors, system fonts and layout choices that restyle the registration form, the
 * embedded form, the confirmation, the finish-registration link and the form builder preview. Event administrators only
 * (the page checks CONFIGURE_EVENT; the route checks again). Editing changes only a draft; the public sees a look after Publish.
 */
export function RegistrationThemePanel({ eventId, initialState }: { eventId: string; initialState: RegistrationThemeEditorState }) {
  const [state, setState] = useState(initialState);
  const [tokens, setTokens] = useState<RegistrationThemeTokens>(() => startingTokens(initialState));
  const [saved, setSaved] = useState<RegistrationThemeTokens>(() => startingTokens(initialState));
  const [hexText, setHexText] = useState<Record<ThemeColorKey, string>>(() => ({ ...startingTokens(initialState) } as Record<ThemeColorKey, string>));
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  // Which button is working: it reads its "…ing" label and is aria-busy until the answer comes back.
  const [pending, setPending] = useState<"save" | "publish" | "discard" | "revert" | null>(null);
  const busy = pending !== null;
  // One message slot under the buttons (B10): "Saved. ..." or "Not saved: ...".
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const dirty = JSON.stringify(tokens) !== JSON.stringify(saved);
  useUnsavedChangesGuard(dirty);
  const report = checkThemeContrast(tokens);
  const hexProblems = THEME_COLOR_KEYS.filter((key) => !HEX.test(hexText[key]));
  const hasDraftToPublish = Boolean(state.draft) && !dirty;
  const publishBlocker = hexProblems.length > 0
    ? "Fix the color values marked below first."
    : dirty
      ? "Save the draft first. Publish uses the saved draft."
      : !state.draft
        ? "There is no saved draft to publish."
        : report.passes
          ? ""
          : `${report.failing.length} contrast ${report.failing.length === 1 ? "check fails" : "checks fail"}: ${report.failing.map((check) => check.label).join("; ")}.`;

  function setColor(key: ThemeColorKey, value: string) {
    setHexText((current) => ({ ...current, [key]: value }));
    if (HEX.test(value)) setTokens((current) => ({ ...current, [key]: value.toLowerCase() }));
  }
  function setChoice(key: ChoiceKey, value: string) {
    setTokens((current) => ({ ...current, [key]: value }) as RegistrationThemeTokens);
  }
  function load(next: RegistrationThemeEditorState) {
    const start = startingTokens(next);
    setState(next);
    setTokens(start);
    setSaved(start);
    setHexText({ ...start } as Record<ThemeColorKey, string>);
  }

  async function send(kind: NonNullable<typeof pending>, method: "PUT" | "POST", body: unknown, success: string, fallback: string) {
    setPending(kind);
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/registration-theme`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { theme?: RegistrationThemeEditorState; message?: string; failing?: { label: string; ratio: number; minimum: number }[] };
      if (!response.ok || !result.theme) {
        const lines = (result.failing ?? []).map((check) => `${check.label}: ${check.ratio}:1, needs ${check.minimum}:1`);
        setMessage({ tone: "error", text: notSavedMessage(`${result.message ?? fallback}${lines.length > 0 ? ` ${lines.join("; ")}.` : ""}`) });
        return;
      }
      load(result.theme);
      setMessage({ tone: "success", text: success });
    } catch {
      setMessage({ tone: "error", text: notSavedMessage("We couldn't reach the server. Nothing was changed.") });
    } finally {
      setPending(null);
    }
  }

  const saveDraft = () => send("save", "PUT", { tokens }, savedMessage("The public form still shows the published look."), "The look couldn't be saved.");
  const publish = () => send("publish", "POST", { action: "publish" }, "Saved. Published: the registration form now uses this look.", "The look couldn't be published.");
  async function discard() {
    const confirmed = await askConfirm({
      title: "Discard the draft look",
      confirmLabel: "Discard draft",
      destructive: true,
      body: <p>The saved draft (version {state.draft?.versionNumber}) is deleted. The look the public sees does not change.</p>,
    });
    if (confirmed) await send("discard", "POST", { action: "discard" }, "Saved. Draft discarded; the published look is unchanged.", "The draft couldn't be discarded.");
  }
  async function revert() {
    const confirmed = await askConfirm({
      title: "Use the platform look",
      confirmLabel: "Use platform look",
      destructive: true,
      body: <p>The registration form, embedded form, confirmation and finish-registration link go back to the platform look right away. The published version stays in the history.</p>,
    });
    if (confirmed) await send("revert", "POST", { action: "revert" }, "Saved. This event now uses the platform look.", "The look couldn't be reset.");
  }

  const sampleStyle = themeCssVariables(tokens);
  const published = state.published;

  return (
    <section className="panel" aria-labelledby="registration-theme-heading" id="registration-look">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Public registration</p>
          <h3 id="registration-theme-heading"><Palette aria-hidden="true" size={18} /> Registration look</h3>
          <p>
            Platform default → this event&apos;s published look. Used on the registration form, the embedded form, the confirmation,
            the finish-registration link and the form builder preview.
          </p>
        </div>
      </div>

      <p className={styles.status} data-testid="registration-theme-status">
        {published ? describeVersion(published) : "This event uses the platform look."}
        {state.draft ? ` A draft (version ${state.draft.versionNumber}) is saved and not public yet.` : ""}
      </p>
      {published && (!published.tokens || !checkThemeContrast(published.tokens).passes) ? (
        <p className={styles.status} data-testid="registration-theme-fallback">
          The published look no longer passes every check, so the public pages show the platform look instead. Save and publish a look that passes.
        </p>
      ) : null}


      <div className={styles.layout}>
        <form className={`form-stack ${styles.controls}`} onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
          <fieldset className={styles.group}>
            <legend>Colors</legend>
            {THEME_COLOR_KEYS.map((key) => {
              const invalid = !HEX.test(hexText[key]);
              return (
                <div className={styles.colorRow} key={key}>
                  <label htmlFor={`theme-${key}-hex`}>{COLOR_LABELS[key]}</label>
                  <input aria-label={`${COLOR_LABELS[key]} picker`} className={styles.swatch} type="color" value={tokens[key]} onChange={(event) => setColor(key, event.target.value)} />
                  <input
                    aria-describedby={invalid ? `theme-${key}-error` : undefined}
                    aria-invalid={invalid}
                    autoComplete="off"
                    id={`theme-${key}-hex`}
                    maxLength={7}
                    spellCheck={false}
                    type="text"
                    value={hexText[key]}
                    onChange={(event) => setColor(key, event.target.value)}
                  />
                  {invalid && <small className={styles.fieldError} id={`theme-${key}-error`}>Use a six-digit hex color such as #003b5c.</small>}
                </div>
              );
            })}
          </fieldset>

          <fieldset className={styles.group}>
            <legend>Fonts and layout</legend>
            <label>Heading font
              <select value={tokens.headingFont} onChange={(event) => setChoice("headingFont", event.target.value)}>
                {THEME_FONT_KEYS.map((key) => <option key={key} value={key}>{THEME_FONT_LABELS[key]}</option>)}
              </select>
            </label>
            <label>Body font
              <select value={tokens.bodyFont} onChange={(event) => setChoice("bodyFont", event.target.value)}>
                {THEME_FONT_KEYS.map((key) => <option key={key} value={key}>{THEME_FONT_LABELS[key]}</option>)}
              </select>
            </label>
            <label>Content width
              <select value={tokens.contentWidth} onChange={(event) => setChoice("contentWidth", event.target.value)}>
                {WIDTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Spacing
              <select value={tokens.density} onChange={(event) => setChoice("density", event.target.value)}>
                {DENSITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Card corners
              <select value={tokens.cardRadius} onChange={(event) => setChoice("cardRadius", event.target.value)}>
                {RADIUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Card shadow
              <select value={tokens.shadow} onChange={(event) => setChoice("shadow", event.target.value)}>
                {SHADOW_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Button shape
              <select value={tokens.buttonShape} onChange={(event) => setChoice("buttonShape", event.target.value)}>
                {BUTTON_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <small className={styles.help}>Fonts are the ones every device already has. Nothing is downloaded.</small>
          </fieldset>
        </form>

        <div className={styles.side}>
          <div className={styles.sample} style={sampleStyle} data-testid="registration-theme-sample" role="group" aria-label="Sample of the look">
            <h4 className={styles.sampleHeading}>Sample registration</h4>
            <p>Body text shows how a question and its answer read.</p>
            <p className={styles.sampleMuted}>Hint text sits under a question.</p>
            <div className={styles.sampleOption} aria-hidden="true">Selected option</div>
            <p className={styles.sampleError} role="presentation">Please enter your email address.</p>
            <p className={styles.sampleSuccess} role="presentation">Your registration is confirmed.</p>
            <span className={styles.sampleButton}>Continue</span>
          </div>

          <div>
            <h4 className={styles.subheading}>Contrast checks</h4>
            <p className={styles.help}>{report.checks.length - report.failing.length} of {report.checks.length} checks pass.{report.passes ? "" : " A look can only be published when every check passes."}</p>
            {report.failing.length > 0 && (
              <ul className={styles.checks} data-testid="registration-theme-checks">
                {report.failing.map((check) => (
                  <li className={styles.fail} key={check.id}>
                    <span>{check.label}</span>
                    <span>{check.ratio}:1 (needs {check.minimum}:1) <strong>Fail</strong></span>
                  </li>
                ))}
              </ul>
            )}
            <details className={styles.passing}>
              <summary>Show the checks that pass</summary>
              <ul className={styles.checks}>
                {report.checks.filter((check) => check.passes).map((check) => (
                  <li className={styles.pass} key={check.id}>
                    <span>{check.label}</span>
                    <span>{check.ratio}:1 (needs {check.minimum}:1) <strong>Pass</strong></span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button aria-busy={pending === "save" || undefined} className="secondary-button" disabled={busy || !dirty || hexProblems.length > 0} type="button" onClick={() => void saveDraft()}>{pending === "save" ? "Saving…" : "Save draft"}</button>
        <button aria-busy={pending === "publish" || undefined} className="primary-button" aria-describedby={publishBlocker ? "registration-theme-publish-reason" : undefined} disabled={busy || !hasDraftToPublish || !report.passes} type="button" onClick={() => void publish()}>{pending === "publish" ? "Publishing…" : "Publish"}</button>
        <button aria-busy={pending === "discard" || undefined} className="secondary-button" disabled={busy || !state.draft} type="button" onClick={() => void discard()}>{pending === "discard" ? "Discarding…" : "Discard draft"}</button>
        <button aria-busy={pending === "revert" || undefined} className="secondary-button" disabled={busy || !published} type="button" onClick={() => void revert()}>{pending === "revert" ? "Switching…" : "Use platform look"}</button>
      </div>
      <FormMessage message={message?.text ?? ""} tone={message?.tone ?? "success"} />
      {publishBlocker && <p className={styles.help} id="registration-theme-publish-reason">Publish is off: {publishBlocker}</p>}
      <p className={styles.help}>Saving a draft never changes what the public sees. Only Publish does.</p>

      <h4 className={styles.subheading}>Version history</h4>
      {published || state.history.length > 0 ? (
        <ul className={styles.history}>
          {published && <li><strong>Current:</strong> {describeVersion(published)}</li>}
          {state.history.map((version) => <li key={version.id}>{describeVersion(version)}, replaced {formatDay(version.archivedAt)}</li>)}
        </ul>
      ) : <p className={styles.help}>No published looks yet.</p>}
      {confirmDialog}
    </section>
  );
}
