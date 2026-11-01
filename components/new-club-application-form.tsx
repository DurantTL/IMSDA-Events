"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { SecurityCheck, type SecurityCheckConfig, type SecurityCheckHandle } from "@/components/security-check/security-check";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { validateEmail } from "@/lib/field-validation";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { ClubFormSectionTitle } from "@/components/club-form-section-title";
import { sponsorOptionLabel } from "@/modules/organizations/domain";
import {
  CHURCH_AGREEMENT,
  MAX_APPLICATION_ATTACHMENT_BYTES,
  MAX_OTHER_BOARD_MEMBERS,
  PHILOSOPHY_STATEMENT,
} from "@/modules/club-applications/domain";

const OTHER = "__other__";
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

const FIELD_LABELS = {
  clubName: "Club name",
  church: "Sponsoring church or company",
  churchOther: "Name of the church or company",
  pastorName: "Church pastor",
  directorName: "Director name",
  directorEmail: "Director email",
  directorAddress: "Mailing address",
  agreed: "Philosophy of Pathfindering",
  pastorSignature: "Pastor signature",
  headElderSignature: "Head elder signature",
  clerkSignature: "Church clerk signature",
  directorSignature: "Club director signature",
} as const;
type FieldKey = keyof typeof FIELD_LABELS;
const FIELD_ORDER = Object.keys(FIELD_LABELS) as FieldKey[];

type Props = {
  churches: Array<{ id: string; name: string; type: string }>;
  /** Today in the conference time zone, as a readable date. The server stamps the real one when it saves. */
  todayLabel: string;
  /** The private link's token, when the page was opened from one. */
  inviteToken?: string;
  prefill?: { email: string; name: string };
  /** From `securityCheckConfigForPage()`; null while Turnstile is off (#1399). */
  securityCheck?: SecurityCheckConfig;
};

/**
 * The "Register a new club" application (#817), mirroring the conference's
 * paper Pathfinder Program Club Application. Used by the public page and by a
 * private invite link (which prefills the director's email). It only sends an
 * application for staff to review: nothing is created until a system
 * administrator approves it. The server checks everything again.
 */
