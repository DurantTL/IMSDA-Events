import { getCurrentSession } from "@/modules/access/current-session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { BuilderDeviceHint } from "@/components/builder-device-hint";
import { BuilderPhoneNotice } from "@/components/builder-phone-notice";
import { InformationFormsHome } from "@/components/information-forms-home";
import { loadInformationFormsHome, loadInformationFormView } from "@/components/information-forms-page-data";
import { eventInformationConfig, informationListHref } from "@/components/registration-builder/information-mode";
import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { ListPage } from "@/components/page-templates/list-page";
import { PageHeader } from "@/components/page-header";
import { parseFormsHubReturn } from "@/modules/forms-hub/return";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: "Information forms" };
export const dynamic = "force-dynamic";

/**
 * An event's information forms (#1149), in the event workspace like the registration form builder: the list, and with
 * `form=` the builder in its information mode. It needs MANAGE_FORMS on the event (checked here and again on every route
 * the builder calls). A form of another event or of no event is "not found".
 */
export default async function InformationFormsPage({ searchParams }: { searchParams: Promise<{ event?: string; form?: string; returnTo?: string }> }) {
  const { event: requested, form: formId, returnTo } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FORMS")) {
    // The page draws its own title (#1572) in every state, so the restricted state keeps the page's one h1 too.
    return (
      <>
        <PageHeader title="Information forms" />
        <AccessRestricted title="Information form access is restricted" detail="Event administrators and registration managers can create, preview, and publish information forms for an event." whoToAsk="your event administrator" />
      </>
    );
  }
  const { user } = await getCurrentSession();
  const config = eventInformationConfig(event, user?.globalRole === "SYSTEM_ADMIN");
  const target = { scope: "EVENT", eventId: event.id } as const;

  if (!formId) {
    const { forms, templates } = await loadInformationFormsHome(target);
    return (
      <ListPage header={{ title: "Information forms", description: `Surveys and interest forms for ${event.name}. Open one to build it in the form builder.` }}>
        <InformationFormsHome config={config} forms={forms} templates={templates} />
      </ListPage>
    );
  }

  const form = await loadInformationFormView(target, formId);
  if (!form) notFound();
  const listHref = informationListHref(config);
  // "Back to All forms" only when the address came from the All forms list; it grants nothing (#1571).
  const hubBack = parseFormsHubReturn(returnTo);
  return (
    <section className="page-stack">
      <PageHeader title="Information forms" {...(hubBack ? { back: hubBack } : {})} />
      <BuilderPhoneNotice backHref={hubBack?.href ?? listHref} backLabel={hubBack?.label ?? "Back to information forms"} builderName="information form builder" />
      <div className="builder-phone-hidden">
        <BuilderDeviceHint />
        <RegistrationBuilderWorkspace key={form.id} eventId={event.id} eventSlug={event.slug} eventName={event.name} initialForms={[form]} templates={[]} information={config} canEditNotifications={false} canSaveAsTemplate={false} />
      </div>
    </section>
  );
}
