import { staffPageTitles } from "@/components/staff-navigation";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InformationFormResponsesView } from "@/components/information-form-responses-view";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadInformationFormResponsesPage } from "@/modules/information-forms/responses-page";
import { informationFormPageViews } from "@/components/form-page-views";
import { generalInformationConfig } from "@/components/registration-builder/information-mode";
import { parseFormsHubReturn } from "@/modules/forms-hub/return";
import { AdminSectionHeaderFor } from "@/components/admin-section-header";

export const metadata: Metadata = { title: staffPageTitles.formResponses };
export const dynamic = "force-dynamic";

/** The responses of a general information form (#1150): system administrators only, like the general form APIs. */
export default async function GeneralInformationFormResponsesPage({ params, searchParams }: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<{ response?: string; cursor?: string; returnTo?: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access?from=system");
  const { formId } = await params;
  const { response, cursor, returnTo } = await searchParams;
  // "Back to All forms" only when the address came from the All forms list; it grants nothing (#1571).
  const hubBack = parseFormsHubReturn(returnTo);
  const keep = hubBack ? `returnTo=${encodeURIComponent(hubBack.href)}` : "";
  const data = await loadInformationFormResponsesPage({ scope: "GENERAL" }, formId, { responseId: response, cursor });
  if (!data) notFound();
  const base = `/admin/information-forms/${encodeURIComponent(formId)}/responses`;
  return (
    <>
    <AdminSectionHeaderFor back={hubBack ?? undefined} path={`/admin/information-forms/${formId}/responses`} section="system" />
    <InformationFormResponsesView
      views={informationFormPageViews(generalInformationConfig(), formId, "responses")}
      closeHref={keep ? `${base}?${keep}` : base}
      exportHref={`/api/admin/information-forms/${encodeURIComponent(formId)}/responses/export`}
      membersExportHref={data.hasMemberList ? `/api/admin/information-forms/${encodeURIComponent(formId)}/responses/export?format=members` : undefined}
      formName={data.name}
      nextHref={data.nextCursor ? `${base}?cursor=${encodeURIComponent(data.nextCursor)}${keep ? `&${keep}` : ""}` : null}
      rowHref={(id) => `${base}?response=${encodeURIComponent(id)}${keep ? `&${keep}` : ""}`}
      rows={data.rows}
      selected={data.selected}
      total={data.total}
    />
    </>
  );
}
