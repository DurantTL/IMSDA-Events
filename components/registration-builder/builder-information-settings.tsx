// The Form settings tab in information mode (#1149): who may fill the form, when it opens and closes, whether it is
// open, and its public link. These are saved on their own (not part of the draft), so they work on a published form
// without making a new version. Payment, roster and withdraw are not here: an information form has none of them.
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Lock, LockOpen } from "lucide-react";
import { useLoadedBuilder } from "./builder-context";
import { informationPublicPath, informationResponsesHref, isoToLocalInput, localInputToIso, type InformationFillAccess } from "./information-mode";
import { useHydrated } from "./use-editor-layout";

const accessLabels: Record<InformationFillAccess, { title: string; hint: string }> = {
  ANYONE_WITH_LINK: { title: "Anyone with the link", hint: "No sign-in. Anyone who has the link can answer." },
  SIGNED_IN: { title: "Signed-in people only", hint: "People sign in with an account before they answer." },
};

function statusText(status: "DRAFT" | "OPEN" | "CLOSED", hasPublished: boolean) {
  if (status === "OPEN") return "Open: accepting answers";
  if (status === "CLOSED") return "Closed: not accepting answers";
  return hasPublished ? "Not open yet: published, but not opened" : "Not open yet: publish it first";
}

function SettingsFields() {
  const { selectedForm, publishedVersion, information, busy, saveInformationSettings, setInformationStatus } = useLoadedBuilder();
  const current = selectedForm.information;
  const [fillAccess, setFillAccess] = useState<InformationFillAccess>(current?.fillAccess ?? "ANYONE_WITH_LINK");
  const [opens, setOpens] = useState(isoToLocalInput(current?.opensAt ?? null));
  const [closes, setCloses] = useState(isoToLocalInput(current?.closesAt ?? null));
  const [problem, setProblem] = useState("");
  if (!information || !current) return null;
  const publicPath = informationPublicPath(information, selectedForm.slug);
  const changed = fillAccess !== current.fillAccess || opens !== isoToLocalInput(current.opensAt) || closes !== isoToLocalInput(current.closesAt);

  async function save() {
    const opensAt = localInputToIso(opens);
    const closesAt = localInputToIso(closes);
    if (opensAt === undefined || closesAt === undefined) { setProblem("Enter the opening and closing times as dates and times."); return; }
    if (opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()) { setProblem("The closing time must be after the opening time."); return; }
    setProblem("");
    await saveInformationSettings({ fillAccess, opensAt, closesAt });
  }

  return (
    <>
      <section className="panel fb-info-settings" aria-labelledby="fb-info-access-title">
        <div className="section-heading"><div><p className="eyebrow">Who can answer</p><h2 id="fb-info-access-title">Fill access and dates</h2></div></div>
        <fieldset className="fb-info-access" disabled={busy !== null}>
          <legend className="sr-only">Who can fill this form</legend>
          {(Object.keys(accessLabels) as InformationFillAccess[]).map((value) => (
            <label className="fb-option" key={value}>
              <input type="radio" name="fb-info-fill-access" value={value} checked={fillAccess === value} onChange={() => setFillAccess(value)} />
              <span><strong>{accessLabels[value].title}</strong><small>{accessLabels[value].hint}</small></span>
            </label>
          ))}
        </fieldset>
        <div className="roster-settings-grid fb-info-dates">
          <label>Opens<input type="datetime-local" name="fb-info-opens-at" disabled={busy !== null} value={opens} onChange={(event) => setOpens(event.target.value)} /></label>
          <label>Closes<input type="datetime-local" name="fb-info-closes-at" disabled={busy !== null} value={closes} onChange={(event) => setCloses(event.target.value)} /></label>
        </div>
        <p className="fb-hint">Times are in this browser&apos;s time zone. Leave a time empty for no limit. The form still has to be open (below) to accept answers.</p>
        {problem && <p className="form-error" role="alert">{problem}</p>}
        <button className="fb-btn outline" type="button" disabled={!changed || busy !== null} onClick={save}>{busy === "settings" ? "Saving…" : "Save settings"}</button>
      </section>
      <section className="panel fb-info-status" aria-labelledby="fb-info-status-title">
        <div className="section-heading"><div><p className="eyebrow">Open or close</p><h2 id="fb-info-status-title">Accepting answers</h2></div></div>
        <p className="fb-info-status-line" role="status"><strong>{statusText(current.status, Boolean(publishedVersion))}</strong></p>
        {current.status === "OPEN"
          ? <button className="fb-btn" type="button" disabled={busy !== null} onClick={() => setInformationStatus("CLOSED")}><Lock size={15} aria-hidden="true" /> {busy === "status" ? "Closing…" : "Close the form"}</button>
          : <button className="fb-btn outline" type="button" disabled={busy !== null || !publishedVersion} title={publishedVersion ? undefined : "Publish this form first"} onClick={() => setInformationStatus("OPEN")}><LockOpen size={15} aria-hidden="true" /> {busy === "status" ? "Opening…" : current.status === "CLOSED" ? "Open the form again" : "Open for answers"}</button>}
        <p className="fb-hint">Closing keeps every answer already received. Publishing a new version does not open or close the form.</p>
      </section>
      <section className="panel fb-info-link" aria-labelledby="fb-info-link-title">
        <div className="section-heading"><div><p className="eyebrow">Share</p><h2 id="fb-info-link-title">Public link</h2></div></div>
        <p><code className="fb-info-path">{publicPath}</code></p>
        <p className="fb-hint">{publishedVersion ? "People can use this link while the form is open." : "The link works once the form is published and open."}</p>
        <div className="builder-actions">
          {publishedVersion
            ? <a className="secondary-button" href={publicPath} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" /> Open public form</a>
            : <button className="secondary-button" type="button" disabled title="Publish this form to create its public link"><ExternalLink size={15} aria-hidden="true" /> Open public form</button>}
          <Link className="secondary-button" href={informationResponsesHref(information, selectedForm.id)}>View responses</Link>
        </div>
      </section>
    </>
  );
}

export function BuilderInformationSettings() {
  const { selectedForm } = useLoadedBuilder();
  const hydrated = useHydrated();
  // The times show in the browser's time zone, which the server cannot know: render them after hydration only.
  if (!hydrated) return null;
  // Keyed by the form id only, so saving the draft never discards half-typed settings.
  return <SettingsFields key={selectedForm.id} />;
}
