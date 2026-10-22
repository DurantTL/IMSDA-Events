import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { notFound, redirect } from "next/navigation";
import { BuilderPhoneNotice } from "@/components/builder-phone-notice";
import { FormTemplateEditor } from "@/components/form-template-editor";
import { getCurrentSession } from "@/modules/access/current-session";
import { getFormTemplateForEditor } from "@/modules/forms/form-template-library";
import { FormTemplateError } from "@/modules/forms/form-template-library-domain";

export const metadata: Metadata = { title: "Form template" };
export const dynamic = "force-dynamic";

/**
 * The form template editor (#1064). System administrators only, checked here
 * and again on every route the editor calls. It shows the template's definition
 * and never an event, a registration or an answer.
 */
export default async function FormTemplateEditorPage({ params }: { params: Promise<{ templateKey: string }> }) {
  const { user } = await getCurrentSession();
  if (!user) redirect(await staffLoginRedirectPath());
  if (user.globalRole !== "SYSTEM_ADMIN") redirect("/no-access");
  const { templateKey } = await params;
  const opened = await getFormTemplateForEditor(templateKey).then(
    (found) => ({ view: found, unreadable: false }),
    (error: unknown) => {
      if (error instanceof FormTemplateError && error.code === "TEMPLATE_UNREADABLE") return { view: null, unreadable: true };
      throw error;
    },
  );
  const { view } = opened;
  if (!view && !opened.unreadable) notFound();

  return (
    <section className="page-stack">
      <BackLink href="/admin/form-templates" variant="staff">Back to form templates</BackLink>
      <div className="page-intro">
        <div>
          <p className="eyebrow">System administration</p>
          <h2>{view?.name ?? "Form template"}</h2>
          <p>Saving creates a new version of this template. Forms already created from it keep the definition they were created with.</p>
        </div>
      </div>
      <BuilderPhoneNotice backHref="/admin/form-templates" backLabel="Back to form templates" builderName="form template editor" />
      <div className="builder-phone-hidden">
        {view ? <FormTemplateEditor key={`${view.key}-${view.version}`} templateKey={view.key} name={view.name} description={view.description} audience={view.audience} version={view.version} source={view.source} appCreated={view.appCreated} definition={view.definition} repairingUnreadable={view.repairingUnreadable} usedByForms={view.usedByForms} versions={view.versions} />
          : <div className="inline-notice error" role="alert">This template&apos;s stored definition can no longer be read, so it cannot be opened. Event staff cannot pick it.</div>}
      </div>
    </section>
  );
}
