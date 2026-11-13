"use client";

import { useState } from "react";
import { CheckCircle2, Palette } from "lucide-react";
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
import { savedMessage } from "@/components/form-message";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failing, setFailing] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

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

  async function send(method: "PUT" | "POST", body: unknown, success: string, fallback: string) {
    setBusy(true);
    setError("");
    setFailing([]);
    setNotice("");
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/registration-theme`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { theme?: RegistrationThemeEditorState; message?: string; failing?: { label: string; ratio: number; minimum: number }[] };
      if (!response.ok || !result.theme) {
        setError(result.message ?? fallback);
        setFailing((result.failing ?? []).map((check) => `${check.label}: ${check.ratio}:1, needs ${check.minimum}:1`));
        return;
      }
      load(result.theme);
      setNotice(success);
    } catch {
      setError("We couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = () => send("PUT", { tokens }, savedMessage("The public form still shows the published look."), "Not saved: the look couldn't be saved.");
  const publish = () => send("POST", { action: "publish" }, "Published. The registration form now uses this look.", "Not published: the look couldn't be published.");
  const discard = () => send("POST", { action: "discard" }, "Draft discarded. The published look is unchanged.", "Not discarded: the draft couldn't be discarded.");
  const revert = () => send("POST", { action: "revert" }, "This event now uses the platform look.", "Not changed: the look couldn't be reset.");

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

      {error && <div className="inline-notice error" role="alert">{error}{failing.length > 0 && <ul>{failing.map((line) => <li key={line}>{line}</li>)}</ul>}</div>}
      {notice && <div className="inline-notice" role="status"><CheckCircle2 aria-hidden="true" size={14} /> {notice}</div>}

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
            <p className={styles.help}>{report.passes ? "Every check passes." : `${report.failing.length} of ${report.checks.length} checks fail. A look can only be published when every check passes.`}</p>
            <ul className={styles.checks} data-testid="registration-theme-checks">
              {report.checks.map((check) => (
                <li className={check.passes ? styles.pass : styles.fail} key={check.id}>
                  <span>{check.label}</span>
                  <span>{check.ratio}:1 (needs {check.minimum}:1) <strong>{check.passes ? "Pass" : "Fail"}</strong></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button className="secondary-button" disabled={busy || !dirty || hexProblems.length > 0} type="button" onClick={() => void saveDraft()}>Save draft</button>
        <button className="primary-button" aria-describedby={publishBlocker ? "registration-theme-publish-reason" : undefined} disabled={busy || !hasDraftToPublish || !report.passes} type="button" onClick={() => void publish()}>Publish</button>
        <button className="secondary-button" disabled={busy || !state.draft} type="button" onClick={() => void discard()}>Discard draft</button>
        <button className="secondary-button" disabled={busy || !published} type="button" onClick={() => void revert()}>Use platform look</button>
      </div>
      {publishBlocker && <p className={styles.help} id="registration-theme-publish-reason">Publish is off: {publishBlocker}</p>}
      <p className={styles.help}>Saving a draft never changes what the public sees. Only Publish does.</p>

      <h4 className={styles.subheading}>Version history</h4>
      {published || state.history.length > 0 ? (
        <ul className={styles.history}>
          {published && <li><strong>Current:</strong> {describeVersion(published)}</li>}
          {state.history.map((version) => <li key={version.id}>{describeVersion(version)}, replaced {formatDay(version.archivedAt)}</li>)}
        </ul>
      ) : <p className={styles.help}>No published looks yet.</p>}
    </section>
  );
}
