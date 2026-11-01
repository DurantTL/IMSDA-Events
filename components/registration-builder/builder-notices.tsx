// Save errors, status notices and the duplicate-public-form warning above the editor.
import { AlertTriangle } from "lucide-react";
import { LOCAL_EDIT_DRAFT_RESTORED_NOTICE } from "@/lib/local-edit-draft";
import { FormMessage } from "@/components/form-message";
import { SubmitRetryNotice } from "@/components/submit-retry-notice";
import { isUnavailableMessage } from "@/lib/submit-json";
import { DUPLICATE_PUBLIC_FORMS_MESSAGE } from "@/modules/forms/duplicate-public-forms";
import { useBuilder } from "./builder-context";

export function BuilderNotices() {
  const { duplicatePublishedGroups, notice, error, retryRef, busy, editBackup } = useBuilder();
  return (
    <>
        {editBackup.restored && <div className="form-notice draft-restored-notice" role="status"><span>{LOCAL_EDIT_DRAFT_RESTORED_NOTICE}</span><button className="secondary-button" type="button" onClick={editBackup.discard}>Discard</button></div>}
        {Boolean(error) && isUnavailableMessage(error) && <SubmitRetryNotice message={error} busy={Boolean(busy)} onRetry={() => retryRef.current?.()} />}
        {error && !isUnavailableMessage(error) && <FormMessage message={error} tone="error" />}
    {notice && <FormMessage message={notice} tone="success" />}

    {duplicatePublishedGroups.length > 0 && <section className="panel builder-duplicate-warning" role="alert" data-testid="duplicate-public-forms-warning"><p className="builder-gate"><AlertTriangle size={15} /> <strong>{DUPLICATE_PUBLIC_FORMS_MESSAGE}</strong> {duplicatePublishedGroups.map((group) => `“${group[0]!.title}” (${group.map((form) => form.name).join(", ")})`).join("; ")}.</p></section>}
    </>
  );
}
