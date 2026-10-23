import { staffPageTitles } from "@/components/staff-navigation";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InformationFormResponsesView } from "@/components/information-form-responses-view";
import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import { getCurrentSession } from "@/modules/access/current-session";
import { loadInformationFormResponsesPage } from "@/modules/information-forms/responses-page";

export const metadata: Metadata = { title: staffPageTitles.formResponses };
export const dynamic = "force-dynamic";

/** The responses of a general information form (#1150): system administrators only, like the general form APIs. */
export default async function GeneralInformationFormResponsesPage({ params, searchParams }: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<{ response?: string; cursor?: string }>;
}) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const { formId } = await params;
  const { response, cursor } = await searchParams;
  const data = await loadInformationFormResponsesPage({ scope: "GENERAL" }, formId, { responseId: response, cursor });
  if (!data) notFound();
  const base = `/admin/information-forms/${encodeURIComponent(formId)}/responses`;
  return (
    <InformationFormResponsesView
      closeHref={base}
      exportHref={`/api/admin/information-forms/${encodeURIComponent(formId)}/responses/export`}
      formName={data.name}
      nextHref={data.nextCursor ? `${base}?cursor=${encodeURIComponent(data.nextCursor)}` : null}
      rowHref={(id) => `${base}?response=${encodeURIComponent(id)}`}
      rows={data.rows}
      selected={data.selected}
      total={data.total}
    />
  );
}
