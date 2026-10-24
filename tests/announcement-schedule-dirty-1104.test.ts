import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  announcementDiscardPrompt,
  announcementDraftBaseline,
  announcementDraftIsDirty,
  blankAnnouncementValues,
  editorCloseDecision,
  scheduleDiscardPrompt,
  scheduleEditorIsDirty,
  scheduleEditorSnapshot,
  type ScheduleEditorFields,
} from "@/components/announcement-draft-dirty";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("announcement composer dirty tracking (#1104)", () => {
  it("a new blank draft is clean until text, priority or attachments change", () => {
    const baseline = announcementDraftBaseline(blankAnnouncementValues, []);
    expect(announcementDraftIsDirty(baseline, blankAnnouncementValues, [])).toBe(false);
    expect(announcementDraftIsDirty(baseline, { ...blankAnnouncementValues, title: "Sample" }, [])).toBe(true);
    expect(announcementDraftIsDirty(baseline, { ...blankAnnouncementValues, body: "x" }, [])).toBe(true);
    expect(announcementDraftIsDirty(baseline, { ...blankAnnouncementValues, priority: "URGENT" }, [])).toBe(true);
    expect(announcementDraftIsDirty(baseline, blankAnnouncementValues, ["file-1"])).toBe(true);
    expect(announcementDraftIsDirty(null, { ...blankAnnouncementValues, title: "Sample" }, [])).toBe(false);
  });

  it("an edit of a saved draft or a correction is measured from its loaded values and attachments", () => {
    const loaded = { title: "Sample title", body: "Sample body text", priority: "IMPORTANT" };
    const baseline = announcementDraftBaseline(loaded, ["a", "b"]);
    expect(announcementDraftIsDirty(baseline, loaded, ["a", "b"])).toBe(false);
    expect(announcementDraftIsDirty(baseline, loaded, ["a"])).toBe(true);
    expect(announcementDraftIsDirty(baseline, loaded, ["a", "b", "c"])).toBe(true);
    expect(announcementDraftIsDirty(baseline, { ...loaded, body: "Changed" }, ["a", "b"])).toBe(true);
    expect(announcementDraftIsDirty(baseline, { ...loaded, title: "Sample title" }, ["a", "b"])).toBe(false);
  });

  it("decides one way for every dismissal path", () => {
    expect(editorCloseDecision({ saving: false, reviewing: false, dirty: false })).toBe("close");
    expect(editorCloseDecision({ saving: false, reviewing: false, dirty: true })).toBe("confirm");
    expect(editorCloseDecision({ saving: true, reviewing: false, dirty: true })).toBe("ignore");
    expect(editorCloseDecision({ saving: false, reviewing: true, dirty: true })).toBe("ignore");
  });

  it("offers Keep editing or Discard changes and says nothing is published, approved or sent", () => {
    for (const prompt of [announcementDiscardPrompt, scheduleDiscardPrompt]) {
      expect(prompt.confirmLabel).toBe("Discard changes");
      expect(prompt.cancelLabel).toBe("Keep editing");
      expect(prompt.destructive).toBe(true);
    }
    expect(announcementDiscardPrompt.body).toMatch(/Nothing is published or sent/);
    expect(scheduleDiscardPrompt.body).toMatch(/Nothing is approved or sent/);
  });

  it("routes Close, Cancel, Escape and the backdrop through one request, keeps field names, and never publishes on save", () => {
    const source = read("components/communications-workspace.tsx");
    expect(source).toMatch(/useAccessibleDialog<HTMLElement>\(draftOpen,\s*\(\) => \{ void requestDraftClose\(\); \}\)/);
    expect(source).toContain("if (event.target === event.currentTarget) void requestDraftClose();");
    expect(source).toContain('aria-label="Close dialog"');
    expect(source.match(/void requestDraftClose\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).not.toContain("setDraftOpen(false); setDraftPrefill(null);");
    for (const name of ['name="title"', 'name="body"', 'name="priority"']) expect(source).toContain(name);
    // A failed save leaves the dialog open: only success calls closeDraftEditor().
    const create = source.slice(source.indexOf("async function createDraft"), source.indexOf("function startDraftEdit"));
    expect(create).toContain("closeDraftEditor()");
    expect(create.indexOf("closeDraftEditor()")).toBeLessThan(create.indexOf("catch (caught)"));
    expect(create).not.toMatch(/method: "PATCH"|\/broadcast/);
  });
});

const fields: ScheduleEditorFields = {
  name: "Sample reminder",
  templateKey: "BALANCE_REMINDER",
  announcementTitle: "",
  announcementBody: "",
  trigger: "ONE_TIME",
  localDate: "2026-12-01",
  localTime: "09:00",
  daysBefore: "7",
  roles: ["REGISTRATION_CONTACT", "ATTENDEE"],
  search: "",
};

describe("schedule editor dirty tracking (#1104)", () => {
  it("is clean when unchanged, ignoring role order, and clean when there is no editor", () => {
    const baseline = scheduleEditorSnapshot(fields);
    expect(scheduleEditorIsDirty(baseline, fields)).toBe(false);
    expect(scheduleEditorIsDirty(baseline, { ...fields, roles: ["ATTENDEE", "REGISTRATION_CONTACT"] })).toBe(false);
    expect(scheduleEditorIsDirty(null, { ...fields, name: "Typed" })).toBe(false);
  });

  it("is dirty after any field change", () => {
    const baseline = scheduleEditorSnapshot(fields);
    const changes: Array<Partial<ScheduleEditorFields>> = [
      { name: "Other" },
      { templateKey: "EVENT_ANNOUNCEMENT" },
      { announcementTitle: "Title" },
      { announcementBody: "Body" },
      { trigger: "BEFORE_PAYMENT_DUE" },
      { localDate: "2026-12-02" },
      { localTime: "10:00" },
      { daysBefore: "3" },
      { roles: ["ATTENDEE"] },
      { search: "status=CONFIRMED" },
    ];
    for (const change of changes) expect(scheduleEditorIsDirty(baseline, { ...fields, ...change })).toBe(true);
  });

  it("every way of leaving the editor asks first, and saving only saves", () => {
    const source = read("components/scheduled-emails-workspace.tsx");
    for (const fn of ["async function openNew", "async function edit(", "async function cancelEditor", "async function openApproval"]) {
      const start = source.indexOf(fn);
      expect(start).toBeGreaterThan(-1);
      expect(source.slice(start, start + 220)).toContain("confirmLeaveEditor()");
    }
    expect(source).toContain("{confirmDialog}");
    expect(source).toContain("useUnsavedChangesGuard(dirty");
    const save = source.slice(source.indexOf("async function save()"), source.indexOf("async function openApproval"));
    expect(save).not.toContain('action: "activate"');
    expect(save.indexOf("if (!result?.schedule) return;")).toBeLessThan(save.indexOf("loadEditor(null)"));
  });
});

describe("review follow-ups (#1104)", () => {
  it("returns focus to the New schedule button after Cancel and after a successful save", () => {
    const source = read("components/scheduled-emails-workspace.tsx");
    expect(source).toContain("ref={newScheduleRef}");
    expect(source).toContain("window.requestAnimationFrame(() => newScheduleRef.current?.focus())");
    const cancel = source.slice(source.indexOf("async function cancelEditor"), source.indexOf("function change<"));
    expect(cancel).toContain("focusNewSchedule()");
    const save = source.slice(source.indexOf("async function save()"), source.indexOf("async function openApproval"));
    expect(save.indexOf("focusNewSchedule()")).toBeGreaterThan(save.indexOf("loadEditor(null)"));
    expect(save).toContain("setNotice(");
    expect(source).toMatch(/role="status"/);
  });

  it("shows a failed announcement save once: the page-level alert hides while the dialog is open", () => {
    const source = read("components/communications-workspace.tsx");
    expect(source).toContain("{error && !draftOpen && <div");
    const close = source.slice(source.indexOf("function closeDraftEditor"), source.indexOf("/** Opens the composer"));
    expect(close).toContain('setError("")');
    expect(close).toContain("setDraftUploading(false)");
  });

  it("treats a running upload as unsaved work, holds Save, and drops a late upload after close", () => {
    const workspace = read("components/communications-workspace.tsx");
    expect(workspace).toMatch(/draftOpen && \(draftUploading \|\| announcementDraftIsDirty\(/);
    expect(workspace).toContain("onUploadingChange={setDraftUploading}");
    expect(workspace).toContain("disabled={saving || draftUploading}");
    expect(workspace).toContain("if (draftUploading) return;");
    const field = read("components/message-attachments-field.tsx");
    expect(field).toContain("onUploadingChange");
    expect(field).toContain("if (!mountedRef.current) return;");
    expect(field.indexOf("if (!mountedRef.current) return;")).toBeLessThan(field.indexOf("onChange(next)"));
  });

  it("reads the input value before the state updater runs", () => {
    const source = read("components/communications-workspace.tsx");
    expect(source).toContain('onChange={(event) => setDraftField("title", event.target.value)}');
    expect(source).not.toMatch(/setDraftValues\(\(current\) => \(\{ \.\.\.current, (title|body|priority): event/);
  });
});
