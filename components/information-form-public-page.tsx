import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { InformationFormFillIn } from "@/components/information-form-fill-in";
import { getCurrentAttendee } from "@/modules/attendee-accounts/current-attendee";
import { attendeeSecondStepPending } from "@/modules/attendee-accounts/portal-second-step";
import { attendeeSignInPathFor, twoStepPathFor } from "@/modules/attendee-accounts/return-destination";
import { publicInformationFormKey, publicInformationFormPath, resolvePublicInformationForm, type PublicInformationFormTarget } from "@/modules/information-forms/public";
import { checkInformationFormClientRateLimit, checkInformationFormRateLimit } from "@/modules/rate-limit/service";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="public-registration-page public-manage-page information-form-page">
      <header className="public-registration-header">
        <div className="public-registration-header-inner">
          <Link className="public-registration-brand public-event-brand-link" href="/">
            <BrandMark />
            <span><strong>IMSDA</strong><small>Events</small></span>
          </Link>
        </div>
      </header>
      {children}
    </main>
  );
}

function Notice({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <Shell>
      <section className="public-registration-not-found information-form-notice">
        <p className="public-registration-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children}
      </section>
    </Shell>
  );
}

function when(date: Date) {
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago" }).format(date)} Central time`;
}

/**
 * The public fill page of an information form (#1150), shared by `/forms/[slug]` and
 * `/events/[eventSlug]/forms/[slug]`. Not found, not yet open, closed, sign-in needed, and the form itself.
 * The thank-you state is the form's own, after a successful send.
 */
export async function InformationFormPublicPage({ target }: { target: PublicInformationFormTarget }) {
  const requestLike = new Request("http://information-forms.invalid/", { headers: await headers() });
  const clientLimit = await checkInformationFormClientRateLimit(requestLike, "read");
  const pairLimit = clientLimit.allowed ? await checkInformationFormRateLimit(requestLike, publicInformationFormKey(target), "read") : clientLimit;
  if (!pairLimit.allowed) {
    return <Notice eyebrow="Please wait" title="Too many attempts"><p>Try this page again in a few minutes.</p></Notice>;
  }
  const view = await resolvePublicInformationForm(target);
  if (view.state === "NOT_FOUND") notFound();
  if (view.state === "NOT_YET_OPEN") {
    return (
      <Notice eyebrow={view.eventName ?? "Not open yet"} title={view.name}>
        <p>This form is not open yet. It opens {when(view.opensAt)}.</p>
      </Notice>
    );
  }
  if (view.state === "CLOSED") {
    return (
      <Notice eyebrow={view.eventName ?? "Closed"} title={view.name}>
        <p>This form is closed and is no longer taking answers.</p>
      </Notice>
    );
  }

  const { form } = view;
  // Signed-in visitors never get a browser draft, like the public registration form (#1263).
  const { account } = await getCurrentAttendee();
  if (form.fillAccess === "SIGNED_IN") {
    const path = publicInformationFormPath(target);
    if (!account) {
      return (
        <Notice eyebrow={view.eventName ?? "Sign in"} title={form.name}>
          <p>You need to sign in to answer this form.</p>
          <div className="intro-actions">
            <Link className="primary-button information-form-action" href={attendeeSignInPathFor(path)}>Sign in</Link>
          </div>
        </Notice>
      );
    }
    if (await attendeeSecondStepPending()) {
      return (
        <Notice eyebrow={view.eventName ?? "Sign in"} title={form.name}>
          <p>Finish your second sign-in step to answer this form.</p>
          <div className="intro-actions">
            <Link className="primary-button information-form-action" href={twoStepPathFor(path)}>Continue sign in</Link>
          </div>
        </Notice>
      );
    }
  }

  return (
    <Shell>
      <section className="public-registration-hero public-manage-hero">
        <div>
          {view.eventName && <p className="public-registration-eyebrow">{view.eventName}</p>}
          <h1>{form.definition.title || form.name}</h1>
          {form.definition.description && <p>{form.definition.description}</p>}
          {form.closesAt && <p>Open until {when(form.closesAt)}.</p>}
        </div>
      </section>
      <div className="public-manage-layout club-form-public">
        <InformationFormFillIn definition={form.definition} disableDrafts={Boolean(account)} eventSlug={target.eventSlug} slug={target.slug} />
      </div>
    </Shell>
  );
}
