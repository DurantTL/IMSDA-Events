"use client";

import { SubmitButton } from "@/components/submit-button";
import { useState } from "react";
import { Save } from "lucide-react";
import { EmailInput, emailBlockingMessage } from "@/components/email-input";
import { FieldError, fieldErrorProps } from "@/components/field-error";
import { FormErrorSummary, summaryMessage, useFormErrorSummary } from "@/components/form-error-summary";
import { PhoneInput, phoneBlockingMessage } from "@/components/phone-input";
import { EMAIL_FIELD_MESSAGE, MAX_EMAIL_LENGTH, PHONE_FIELD_MESSAGE } from "@/lib/field-validation";
import type { ClubProfileRecord } from "@/modules/organizations/club-profile-repository";
import { sponsorOptionLabel } from "@/modules/organizations/domain";

type ProfileResponse = { profile?: ClubProfileRecord; message?: string; issues?: Array<{ message?: string; path?: Array<string | number> }> };
type ContactErrors = { contactEmail?: string; contactPhone?: string };

/**
 * The club profile (#375), for the club's director or deputy and for
 * conference staff. The same form posts to whichever endpoint the page gives.
 */
export function ClubProfileForm({
  sponsors,
  endpoint,
  initialProfile,
  variant = "account",
}: {
  sponsors: Array<{ id: string; name: string; type: string }>;
  endpoint: string;
  initialProfile: ClubProfileRecord;
  variant?: "account" | "staff";
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The contact email and phone name their own problems next to the field and in the linked summary (#1451).
  const [attempted, setAttempted] = useState(false);
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const { ref: summaryRef, items: summaryItems, show: showSummary, clear: clearSummary, clearField: clearSummaryField } = useFormErrorSummary();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setNotice("");
    setAttempted(true);
    const found: ContactErrors = {
      contactEmail: emailBlockingMessage("Contact email", String(form.get("contactEmail") ?? ""), profile.contactEmail) || undefined,
      contactPhone: phoneBlockingMessage("Contact phone", String(form.get("contactPhone") ?? ""), profile.contactPhone) || undefined,
    };
    if (found.contactEmail || found.contactPhone) {
      // The inputs show their own message from `showNow`; the summary links to them.
      setContactErrors({});
      showSummary([
        ...(found.contactEmail ? [{ targetId: "club-profile-email", message: summaryMessage("Contact email", found.contactEmail) }] : []),
        ...(found.contactPhone ? [{ targetId: "club-profile-phone", message: summaryMessage("Contact phone", found.contactPhone) }] : []),
      ]);
      return;
    }
    setContactErrors({});
    clearSummary();
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          sponsoringChurchId: String(form.get("sponsoringChurchId") ?? "") || null,
          meetingPlace: String(form.get("meetingPlace") ?? ""),
          meetingSchedule: String(form.get("meetingSchedule") ?? ""),
          contactEmail: String(form.get("contactEmail") ?? ""),
          contactPhone: String(form.get("contactPhone") ?? ""),
          publicDescription: String(form.get("publicDescription") ?? ""),
          listPublicly: form.get("listPublicly") === "on",
        }),
      });
      const result = await response.json().catch(() => ({})) as ProfileResponse;
      if (!response.ok || !result.profile) {
        // The server decides from the saved values; show its message next to the field it is about.
        const server: ContactErrors = {};
        for (const issue of result.issues ?? []) {
          if (issue.path?.[0] === "contactEmail") server.contactEmail = EMAIL_FIELD_MESSAGE;
          if (issue.path?.[0] === "contactPhone") server.contactPhone = PHONE_FIELD_MESSAGE;
        }
        if (server.contactEmail || server.contactPhone) {
          setContactErrors(server);
          showSummary([
            ...(server.contactEmail ? [{ targetId: "club-profile-email", message: summaryMessage("Contact email", server.contactEmail) }] : []),
            ...(server.contactPhone ? [{ targetId: "club-profile-phone", message: summaryMessage("Contact phone", server.contactPhone) }] : []),
          ]);
          return;
        }
        throw new Error(result.message ?? result.issues?.[0]?.message ?? "The club profile could not be saved.");
      }
      setProfile(result.profile);
      setNotice("Club settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The club profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const card = variant === "account" ? "public-manage-card form-stack" : "panel form-stack";

  return (
    <form
      className={card}
      key={profile.updatedAt ?? "new"}
      noValidate
      onChange={(event) => {
        const id = (event.target as HTMLElement).id;
        if (id === "club-profile-email" || id === "club-profile-phone") {
          clearSummaryField(id);
          setContactErrors((current) => ({ ...current, [id === "club-profile-email" ? "contactEmail" : "contactPhone"]: undefined }));
        }
      }}
      onSubmit={save}>
      <div className={variant === "account" ? "public-manage-card-heading" : "section-heading"}>
        <div>
          <p className={variant === "account" ? "public-registration-eyebrow" : "eyebrow"}>Club settings</p>
          <h2>About the club</h2>
        </div>
      </div>
      {notice && <div className="inline-notice success" role="status">{notice}</div>}
      {error && <div className="inline-notice error" role="alert">{error}</div>}
      {summaryItems.length > 0 && <FormErrorSummary items={summaryItems} ref={summaryRef} />}
      <div className="form-grid two-column">
        <label>
          Club name
          <input defaultValue={profile.name} maxLength={120} minLength={2} name="name" required translate="no" />
        </label>
        <label>
          Sponsoring church or company
          <select defaultValue={profile.sponsoringChurchId ?? ""} name="sponsoringChurchId" required>
            <option disabled value="">Choose a church or company</option>
            {sponsors.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsorOptionLabel(sponsor)}</option>)}
          </select>
        </label>
        <label>
          Meeting place
          <input defaultValue={profile.meetingPlace} maxLength={200} name="meetingPlace" placeholder="e.g. Church fellowship hall" />
        </label>
        <label>
          Meeting day and time
          <input defaultValue={profile.meetingSchedule} maxLength={120} name="meetingSchedule" placeholder="e.g. Sundays, 2:00–4:00 PM" />
        </label>
        <label>
          Contact email
          <EmailInput defaultValue={profile.contactEmail} id="club-profile-email" label="Contact email" maxLength={MAX_EMAIL_LENGTH} name="contactEmail" showNow={attempted} stored={profile.contactEmail} {...fieldErrorProps("club-profile-email-server-error", contactErrors.contactEmail)} />
          <FieldError id="club-profile-email-server-error">{contactErrors.contactEmail}</FieldError>
        </label>
        <label>
          Contact phone
          <PhoneInput defaultValue={profile.contactPhone} id="club-profile-phone" label="Contact phone" name="contactPhone" showNow={attempted} stored={profile.contactPhone} {...fieldErrorProps("club-profile-phone-server-error", contactErrors.contactPhone)} />
          <FieldError id="club-profile-phone-server-error">{contactErrors.contactPhone}</FieldError>
        </label>
      </div>
      <label>
        Short description
        <textarea defaultValue={profile.publicDescription} maxLength={1000} name="publicDescription" rows={4} />
      </label>
      <label className="checkbox-label">
        <input defaultChecked={profile.listPublicly} name="listPublicly" type="checkbox" />
        List this club publicly when &ldquo;find a club&rdquo; opens
      </label>
      <p className="field-help">
        The contact email and phone are for families looking for a club. Use a club or church contact, not a
        young person&apos;s. Every change is recorded.
      </p>
      <div>
        <SubmitButton className="primary-button" icon={<Save aria-hidden="true" size={16} />} label="Save profile" submitting={saving} submittingLabel="Saving…" />
      </div>
    </form>
  );
}
