"use client";

import { useRef, useState, type FormEvent } from "react";
import { useUnsavedChangesGuard } from "@/components/use-unsaved-changes-guard";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { submitJson, unavailableMessage } from "@/lib/submit-json";
import { AlertCircle, CheckCircle2, KeyRound, Save } from "lucide-react";
import { EmailInput, emailBlockingMessage } from "@/components/email-input";
import { PhoneInput, phoneBlocks } from "@/components/phone-input";
import { formatPersonName } from "@/lib/person-name";

type Contact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export function AttendeeRegistrationContactForm({
  registrationId,
  initialContact,
}: {
  registrationId: string;
  initialContact: Contact;
}) {
  const [contact, setContact] = useState(initialContact);
  // The summary shows the last saved contact, not what is being typed.
  const [savedContact, setSavedContact] = useState(initialContact);
  const [code, setCode] = useState("");
  // Typed contact details that differ from the last saved ones; saving in place turns the warning off (#1452).
  const dirty = (Object.keys(contact) as Array<keyof Contact>).some((name) => contact[name] !== savedContact[name]);
  useUnsavedChangesGuard(dirty, "You have unsaved changes to this contact. Leave this page and discard them?");
  const [attempted, setAttempted] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [saving, setSaving] = useState(false);
  // The site was restarting (#1263): the fields and the typed code stay, and Try again sends them as they are.
  const [siteUpdating, setSiteUpdating] = useState<string | false>(false);
  const retryRef = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<{ tone: "idle" | "error" | "saved"; message: string }>({
    tone: "idle",
    message: "",
  });

  function field(name: keyof Contact, value: string) {
    setContact((current) => ({ ...current, [name]: value }));
    setNotice({ tone: "idle", message: "" });
  }

  async function requestCode() {
    if (requesting) return;
    setSiteUpdating(false);
    setRequesting(true);
    setNotice({ tone: "idle", message: "Requesting a code…" });
    try {
      const response = await submitJson("/api/attendee/step-up", {});
      if (response.unavailable) {
        setSiteUpdating(unavailableMessage(response));
        retryRef.current = () => void requestCode();
        setNotice({ tone: "idle", message: "" });
        return;
      }
      const payload = response.body as {
        message?: string;
        developmentCode?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message ?? "The code could not be sent.");
      if (payload?.developmentCode) setCode(payload.developmentCode);
      setNotice({ tone: "saved", message: payload?.message ?? "Check your email for the code." });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The code could not be sent.",
      });
    } finally {
      setRequesting(false);
    }
  }

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;
    setSiteUpdating(false);
    setAttempted(true);
    // The saved phone is the one the server compares with (#871); the same number never blocks.
    // The browser's required and email checks are off (noValidate); the app says what is missing.
    if (!contact.firstName.trim() || !contact.lastName.trim() || !contact.email.trim()) {
      setNotice({ tone: "error", message: "Enter the first name, last name and email address, then save again." });
      return;
    }
    if (emailBlockingMessage("Email", contact.email, savedContact.email)) {
      setNotice({ tone: "error", message: "Fix the highlighted email address and save again." });
      return;
    }
    if (phoneBlocks("Phone", contact.phone, savedContact.phone)) {
      setNotice({ tone: "error", message: "Fix the highlighted phone number and save again." });
      return;
    }
    setSaving(true);
    setNotice({ tone: "idle", message: "Saving contact details…" });
    try {
      const response = await submitJson(
        `/api/attendee/registrations/${encodeURIComponent(registrationId)}`,
        { code, contact },
        { method: "PATCH" },
      );
      if (response.unavailable) {
        setSiteUpdating(unavailableMessage(response));
        retryRef.current = () => void save();
        setNotice({ tone: "idle", message: "" });
        return;
      }
      const payload = response.body as {
        contact?: Contact;
        message?: string;
      } | null;
      if (!response.ok || !payload?.contact) {
        throw new Error(payload?.message ?? "The contact details could not be saved.");
      }
      setContact(payload.contact);
      setSavedContact(payload.contact);
      setCode("");
      setNotice({ tone: "saved", message: "Contact details saved. The code has been used." });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The contact details could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="public-manage-contact-card">
      <summary>
        Update registration contact
        <small className="public-manage-contact-current" translate="no">
          {[formatPersonName(savedContact), savedContact.email].filter(Boolean).join(" · ")}
        </small>
      </summary>
      <form noValidate onSubmit={save}>
        <p>A fresh emailed code is required. It works only in this signed-in session.</p>
        <div className="public-manage-contact-grid">
          <label className="public-registration-field">
            <span className="public-registration-field-label">First name</span>
            <input required maxLength={80} value={contact.firstName} onChange={(event) => field("firstName", event.target.value)} />
          </label>
          <label className="public-registration-field">
            <span className="public-registration-field-label">Last name</span>
            <input required maxLength={80} value={contact.lastName} onChange={(event) => field("lastName", event.target.value)} />
          </label>
          <label className="public-registration-field public-manage-contact-wide">
            <span className="public-registration-field-label">Email</span>
            <EmailInput label="Email" required showNow={attempted} stored={savedContact.email} value={contact.email} onValueChange={(value) => field("email", value)} />
          </label>
          <label className="public-registration-field public-manage-contact-wide">
            <span className="public-registration-field-label">Phone</span>
            <PhoneInput label="Phone" showNow={attempted} stored={savedContact.phone} value={contact.phone} onValueChange={(value) => field("phone", value)} />
          </label>
          <label className="public-registration-field public-manage-contact-wide">
            <span className="public-registration-field-label">Six-digit edit code</span>
            <input autoComplete="one-time-code" inputMode="numeric" maxLength={7} value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
        </div>
        <div className="public-manage-contact-actions">
          <button type="button" onClick={requestCode} disabled={requesting}>
            <KeyRound size={17} aria-hidden="true" />
            {requesting ? "Sending…" : "Email a code"}
          </button>
          <button type="submit" disabled={saving || code.replace(/\s+/g, "").length !== 6}>
            <Save size={17} aria-hidden="true" />
            {saving ? "Saving…" : "Save with code"}
          </button>
          <p className={notice.tone === "error" ? "is-error" : notice.tone === "saved" ? "is-saved" : ""} role={notice.tone === "error" ? "alert" : "status"} aria-live="polite">
            {notice.tone === "error" && <AlertCircle size={16} aria-hidden="true" />}
            {notice.tone === "saved" && <CheckCircle2 size={16} aria-hidden="true" />}
            {notice.message}
          </p>
        </div>
        {siteUpdating && <SubmitRetryNotice message={siteUpdating} busy={saving || requesting} onRetry={() => retryRef.current?.()} />}
      </form>
    </details>
  );
}
