// Save errors, status notices and the duplicate-public-form warning above the editor.
import { AlertTriangle } from "lucide-react";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { SITE_UPDATING_MESSAGE } from "@/lib/submit-json";
import { DUPLICATE_PUBLIC_FORMS_MESSAGE } from "@/modules/forms/duplicate-public-forms";
import { useBuilder } from "./builder-context";

export function BuilderNotices() {
  const { duplicatePublishedGroups, notice, error, retryRef, busy } = useBuilder();
  return (
    <>
        {error === SITE_UPDATING_MESSAGE && <SubmitRetryNotice busy={Boolean(busy)} onRetry={() => retryRef.current?.()} />}
        {error && error !== SITE_UPDATING_MESSAGE && <div className="inline-notice error" role="alert">{error}</div>}
    {notice && <div className="inline-notice" role="status">{notice}</div>}

    {duplicatePublishedGroups.length > 0 && <section className="panel builder-duplicate-warning" role="alert" data-testid="duplicate-public-forms-warning"><p className="builder-gate"><AlertTriangle size={15} /> <strong>{DUPLICATE_PUBLIC_FORMS_MESSAGE}</strong> {duplicatePublishedGroups.map((group) => `“${group[0]!.title}” (${group.map((form) => form.name).join(", ")})`).join("; ")}.</p></section>}
    </>
  );
}
