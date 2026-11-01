import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { BrandMark } from "@/components/brand-mark";
import { ClubFormFillIn } from "@/components/club-form-fill-in";
import { ClubFormError } from "@/modules/club-forms/errors";
import { resolveOpenApplication } from "@/modules/club-forms/open-applications";
import { checkClubFormApplicationRateLimit } from "@/modules/rate-limit/service";
import { securityCheckConfigForPage } from "@/modules/security/security-check-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Apply",
  robots: { index: false, follow: true },
  referrer: "no-referrer",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="public-registration-page public-manage-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
          <div className="public-header-links">
            <BackLink href="/clubs/forms">Club forms</BackLink>
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

/**
 * A club form's public open application (#1229): one reusable link per club year. Anyone with it picks their club
 * (names only) or "Not listed" and fills the form in. Turned off it says "Not available yet."; closed for the year it
 * says so; an unknown key, or a form that is not an open application, is a 404. It shows no other club data.
 */
export default async function OpenApplicationPage({ params }: { params: Promise<{ templateKey: string }> }) {
  await connection();
  const { templateKey } = await params;
  const requestLike = new Request("http://club-forms.invalid/", { headers: await headers() });
  const rateLimit = await checkClubFormApplicationRateLimit(requestLike, templateKey, "read");
  if (!rateLimit.allowed) {
    return (
      <Shell>
        <section className="public-registration-not-found">
          <p className="public-registration-eyebrow">Please wait</p>
          <h1>Too many attempts</h1>
          <p>Try this page again in a few minutes.</p>
        </section>
      </Shell>
    );
  }
  const view = await resolveOpenApplication(templateKey).catch((error: unknown) => {
    if (error instanceof ClubFormError && error.code === "TEMPLATE_NOT_FOUND") return null;
    if (error instanceof ClubFormError && error.code === "FORM_UNAVAILABLE") return "TEMPORARILY_UNAVAILABLE" as const;
    throw error;
  });
  if (!view) notFound();
  if (view === "TEMPORARILY_UNAVAILABLE") {
    return (
      <Shell>
        <section className="public-registration-not-found">
          <p className="public-registration-eyebrow">Please try again later</p>
          <h1>This form is temporarily unavailable</h1>
          <p>Please try again later.</p>
        </section>
      </Shell>
    );
  }
  if (view.status !== "OPEN") {
    return (
      <Shell>
        <section className="public-registration-not-found">
          <p className="public-registration-eyebrow">Club forms</p>
          <h1>{view.message}</h1>
        </section>
      </Shell>
    );
  }
  const { form } = view;

  return (
    <Shell>
      <section className="public-registration-hero public-manage-hero">
        <div>
          <p className="public-registration-eyebrow">Iowa-Missouri Conference</p>
          <h1>{form.definition.title}</h1>
          {form.definition.description && <p>{form.definition.description}</p>}
        </div>
      </section>
      <div className="public-manage-layout club-form-public">
        <ClubFormFillIn
          clubs={view.clubs}
          definition={form.definition}
          mode="open"
          securityCheck={await securityCheckConfigForPage()}
          sectionNotes={form.sectionNotes}
          sensitiveFieldKeys={form.sensitiveFieldKeys}
          templateKey={form.key}
          todayDate={view.today}
        />
      </div>
    </Shell>
  );
}
