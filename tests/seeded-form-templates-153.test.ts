import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));

import { formTemplates, getFormTemplate, registrationFormDefinitionSchema } from "@/modules/forms/definition";
import { bundledSeededFormTemplates, seededFormTemplateKeys } from "@/modules/forms/seeded-template-data";
import { loadSeededFormTemplate } from "@/modules/forms/seeded-templates";
import fixture from "./fixtures/legacy-form-templates-153.json";

/** The template as JSON with object keys sorted and undefined dropped: the form the legacy fixture hashes. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

describe("seeded form templates (#153)", () => {
  it("lists exactly Women's Retreat, Camp Meeting and Spring Camporee, each with a positive integer version", () => {
    expect([...seededFormTemplateKeys].sort()).toEqual(["camp_meeting_export", "spring_camporee_export", "womens_retreat_export"]);
    expect(new Set(seededFormTemplateKeys).size).toBe(seededFormTemplateKeys.length);
    for (const seed of bundledSeededFormTemplates) {
      expect(Number.isInteger(seed.version) && seed.version >= 1).toBe(true);
      expect(registrationFormDefinitionSchema.safeParse(seed.definition).success).toBe(true);
    }
  });

  it("generates every built-in form template, in the old order, identical to the pre-#153 TypeScript definitions", () => {
    expect(formTemplates.map((template) => template.key)).toEqual(fixture.templates.map((entry) => entry.key));
    for (const legacy of fixture.templates) {
      const current = getFormTemplate(legacy.key)!;
      expect({ key: legacy.key, sha256: digest(current), sections: current.definition.sections.length, fields: current.definition.sections.reduce((n, s) => n + s.fields.length, 0) })
        .toEqual({ key: legacy.key, sha256: legacy.sha256, sections: legacy.sections, fields: legacy.fields });
    }
  });

  it("keeps the seeded forms equivalent on the behavior the form engine reads: conditions, prices, options and defaults", () => {
    const definition = (key: string) => getFormTemplate(key)!.definition;
    const fields = (key: string) => definition(key).sections.flatMap((section) => section.fields);
    expect(fields("womens_retreat_export").some((field) => field.conditional)).toBe(true);
    expect(fields("camp_meeting_export").some((field) => field.conditional)).toBe(true);
    expect(fields("camp_meeting_export").some((field) => field.choicePricesCents || field.priceCents !== undefined)).toBe(true);
    expect(definition("spring_camporee_export").attendeeRoster?.enabled).toBe(true);
    // Fall Camporee is still derived from the seeded Spring Camporee form.
    const springKeys = new Set(fields("spring_camporee_export").map((field) => field.key));
    expect(fields("fall_camporee").filter((field) => field.key === "tents").length).toBe(springKeys.has("tents") ? 1 : 0);
  });

  it("keeps event content out of modules/forms/definition.ts", () => {
    const source = readFileSync(join(process.cwd(), "modules/forms/definition.ts"), "utf8");
    for (const marker of ["Women’s Retreat 2026", "Camp Meeting 2026", "Spring Camporee 2026", "wr26SeminarDescriptions", "campMeetingHousingOptions", 'templateField("wr_', 'templateField("cm_', 'templateField("sc_']) {
      expect(source, marker).not.toContain(marker);
    }
  });

  it("creates new forms from the synced row when there is one, and from the bundled seed when there is not", async () => {
    const bundled = bundledSeededFormTemplates[0]!;
    const missing = { seededFormTemplate: { findUnique: vi.fn().mockResolvedValue(null) } };
    const fromBundle = await loadSeededFormTemplate(missing as never, bundled.key);
    expect(fromBundle).toMatchObject({ key: bundled.key, version: bundled.version, name: bundled.name });
    expect(digest(fromBundle!.definition)).toBe(digest(bundled.definition));

    const revised = structuredClone(bundled.definition);
    revised.title = "Synthetic revised title";
    const stored = { seededFormTemplate: { findUnique: vi.fn().mockResolvedValue({ key: bundled.key, version: bundled.version + 1, name: bundled.name, description: "", audience: bundled.audience, definition: revised }) } };
    const fromRow = await loadSeededFormTemplate(stored as never, bundled.key);
    expect(fromRow).toMatchObject({ version: bundled.version + 1 });
    expect(fromRow!.definition.title).toBe("Synthetic revised title");

    expect(await loadSeededFormTemplate(missing as never, "simple_rsvp")).toBeNull();
    expect(missing.seededFormTemplate.findUnique).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bundled seed, logging only the key, when a stored row fails validation", async () => {
    const bundled = bundledSeededFormTemplates[0]!;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { seededFormTemplate: { findUnique: vi.fn().mockResolvedValue({ key: bundled.key, version: bundled.version + 1, name: "Stored", description: "", audience: bundled.audience, definition: { sections: "synthetic-secret-marker" } }) } };
    const result = await loadSeededFormTemplate(bad as never, bundled.key);
    expect(result).toMatchObject({ key: bundled.key, version: bundled.version, name: bundled.name });
    expect(digest(result!.definition)).toBe(digest(bundled.definition));
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain(bundled.key);
    expect(line).not.toContain("synthetic-secret-marker");
    warn.mockRestore();
  });
});