export function NewClubApplicationForm({ churches, todayLabel, inviteToken, prefill, securityCheck = null }: Props) {
  const check = useRef<SecurityCheckHandle>(null);
  const [openedAt] = useState(() => Date.now());
  const [values, setValues] = useState({
    clubName: "",
    church: "",
    churchOther: "",
    pastorName: "",
    directorName: prefill?.name ?? "",
    directorAddress: "",
    directorEmail: prefill?.email ?? "",
    directorHomePhone: "",
    directorWorkPhone: "",
    pastorSignature: "",
    headElderSignature: "",
    clerkSignature: "",
    directorSignature: "",
    note: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [boardMembers, setBoardMembers] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary } = useFormErrorSummary();
  // The site was restarting (#1263): the form keeps everything, including the chosen file.
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);

  const errorProps = (key: FieldKey, helpId?: string) => fieldErrorProps(`club_${key}_error`, errors[key], helpId);

  /** What the browser's required and email checks enforced before noValidate; the server checks everything again. */
  function findProblems() {
    const found: Partial<Record<FieldKey, string>> = {};
    const required = "This is required.";
    for (const key of ["clubName"] as const) if (!values[key].trim()) found[key] = required;
    if (!values.church) found.church = "Choose a church or company.";
    if (values.church === OTHER && !values.churchOther.trim()) found.churchOther = required;
    for (const key of ["pastorName", "directorName"] as const) if (!values[key].trim()) found[key] = required;
    if (!values.directorEmail.trim()) found.directorEmail = required;
    else if (!validateEmail(values.directorEmail).ok) found.directorEmail = "Enter the director's email address.";
    if (!values.directorAddress.trim()) found.directorAddress = required;
    if (!agreed) found.agreed = "Tick the box to agree.";
    for (const key of ["pastorSignature", "headElderSignature", "clerkSignature", "directorSignature"] as const) if (!values[key].trim()) found[key] = required;
    return found;
  }

  function set<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (saving) return;
    setError("");
    setSiteUpdating(false);
    const found = findProblems();
    setErrors(found);
    const keys = FIELD_ORDER.filter((key) => found[key]);
    if (keys.length > 0) {
      showSummary(keys.map((key) => ({ targetId: `club_${key}`, message: summaryMessage(FIELD_LABELS[key], found[key] as string) })));
      return;
    }
    clearSummary();
    if (file && file.size > MAX_APPLICATION_ATTACHMENT_BYTES) {
      setError(`The attachment must be ${Math.floor(MAX_APPLICATION_ATTACHMENT_BYTES / (1024 * 1024))} MB or smaller.`);
      return;
    }
    if (!check.current?.require("Send application")) return;
    setSaving(true);
    try {
      const isOther = values.church === OTHER;
      const data = {
        clubName: values.clubName,
        sponsoringChurchId: isOther ? null : values.church || null,
        sponsoringChurchOther: isOther ? values.churchOther : null,
        pastorName: values.pastorName,
        directorName: values.directorName,
        directorAddress: values.directorAddress,
        directorEmail: values.directorEmail,
        directorHomePhone: values.directorHomePhone,
        directorWorkPhone: values.directorWorkPhone,
        philosophyAgreed: agreed,
        pastorSignature: values.pastorSignature,
        headElderSignature: values.headElderSignature,
        clerkSignature: values.clerkSignature,
        directorSignature: values.directorSignature,
        otherBoardMembers: boardMembers.map((name) => name.trim()).filter(Boolean),
        note: values.note,
        formOpenedAt: openedAt,
        website,
      };
      const body = new FormData();
      body.set("data", JSON.stringify(data));
      if (inviteToken) body.set("inviteToken", inviteToken);
      if (file) body.set("attachment", file);
      const response = await submitJson("/api/public/club-applications", body, { init: { headers: check.current?.headers() } });
      if (response.unavailable) {
        check.current?.settle();
        setSiteUpdating(unavailableMessage(response));
        return;
      }
      const result = response.body as { message?: string };
      check.current?.settle(result);
      if (!response.ok && check.current?.isRejection(result)) return;
      if (!response.ok) throw new Error(result.message ?? "The application could not be sent. Please try again.");
      setDone(true);
    } catch (caught) {
      check.current?.settle();
      setError(caught instanceof Error ? caught.message : "The application could not be sent. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="public-manage-card club-form-done" role="status">
        <h2>Application received</h2>
        <p>
          Thank you. The conference youth department will review your application. Nothing is set up until it is approved, and you&apos;ll be
          emailed at <strong translate="no">{values.directorEmail.trim().toLowerCase()}</strong> either way.
        </p>
      </section>
    );
  }

  return (
    <form className="club-form-fill" noValidate onSubmit={(event) => void submit(event)}>
      {summaryItems.length > 0 && <FormErrorSummary action="submitting" items={summaryItems} ref={summaryRef} />}
      <fieldset className="public-manage-card form-stack" disabled={saving}>
        <ClubFormSectionTitle>The club</ClubFormSectionTitle>
        <div className="form-grid two-column nca-grid">
          <label>
            Club name
            <input autoComplete="off" maxLength={120} onChange={(event) => set("clubName", event.target.value)} id="club_clubName" {...errorProps("clubName")} value={values.clubName} />
            <FieldError id="club_clubName_error">{errors.clubName}</FieldError>
          </label>
          <label>
            Sponsoring church or company
            <select id="club_church" {...errorProps("church")} onChange={(event) => set("church", event.target.value)} value={values.church}>
              <option value="">Choose a church or company…</option>
              {churches.map((church) => <option key={church.id} value={church.id}>{sponsorOptionLabel(church)}</option>)}
              <option value={OTHER}>Other (not in this list)</option>
            </select>
            <FieldError id="club_church_error">{errors.church}</FieldError>
          </label>
          {values.church === OTHER && (
            <label>
              Name of the church or company
              <input autoComplete="off" maxLength={160} onChange={(event) => set("churchOther", event.target.value)} id="club_churchOther" {...errorProps("churchOther")} value={values.churchOther} />
              <FieldError id="club_churchOther_error">{errors.churchOther}</FieldError>
              <small className="field-help">The conference will match it to its church directory.</small>
            </label>
          )}
          <label>
            Church pastor
            <input autoComplete="off" maxLength={120} onChange={(event) => set("pastorName", event.target.value)} id="club_pastorName" {...errorProps("pastorName")} value={values.pastorName} />
            <FieldError id="club_pastorName_error">{errors.pastorName}</FieldError>
          </label>
        </div>
      </fieldset>

      <fieldset className="public-manage-card form-stack" disabled={saving}>
        <ClubFormSectionTitle>Elected Pathfinder leader (the club director)</ClubFormSectionTitle>
        <div className="form-grid two-column nca-grid">
          <label>
            Name
            <input autoComplete="name" maxLength={120} onChange={(event) => set("directorName", event.target.value)} id="club_directorName" {...errorProps("directorName")} value={values.directorName} />
            <FieldError id="club_directorName_error">{errors.directorName}</FieldError>
          </label>
          <label>
            Email
            <input autoComplete="email" maxLength={160} onChange={(event) => set("directorEmail", event.target.value)} type="email" id="club_directorEmail" {...errorProps("directorEmail", "club_directorEmail_help")} value={values.directorEmail} />
            <FieldError id="club_directorEmail_error">{errors.directorEmail}</FieldError>
            <small className="field-help" id="club_directorEmail_help">The club director invite is sent here when the application is approved.</small>
          </label>
          <label className="club-form-field-wide">
            Mailing address
            <textarea autoComplete="street-address" maxLength={300} onChange={(event) => set("directorAddress", event.target.value)} rows={3} id="club_directorAddress" {...errorProps("directorAddress")} value={values.directorAddress} />
            <FieldError id="club_directorAddress_error">{errors.directorAddress}</FieldError>
          </label>
          <label>
            Home phone
            <input autoComplete="tel" maxLength={40} onChange={(event) => set("directorHomePhone", event.target.value)} type="tel" value={values.directorHomePhone} />
          </label>
          <label>
            Work phone
            <input maxLength={40} onChange={(event) => set("directorWorkPhone", event.target.value)} type="tel" value={values.directorWorkPhone} />
            <small className="field-help">Give at least one phone number.</small>
          </label>
        </div>
      </fieldset>

      <fieldset className="public-manage-card form-stack" disabled={saving}>
        <ClubFormSectionTitle>Philosophy of Pathfindering</ClubFormSectionTitle>
        <p className="club-form-note">{PHILOSOPHY_STATEMENT}</p>
        <label className="nca-agree">
          <input checked={agreed} id="club_agreed" {...errorProps("agreed")} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
          <span>{CHURCH_AGREEMENT}</span>
          <FieldError id="club_agreed_error">{errors.agreed}</FieldError>
        </label>
      </fieldset>

      <fieldset className="public-manage-card form-stack" disabled={saving}>
        <ClubFormSectionTitle>Signatures (type your full name)</ClubFormSectionTitle>
        <div className="form-grid two-column nca-grid">
          <label>
            Church pastor
            <input autoComplete="off" maxLength={120} onChange={(event) => set("pastorSignature", event.target.value)} id="club_pastorSignature" {...errorProps("pastorSignature")} value={values.pastorSignature} />
            <FieldError id="club_pastorSignature_error">{errors.pastorSignature}</FieldError>
          </label>
          <label>
            Head elder
            <input autoComplete="off" maxLength={120} onChange={(event) => set("headElderSignature", event.target.value)} id="club_headElderSignature" {...errorProps("headElderSignature")} value={values.headElderSignature} />
            <FieldError id="club_headElderSignature_error">{errors.headElderSignature}</FieldError>
          </label>
          <label>
            Church clerk
            <input autoComplete="off" maxLength={120} onChange={(event) => set("clerkSignature", event.target.value)} id="club_clerkSignature" {...errorProps("clerkSignature")} value={values.clerkSignature} />
            <FieldError id="club_clerkSignature_error">{errors.clerkSignature}</FieldError>
          </label>
          <label>
            Club director
            <input autoComplete="off" maxLength={120} onChange={(event) => set("directorSignature", event.target.value)} id="club_directorSignature" {...errorProps("directorSignature")} value={values.directorSignature} />
            <FieldError id="club_directorSignature_error">{errors.directorSignature}</FieldError>
          </label>
          <div className="club-form-field-wide nca-board">
            <span className="nca-board-title">Other church board members (optional)</span>
            {boardMembers.map((name, index) => (
              <div className="nca-board-row" key={index}>
                <input
                  aria-label={`Board member ${index + 1}`}
                  autoComplete="off"
                  maxLength={120}
                  onChange={(event) => setBoardMembers((current) => current.map((entry, at) => (at === index ? event.target.value : entry)))}
                  value={name}
                />
                <button aria-label={`Remove board member ${index + 1}`} className="secondary-button" onClick={() => setBoardMembers((current) => current.filter((_, at) => at !== index))} type="button">
                  <X aria-hidden="true" size={14} />
                </button>
              </div>
            ))}
            {boardMembers.length < MAX_OTHER_BOARD_MEMBERS && (
              <button className="secondary-button nca-board-add" onClick={() => setBoardMembers((current) => [...current, ""])} type="button">
                <Plus aria-hidden="true" size={14} /> Add a board member
              </button>
            )}
          </div>
        </div>
        <p className="field-help">Date: {todayLabel}</p>
      </fieldset>

      <fieldset className="public-manage-card form-stack" disabled={saving}>
        <ClubFormSectionTitle>Optional extras</ClubFormSectionTitle>
        <label>
          Attach the signed paper page or the church board minutes (PDF or image, up to 10 MB)
          <input accept={ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          <small className="field-help">Only conference administrators and Area Coordinators can open it.</small>
        </label>
        <label>
          Anything else we should know (optional)
          <textarea maxLength={1000} onChange={(event) => set("note", event.target.value)} rows={3} value={values.note} />
        </label>
      </fieldset>

      <div className="public-registration-honeypot" aria-hidden="true">
        <label htmlFor="new_club_website">Website</label>
        <input autoComplete="off" id="new_club_website" name="website" onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} type="text" value={website} />
      </div>

      {siteUpdating && <SubmitRetryNotice message={siteUpdating} busy={saving} onRetry={() => void submit()} />}
      <SecurityCheck config={securityCheck} action="club-application" handleRef={check} />
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      <div className="intro-actions">
        <button className="primary-button" disabled={saving} type="submit">{saving ? "Sending…" : "Send application"}</button>
      </div>
    </form>
  );
}
