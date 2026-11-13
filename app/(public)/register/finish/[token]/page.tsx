import type { Metadata } from "next";
import { Link2Off, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandLink } from "@/components/brand-link";
import { EventContentBlocks, publicEventAssetUrl } from "@/components/event-content-blocks";
import { EventInfoCards } from "@/components/event-info-cards";
import { PublicRegistrationForm, type FormResponses } from "@/components/public-registration-form";
import { listPublishedRegistrationInfoCards } from "@/modules/events/content-repository";
import { getPublicRegistrationExperience } from "@/modules/forms/public-repository";
import { passkeyOfferForPage } from "@/modules/attendee-accounts/passkey-offer-eligibility";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";
import { getFormsHelpContact } from "@/modules/system-admin/platform-settings";
import { clubEventEntryRedirect } from "@/modules/general-link-registrations/repository";
import { RegistrationThemeScope } from "@/components/registration-theme-scope";
import { getPublishedThemeRowBySlug } from "@/modules/registration-themes/repository";
import { registrationThemeStyle, resolveRegistrationTheme } from "@/modules/registration-themes/resolve";
import { prefillFromStaffDraft, resolveStaffDraftLink } from "@/modules/staff-registration-drafts/repository";

export const dynamic = "force-dynamic";

/** A private link: never indexed, cached or sent in a referrer (the headers are set for this path in `next.config.ts`). */
export const metadata: Metadata = {
  title: "Finish your registration",
  description: "Check your answers, add the rest and submit your event registration.",
  robots: { index: false, follow: false, nocache: true },
};

function serializeDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** The same page for an unknown, used, withdrawn or expired link: it never says which. */
function LinkUnavailable() {
  return (
    <main className="public-registration-page public-manage-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <BrandLink className="public-registration-brand public-event-brand-link" wordmark />
        </div>
      </header>
      <section className="public-registration-not-found">
        <span><Link2Off size={32} aria-hidden="true" /></span>
        <h1>This link has been used or has expired.</h1>
        <p>Contact the event office.</p>
        <a className="public-event-not-found-link" href="https://imsda.org/contact/" rel="noreferrer">
          <Mail size={16} aria-hidden="true" /> Contact IMSDA
        </a>
      </section>
    </main>
  );
}

/**
 * The page the registrant opens from the private link staff sent (#1510): the ordinary public form, prefilled with what staff
 * entered, submitted through the ordinary public submit. Its answers are the registrant's to check and change.
 */
export default async function FinishStaffRegistrationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveStaffDraftLink(token);
  if (!link) return <LinkUnavailable />;
  const experience = await getPublicRegistrationExperience(link.eventSlug, link.formSlug);
  if (!experience) return <LinkUnavailable />;
  const clubEntry = await clubEventEntryRedirect(link.eventSlug);
  if (clubEntry) redirect(clubEntry);
  // The same rule as the public form: a closed, not-yet-open or full event goes to the event page.
  if (experience.lifecycle.phase !== "OPEN" || experience.lifecycle.capacityDecision === "FULL") {
    redirect(`/events/${encodeURIComponent(link.eventSlug)}`);
  }
  // Only the answers to questions the form asks now; the public submit uses the current published version.
  // The sanitizer keeps plain strings, booleans, string lists and string maps only, which is what the form's answers hold.
  const initialResponses = prefillFromStaffDraft(experience.form.definition, link.responses) as FormResponses;
  const editableCards = await listPublishedRegistrationInfoCards(link.eventSlug);
  const themeStyle = registrationThemeStyle(resolveRegistrationTheme(await getPublishedThemeRowBySlug(link.eventSlug)));
  return (
    <RegistrationThemeScope style={themeStyle}>
    <PublicRegistrationForm
      formsHelpContact={await getFormsHelpContact()}
      event={{
        ...experience.event,
        startsAt: serializeDate(experience.event.startsAt),
        endsAt: serializeDate(experience.event.endsAt),
      }}
      form={experience.form}
      choiceUsage={experience.choiceUsage}
      pricingDate={experience.pricingDate}
      lifecycle={experience.lifecycle}
      lodging={experience.lodging}
      merchandise={experience.merchandise}
      initialResponses={initialResponses}
      initialAttendeeResponses={{}}
      staffDraftToken={token}
      securityCheck={await securityCheckConfigForPage()}
      disableDrafts
      passkeyOffer={await passkeyOfferForPage()}
      topContent={editableCards.length > 0 ? (
        <>
          <EventInfoCards sections={editableCards} eventSlug={link.eventSlug} placement="registration" />
          <EventContentBlocks
            sections={editableCards}
            placement="registration"
            assetUrl={(assetId) => publicEventAssetUrl(link.eventSlug, assetId)}
            idPrefix="registration-block"
          />
        </>
      ) : undefined}
    />
    </RegistrationThemeScope>
  );
}
