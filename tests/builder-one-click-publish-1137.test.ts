import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { publishBlockedReasonFor } from "@/components/registration-builder/use-builder-derived";
import { runPublishFlow } from "@/components/registration-builder/publish-flow";
import type { RegistrationFormDefinition } from "@/modules/forms/definition";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const definition = { title: "Synthetic form", description: "", sections: [] } as unknown as RegistrationFormDefinition;
const form = (version: number) => ({ id: "form-1", activeVersion: { id: `v${version}`, versionNumber: version } });
const json = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as Response;

describe("one-click publish (#1137)", () => {
  it("blocks unsaved changes before a first publish, and allows them after one", () => {
    expect(publishBlockedReasonFor({ dirty: true, hasEverPublished: false, hasValidTest: true })).toBe("Save your changes as a draft before publishing.");
    expect(publishBlockedReasonFor({ dirty: true, hasEverPublished: true, hasValidTest: false })).toBe("");
    expect(publishBlockedReasonFor({ dirty: false, hasEverPublished: true, hasValidTest: false })).toBe("");
  });

  it("still requires a valid test before a first publish", () => {
    expect(publishBlockedReasonFor({ dirty: false, hasEverPublished: false, hasValidTest: false })).toMatch(/Run a test submission first/);
    expect(publishBlockedReasonFor({ dirty: false, hasEverPublished: false, hasValidTest: true })).toBe("");
  });

  it("saves with PATCH and expectedUpdatedAt, then publishes with POST, in that order", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(true, { form: form(2) }))
      .mockResolvedValueOnce(json(true, { form: form(2) }));
    const result = await runPublishFlow({ eventId: "e1", formId: "form-1", saveFirst: true, definition, expectedUpdatedAt: "2028-01-01T00:00:00.000Z", fetchImpl: fetchImpl as never });
    expect(result.ok).toBe(true);
    expect(fetchImpl.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ["/api/events/e1/forms/form-1", "PATCH"],
      ["/api/events/e1/forms/form-1/publish", "POST"],
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).expectedUpdatedAt).toBe("2028-01-01T00:00:00.000Z");
  });

  it("only publishes when there is nothing to save", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(true, { form: form(1) }));
    await runPublishFlow({ eventId: "e1", formId: "form-1", saveFirst: false, definition, expectedUpdatedAt: "x", fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
  });

  it("does not publish when the save fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(false, { message: "This draft changed elsewhere." }));
    const result = await runPublishFlow({ eventId: "e1", formId: "form-1", saveFirst: true, definition, expectedUpdatedAt: "x", fetchImpl: fetchImpl as never });
    expect(result).toEqual({ ok: false, stage: "save", message: "This draft changed elsewhere." });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports the saved draft when publishing fails after a good save", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(true, { form: form(2) }))
      .mockResolvedValueOnce(json(false, { message: "Publish refused." }));
    const result = await runPublishFlow({ eventId: "e1", formId: "form-1", saveFirst: true, definition, expectedUpdatedAt: "x", fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ ok: false, stage: "publish", message: "Publish refused.", savedForm: form(2) });
  });

  it("wires the shell, button, hint and dialog to the new rules", () => {
    const shell = read("components/registration-builder/builder-editor-shell.tsx");
    expect(shell).toContain('<BuilderPublishButton className="fb-btn primary" />');
    expect(shell).toContain('<BuilderSaveDraftButton className="fb-btn outline" />');
    const bar = read("components/registration-builder/builder-top-bar.tsx");
    expect(bar).toContain("Publish changes");
    expect(bar).toContain("canEdit && editsCreateDraft && dirty");
    expect(bar).toContain('dirty && !hasEverPublished && <p className="builder-gate">');
    expect(read("components/registration-builder/builder-dialogs.tsx")).toContain("Your unsaved changes will be saved");
  });
});
