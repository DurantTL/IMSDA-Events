import { describe, expect, it, vi } from "vitest";
import { createDefaultPaletteRegistry } from "@/components/registration-builder/palette-registry";
import { filterPaletteRegistry, informationEntryAllowed } from "@/components/registration-builder/information-palette";
import {
  eventInformationConfig, generalInformationConfig, informationApiBase, informationFieldTypeAllowed, informationFormToView, informationIssuesFromResponse,
  informationPublicPath, informationResponsesHref, isoToLocalInput, localInputToIso, matchedSensitiveWord, runInformationPublishFlow,
  type InformationFormApi,
} from "@/components/registration-builder/information-mode";
import { deriveFieldChips } from "@/components/registration-builder/field-chips";
import { blankInformationFormDefinition } from "@/modules/information-forms/definition";
import { isInformationTemplateAudience } from "@/modules/forms/information-audience";
import { templatesForPicker } from "@/modules/forms/definition";
import { staffSubpageTitle } from "@/components/staff-navigation";

const event = { id: "evt_1", slug: "synthetic-camp", name: "Synthetic Camp" };

function apiForm(overrides: Partial<InformationFormApi> = {}): InformationFormApi {
  const definition = blankInformationFormDefinition("Synthetic survey");
  return {
    id: "form_1", name: "Synthetic survey", slug: "synthetic-survey", status: "DRAFT", fillAccess: "ANYONE_WITH_LINK", opensAt: null, closesAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    versions: [
      { id: "v1", versionNumber: 1, status: "SUPERSEDED", definition, publishedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "v2", versionNumber: 2, status: "DRAFT", definition, publishedAt: null, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("information mode addresses (#1149)", () => {
  it("points at the information-forms APIs and public paths for each scope", () => {
    expect(informationApiBase(generalInformationConfig())).toBe("/api/admin/information-forms");
    expect(informationApiBase(eventInformationConfig(event))).toBe("/api/events/evt_1/information-forms");
    expect(informationPublicPath(generalInformationConfig(), "s")).toBe("/forms/s");
    expect(informationPublicPath(eventInformationConfig(event), "s")).toBe("/events/synthetic-camp/forms/s");
    expect(informationResponsesHref(generalInformationConfig(), "f1")).toBe("/admin/information-forms/f1/responses");
    expect(informationResponsesHref(eventInformationConfig(event), "f1")).toBe("/information-forms/responses?event=evt_1&form=f1");
  });

  it("titles the editor and responses pages", () => {
    expect(staffSubpageTitle("/admin/information-forms")).toBe("Information forms");
    expect(staffSubpageTitle("/admin/information-forms/f1")).toBe("Information form");
    expect(staffSubpageTitle("/admin/information-forms/f1/responses")).toBe("Information form responses");
    expect(staffSubpageTitle("/information-forms")).toBe("Information forms");
    expect(staffSubpageTitle("/information-forms/responses")).toBe("Information form responses");
  });
});

describe("the adapter", () => {
  it("opens the draft, maps superseded to archived and carries the settings", () => {
    const view = informationFormToView(apiForm({ fillAccess: "SIGNED_IN", opensAt: new Date("2026-02-01T10:00:00Z") }));
    expect(view.activeVersion.id).toBe("v2");
    expect(view.versions.map((version) => [version.versionNumber, version.status])).toEqual([[2, "DRAFT"], [1, "ARCHIVED"]]);
    expect(view.eventId).toBe("");
    expect(view.information).toEqual({ status: "DRAFT", fillAccess: "SIGNED_IN", opensAt: "2026-02-01T10:00:00.000Z", closesAt: null });
    expect(view.activeVersion.testSubmissions).toEqual([]);
  });

  it("converts open and close times", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not a date")).toBeUndefined();
    const iso = localInputToIso("2026-03-04T09:30");
    expect(iso).toMatch(/Z$/);
    expect(isoToLocalInput(iso as string)).toBe("2026-03-04T09:30");
    expect(isoToLocalInput(null)).toBe("");
  });
});

describe("the palette in information mode", () => {
  const registry = createDefaultPaletteRegistry();
  const shown = filterPaletteRegistry(registry).getSnapshot().entries.map((entry) => entry.id);

  it("keeps plain questions and drops payment, roster, meal and attendee-type entries", () => {
    expect(shown).toContain("type:TEXT");
    expect(shown).toContain("type:RADIO");
    expect(shown).not.toContain("type:CALCULATED");
    expect(shown).not.toContain("money:priced-checkbox");
    expect(shown.some((id) => id.startsWith("module:") && /roster|meal|lodging|payment|attendee/.test(id))).toBe(false);
    expect(shown.length).toBeLessThan(registry.getSnapshot().entries.length);
  });

  it("follows the entry flag, so a new module needs no second list", () => {
    const entry = registry.getSnapshot().entries.find((candidate) => candidate.id === "type:TEXT")!;
    expect(informationEntryAllowed({ ...entry, informationForm: false })).toBe(false);
    const priced = registry.getSnapshot().entries.find((candidate) => candidate.id === "type:CALCULATED")!;
    expect(informationEntryAllowed({ ...priced, informationForm: true })).toBe(true);
  });

  it("refuses the automatic fee type", () => {
    expect(informationFieldTypeAllowed("CALCULATED")).toBe(false);
    expect(informationFieldTypeAllowed("TEXT")).toBe(true);
  });
});

describe("chips", () => {
  it("shows no price, scope or capacity chips", () => {
    const field = { id: "f", key: "k", label: "Q", helpText: "", type: "TEXT" as const, scope: "REGISTRATION" as const, required: true, options: [] };
    expect(deriveFieldChips(field, "", { information: true }).map((chip) => chip.label)).toEqual(["Required"]);
  });
});

describe("the server's refusal beside the offending part", () => {
  const definition = blankInformationFormDefinition("Synthetic survey");
  it("lands a field issue on the field and names the matched word", () => {
    const bad = { ...definition, sections: [{ ...definition.sections[0]!, fields: [{ ...definition.sections[0]!.fields[0]!, label: "Parents phone" }] }] };
    const issues = informationIssuesFromResponse({ issues: [{ path: ["sections", 0, "fields", 0], message: "The field is not allowed: information forms cannot collect health, medical or other sensitive answers." }] }, bad);
    const message = issues.fields[bad.sections[0]!.fields[0]!.id]![0]!;
    expect(message).toContain("not allowed");
    expect(message).toContain('"Parents"');
  });

  it("lands a section issue on the section and a description issue on the form", () => {
    const issues = informationIssuesFromResponse({ issues: [
      { path: ["sections", 0], message: "The section is not allowed: sensitive." },
      { path: ["description"], message: "The form description is not allowed: sensitive." },
    ] }, definition);
    expect(issues.sections[definition.sections[0]!.id]).toHaveLength(1);
    expect(issues.form).toHaveLength(1);
  });

  it("falls back to the server message", () => {
    expect(informationIssuesFromResponse({ message: "Nope." }, definition).form).toEqual(["Nope."]);
    expect(matchedSensitiveWord("How were the road conditions?")).toBe("conditions");
  });
});

describe("save then publish", () => {
  const config = generalInformationConfig();
  const definition = blankInformationFormDefinition("Synthetic survey");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("saves first, then publishes, against the information-forms API only", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ form: apiForm() }))
      .mockResolvedValueOnce(json({ form: apiForm({ status: "DRAFT" }) }));
    const result = await runInformationPublishFlow({ config, formId: "form_1", saveFirst: true, definition, expectedUpdatedAt: "2026-01-02T00:00:00.000Z", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    const calls = fetchImpl.mock.calls.map((call) => [call[0], call[1]?.method]);
    expect(calls).toEqual([["/api/admin/information-forms/form_1", "PATCH"], ["/api/admin/information-forms/form_1/publish", "POST"]]);
  });

  it("publishes nothing when the save is refused", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ message: "refused", issues: [] }, 400));
    const result = await runInformationPublishFlow({ config, formId: "form_1", saveFirst: true, definition, expectedUpdatedAt: "x", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, stage: "save", message: "refused" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("information templates", () => {
  it("recognises the audience and keeps them out of the registration picker", () => {
    expect(isInformationTemplateAudience(" information ")).toBe(true);
    expect(isInformationTemplateAudience("Individual")).toBe(false);
    const picked = templatesForPicker([{ key: "a", name: "A", audience: "Information" }, { key: "b", name: "B", audience: "Individual" }], null);
    expect(picked.map((template) => template.key)).toEqual(["b"]);
  });
});
