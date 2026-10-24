"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileUp, Paperclip, Trash2 } from "lucide-react";
import {
  attachmentSetIssue,
  formatFileSize,
  MAX_MESSAGE_ATTACHMENT_COUNT,
  MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES,
  MAX_MESSAGE_FILE_BYTES,
  MESSAGE_FILE_ACCEPT,
  MESSAGE_FILE_TYPES,
  messageFileUrl,
  type MessageFileRecord,
} from "@/modules/communications/message-file-rules";

type MessageAttachmentsFieldProps = {
  eventId: string;
  files: readonly MessageFileRecord[];
  onChange: (files: MessageFileRecord[]) => void;
  /** Explains what carries these files, in the field's own help line. */
  help: string;
  disabled?: boolean;
  /** Tells the form an upload is running, so it can count as unsaved work and hold Save (#1104). */
  onUploadingChange?: (uploading: boolean) => void;
  /**
   * Opt in when the files live in the form's own state: an upload that finishes after the field unmounted is then
   * dropped instead of writing into an editor that has closed (#1104). The template editor keeps workspace-level
   * state, so it leaves this off and a late upload still lands there.
   */
  dropLateUploads?: boolean;
};

function typeLabel(contentType: string) {
  return (MESSAGE_FILE_TYPES as Record<string, { label: string } | undefined>)[contentType]?.label ?? "File";
}

/**
 * The files staff attach to a template version or an announcement (#824): PDF, images, and Word, Excel and
 * PowerPoint files, each up to 10 MB and 20 MB together. Files upload as they are chosen and are stored privately;
 * what the field holds is the list that the form saves with the message. Removing a file here removes it from this
 * message only.
 */
export function MessageAttachmentsField({ eventId, files, onChange, help, disabled = false, onUploadingChange, dropLateUploads = false }: MessageAttachmentsFieldProps) {
  const inputId = useId();
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  // A late upload must not write into an editor that has since closed (#1104).
  const mountedRef = useRef(true);
  const uploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    uploadingChangeRef.current = onUploadingChange;
  }, [onUploadingChange]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadingChangeRef.current?.(false);
    };
  }, []);
  useEffect(() => {
    uploadingChangeRef.current?.(uploading);
  }, [uploading]);
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  async function addFiles(chosen: File[]) {
    setError("");
    if (chosen.length === 0) return;
    setUploading(true);
    let next = [...files];
    try {
      for (const file of chosen) {
        if (file.size > MAX_MESSAGE_FILE_BYTES) {
          throw new Error(`${file.name} is over ${formatFileSize(MAX_MESSAGE_FILE_BYTES)}. Each attachment must be ${formatFileSize(MAX_MESSAGE_FILE_BYTES)} or smaller.`);
        }
        const issue = attachmentSetIssue([...next, { sizeBytes: file.size }]);
        if (issue) throw new Error(issue.message);
        const form = new FormData();
        form.set("file", file);
        form.set("purpose", "attachment");
        const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/message-files`, {
          method: "POST",
          body: form,
        });
        const result = await response.json().catch(() => ({})) as { file?: MessageFileRecord; message?: string };
        if (!response.ok || !result.file) throw new Error(result.message ?? `${file.name} could not be uploaded.`);
        if (dropLateUploads && !mountedRef.current) return;
        next = [...next, result.file];
        onChange(next);
      }
    } catch (caught) {
      if (!dropLateUploads || mountedRef.current) setError(caught instanceof Error ? caught.message : "The file could not be uploaded.");
    } finally {
      if (!dropLateUploads || mountedRef.current) setUploading(false);
    }
  }

  return (
    <div className="message-attachments-field">
      <div className="message-attachments-head">
        <strong id={`${inputId}-label`}><Paperclip size={15} aria-hidden="true" /> Attachments</strong>
        <small>
          {files.length} of {MAX_MESSAGE_ATTACHMENT_COUNT} files · {formatFileSize(total)} of {formatFileSize(MAX_MESSAGE_ATTACHMENTS_TOTAL_BYTES)}
        </small>
      </div>
      {files.length > 0 ? (
        <ul aria-labelledby={`${inputId}-label`}>
          {files.map((file) => (
            <li key={file.id}>
              <a href={messageFileUrl(eventId, file.id)} target="_blank" rel="noopener noreferrer">{file.filename}</a>
              <small>{typeLabel(file.contentType)} · {formatFileSize(file.sizeBytes)}</small>
              <button
                type="button"
                className="icon-button"
                disabled={disabled || uploading}
                aria-label={`Remove ${file.filename}`}
                onClick={() => onChange(files.filter((candidate) => candidate.id !== file.id))}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet-copy">No files attached.</p>
      )}
      <label className="secondary-button file-button" htmlFor={inputId}>
        <FileUp aria-hidden="true" size={16} /> {uploading ? "Uploading…" : "Choose files to attach"}
        <input
          id={inputId}
          className="sr-only"
          aria-describedby={`${inputId}-help`}
          type="file"
          multiple
          accept={MESSAGE_FILE_ACCEPT}
          disabled={disabled || uploading || files.length >= MAX_MESSAGE_ATTACHMENT_COUNT}
          onChange={(event) => {
            const input = event.currentTarget;
            const chosen = [...(input.files ?? [])];
            input.value = "";
            void addFiles(chosen);
          }}
        />
      </label>
      <small id={`${inputId}-help`}>
        PDF, PNG, JPEG, WebP, Word, Excel or PowerPoint. Each file up to {formatFileSize(MAX_MESSAGE_FILE_BYTES)}. {help}
      </small>
      {uploading ? <p role="status">Uploading…</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
