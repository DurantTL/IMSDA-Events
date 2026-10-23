import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { BuilderDeviceHint } from "@/components/builder-device-hint";
import { BuilderPhoneNotice } from "@/components/builder-phone-notice";
import { InformationFormsHome } from "@/components/information-forms-home";
import { loadInformationFormsHome, loadInformationFormView } from "@/components/information-forms-page-data";
import { eventInformationConfig, informationListHref } from "@/components/registration-builder/information-mode";
import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { StaffPageHeader } from "@/components/staff-page-header";
import { resolveEventContext } from "@/modules/events/selection";

export const metadata: Metadata = { title: "Information forms" };
export const dynamic = "force-dynamic";

/**
 * An event's information forms (#1149), in the event workspace like the registration form builder: the list, and with
 * `form=` the builder in its information mode. It needs MANAGE_FORMS on the event (checked here and again on every route
 * the builder calls). A form of another event or of no event is "not found".
 */
export default async function InformationFormsPage({ searchParams }: { searchParams: Promise<{ event?: string; form?: string }> }) {
  const { event: requested, form: formId } = await searchParams;
  const { event, permissions } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FORMS")) {
    return <AccessRestricted title="Information form access is restricted" detail="Event administrators and registration managers can create, preview, and publish information forms for an event." />;
  }
  const config = eventInformationConfig(event);
  const target = { scope: "EVENT", eventId: event.id } as const;

  if (!formId) {
    const { forms, templates } = await loadInformationFormsHome(target);
    return (
      <section className="page-stack">
        <StaffPageHeader description={`Surveys and interest forms for ${event.name}. Open one to build it in the form builder.`} />
        <InformationFormsHome config={config} forms={forms} templates={templates} />
      </section>
    );
  }

  const form = await loadInformationFormView(target, formId);
  if (!form) notFound();
  const listHref = informationListHref(config);
  return (
    <section className="page-stack">
      <BuilderPhoneNotice backHref={listHref} backLabel="Back to information forms" builderName="information form builder" />
      <div className="builder-phone-hidden">
        <BuilderDeviceHint />
        <RegistrationBuilderWorkspace key={form.id} eventId={event.id} eventSlug={event.slug} eventName={event.name} initialForms={[form]} templates={[]} information={config} canEditNotifications={false} canSaveAsTemplate={false} />
      </div>
    </section>
  );
}
