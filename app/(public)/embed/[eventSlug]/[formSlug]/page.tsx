import type { Metadata } from "next";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLink } from "@/components/brand-link";
import { passkeyOfferForPage } from "@/modules/attendee-accounts/passkey-offer-eligibility";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { PublicRegistrationForm } from "@/components/public-registration-form";
import { getPublicRegistrationExperience } from "@/modules/forms/public-repository";
import { RegistrationThemeScope } from "@/components/registration-theme-scope";
import { getPublishedThemeRowBySlug } from "@/modules/registration-themes/repository";
import { registrationThemeStyle, resolveRegistrationTheme } from "@/modules/registration-themes/resolve";

export const dynamic = "force-dynamic";

type EmbeddedRegistrationPageProps = {
  params: Promise<{ eventSlug: string; formSlug: string }>;
};

export const metadata: Metadata = {
  title: "Embedded registration",
  robots: { index: false, follow: false },
};

function serializeDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

export default async function EmbeddedRegistrationPage({
  params,
}: EmbeddedRegistrationPageProps) {
  const { eventSlug, formSlug } = await params;
  const experience = await getPublicRegistrationExperience(eventSlug, formSlug);
  if (!experience) notFound();

  const themeStyle = registrationThemeStyle(resolveRegistrationTheme(await getPublishedThemeRowBySlug(eventSlug)));

  if (
    experience.lifecycle.phase !== "OPEN"
    || experience.lifecycle.capacityDecision === "FULL"
  ) {
    return (
      <RegistrationThemeScope style={themeStyle}>
      <main className="public-registration-embed-state">
        <BrandLink target="_top" />
        <p className="public-registration-eyebrow">IMAdventist</p>
        <h1>Online registration is not available here</h1>
        <p>Open the event page for current dates, availability, waitlist information, and help.</p>
        <Link
          className="primary-button"
          href={`/events/${encodeURIComponent(eventSlug)}`}
          target="_top"
        >
          View event registration
        </Link>
      </main>
      </RegistrationThemeScope>
    );
  }

  const { account } = await getCurrentAttendee();

  return (
    <RegistrationThemeScope style={themeStyle}>
    <div className="public-registration-embed">
      <PublicRegistrationForm
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
        embedded
        disableDrafts={Boolean(account)}
        passkeyOffer={await passkeyOfferForPage()}
        securityCheck={await securityCheckConfigForPage()}
      />
    </div>
    </RegistrationThemeScope>
  );
}
