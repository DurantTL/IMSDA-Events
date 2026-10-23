import type { Metadata } from "next";
import { AccessRestricted } from "@/components/access-restricted";
import { RegistrationBuilderWorkspace } from "@/components/registration-builder-workspace";
import { resolveEventContext } from "@/modules/events/selection";
import { listMealPlanPrices } from "@/modules/meals/config-repository";
import { listFormTemplates, listRegistrationForms } from "@/modules/forms/repository";
import { staffPageTitles } from "@/components/staff-navigation";

export const metadata: Metadata = { title: staffPageTitles.registrationForm };

export default async function RegistrationBuilderPage({ searchParams }: { searchParams: Promise<{ event?: string; form?: string; field?: string }> }) {
  const { event: requested, form: focusForm, field: focusField } = await searchParams;
  const { event, permissions, user } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FORMS")) {
    return <AccessRestricted title="Registration form access is restricted" detail="Event administrators and registration managers can create, test, and publish event forms." />;
  }
  // The builder works at every width, phones included (#1071), so there is no phone notice or device hint here.
  return <RegistrationBuilderWorkspace key={event.id} eventId={event.id} eventSlug={event.slug} eventName={event.name} eventAudience={event.audience} eventBillingMode={event.billingMode} initialForms={await listRegistrationForms(event.id)} mealPlanPrices={await listMealPlanPrices(event.id)} templates={await listFormTemplates()} focusTarget={focusForm && focusField ? { formId: focusForm, fieldId: focusField } : null} canEditNotifications={permissions.includes("CONFIGURE_EVENT")} canSaveAsTemplate={user.globalRole === "SYSTEM_ADMIN"} />;
}
