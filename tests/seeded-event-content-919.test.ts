import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  createMealDefinitions: vi.fn(),
  writeAuditLog: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/modules/audit/audit-service", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/modules/meals/clone-repository", () => ({ createMealDefinitions: mocks.createMealDefinitions }));

import { CancellationPolicyWorkspace } from "@/components/cancellation-policy-workspace";
import { MealsWorkspace } from "@/components/meals-workspace";
import { parseCancellationRules } from "@/modules/cancellation-policy/rules";
import { cancellationRulesFromPreset, parseSeededEventContent, type SeededEventContent } from "@/modules/event-content/domain";
import { loadEventContent, listCancellationPresetOptions, listMealPresetOptions, syncSeededEventContent } from "@/modules/event-content/repository";
import { bundledEventContent } from "@/modules/event-content/seeded-data";
import { mealDefinitionsFromTemplate, templateMealsSchema } from "@/modules/meals/clone-domain";
import { applyMealPreset } from "@/modules/meals/config-repository";
import { MealError } from "@/modules/meals/errors";
import type { MealView } from "@/modules/meals/view-repository";
import fixture from "./fixtures/legacy-event-content-919.json";

/** The value as JSON with object keys sorted and undefined dropped: the form the legacy fixture hashes. */
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

const mealSeed = bundledEventContent.find((seed) => seed.kind === "MEAL_PRESET")!;
const cancellationSeed = bundledEventContent.find((seed) => seed.kind === "CANCELLATION_PRESET")!;
if (mealSeed.kind !== "MEAL_PRESET" || cancellationSeed.kind !== "CANCELLATION_PRESET") throw new Error("Seed content is missing.");

/** Text as the server renders it into HTML: the characters React escapes. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

describe("seeded event content (#919)", () => {
  it("lists the Camp Meeting meal preset and cancellation rule once each, with positive integer versions", () => {
    expect(bundledEventContent.map((seed) => `${seed.kind}:${seed.key}`).sort()).toEqual(["CANCELLATION_PRESET:camp-meeting-2026", "MEAL_PRESET:camp-meeting-2026"]);
    for (const seed of bundledEventContent) {
      expect(Number.isInteger(seed.version) && seed.version >= 1).toBe(true);
      expect(() => parseSeededEventContent(structuredClone(seed))).not.toThrow();
    }
  });

  it("keeps the Camp Meeting meals identical to the pre-#919 TypeScript definition: services, plans and every price", () => {
    const meals = mealSeed.content.meals;
    expect(digest(meals)).toBe(fixture.meals.sha256);
    expect(meals).toEqual(fixture.meals.meals);
    expect(meals.services).toHaveLength(fixture.meals.services);
    expect(meals.plans.map((plan) => ({ code: plan.code, prices: plan.prices.length }))).toEqual(fixture.meals.plans);
    expect(templateMealsSchema.safeParse(meals).success).toBe(true);
    // The documented 2026 prices, in cents: breakfast $7 / $6, lunch and supper $8 / $7, the same for both plans.
    for (const plan of meals.plans) {
      const price = (mealType: string, ageGroup: string) => plan.prices.find((entry) => entry.mealType === mealType && entry.ageGroup === ageGroup)?.amountCents;
      expect([price("BREAKFAST", "ADULT"), price("BREAKFAST", "CHILD"), price("LUNCH", "ADULT"), price("LUNCH", "CHILD"), price("SUPPER", "ADULT"), price("SUPPER", "CHILD")]).toEqual([700, 600, 800, 700, 800, 700]);
    }
    // Saturday lunch sells no ticket; the dated definitions come out the same for any first day.
    expect(meals.services.find((service) => service.name === "Saturday lunch (donation)")?.ticketing).toBe("DONATION_ONLY");
    expect(mealDefinitionsFromTemplate(meals, "2026-10-13").services.map((service) => `${service.serviceDate} ${service.name}`)).toEqual(
      mealDefinitionsFromTemplate(fixture.meals.meals as never, "2026-10-13").services.map((service) => `${service.serviceDate} ${service.name}`),
    );
  });

  it("keeps the Camp Meeting cancellation rule identical to the pre-#919 preset for each captured deadline, including the $10 fee", () => {
    for (const [deadline, legacy] of Object.entries(fixture.cancellation)) {
      const rules = cancellationRulesFromPreset(cancellationSeed.content, deadline);
      expect(digest(rules)).toBe(legacy.sha256);
      expect(canonical(rules)).toEqual(canonical(legacy.rules));
      expect(JSON.stringify(rules)).not.toContain("{{");
      const parsed = parseCancellationRules(rules);
      expect(parsed.windows[0]).toMatchObject({ id: "before-deadline", endsOn: deadline, terms: { flatWithholdCents: 1000, depositTreatment: "REFUND" } });
      expect(parsed.afterWindows.terms).toMatchObject({ flatWithholdCents: 0, depositTreatment: "FORFEIT" });
      expect(parsed.cardFeeTreatment).toBe("REFUNDABLE");
    }
    expect(cancellationSeed.content.description).toContain("$10 processing fee");
  });

  it("keeps the staff screen words exactly as they were when they were written in the components and repository", () => {
    expect(`Start from ${mealSeed.content.label}`).toBe(fixture.copy.mealsTitle);
    expect(mealSeed.content.description).toBe(fixture.copy.mealsDescription);
    expect(`Add the ${mealSeed.content.label} meals`).toBe(fixture.copy.mealsButton);
    expect(`${mealSeed.content.label} meals added.`).toBe(fixture.copy.mealsNotice);
    expect(`This event already has meal services or plans. The ${mealSeed.content.label} meals can only be added to an event that has none.`).toBe(fixture.copy.mealsConflict);
    expect(`Added the ${mealSeed.content.label} meal services and plans.`).toBe(fixture.copy.mealsAudit);
    expect(`${cancellationSeed.content.label}: deadline date`).toBe(fixture.copy.cancelDeadlineLabel);
    expect(cancellationSeed.content.description).toBe(fixture.copy.cancelDescription);
    expect(`Start from the ${cancellationSeed.content.label}`).toBe(fixture.copy.cancelButton);
  });

  it("shows the seeded words on the Meals and cancellation rules screens, and only to someone who may add the meals", async () => {
    const emptyView = { services: [], plans: [], totals: [], recentOrders: [], attendeeTypes: [], formWarnings: [] } as unknown as MealView;
    const presets = await listMealPresetOptions({ seededEventContent: { findUnique: vi.fn().mockResolvedValue(null) } } as never);
    const render = (canManageFinance: boolean) => renderToStaticMarkup(createElement(MealsWorkspace, { eventId: "evt_synthetic", eventName: "Synthetic Camp", initialView: emptyView, presets, canConfigure: true, canManageFinance, canExport: false }));
    const finance = render(true);
    expect(finance).toContain("Start from Camp Meeting");
    expect(finance).toContain(escaped(fixture.copy.mealsDescription));
    expect(finance).toContain("Add the Camp Meeting meals");
    // Everyone sees the heading and description; staff without finance access get the message instead of the button.
    const noFinance = render(false);
    expect(noFinance).toContain("Start from Camp Meeting");
    expect(noFinance).toContain(escaped(fixture.copy.mealsDescription));
    expect(noFinance).toContain("Only staff who manage finance can add the preset.");
    expect(noFinance).not.toContain("Add the Camp Meeting meals");
    expect(finance).not.toContain("Only staff who manage finance can add the preset.");
    // No preset, nothing shown.
    const none = renderToStaticMarkup(createElement(MealsWorkspace, { eventId: "evt_synthetic", eventName: "Synthetic Camp", initialView: emptyView, presets: [], canConfigure: true, canManageFinance: false, canExport: false }));
    expect(none).not.toContain("Start from");
    expect(none).not.toContain("add the preset");

    const options = await listCancellationPresetOptions({ seededEventContent: { findUnique: vi.fn().mockResolvedValue(null) } } as never);
    const rules = renderToStaticMarkup(createElement(CancellationPolicyWorkspace, { eventId: "evt_synthetic", eventName: "Synthetic Camp", timezone: "America/Chicago", versions: [], inEffectVersionId: null, presets: options }));
    expect(rules).toContain("Camp Meeting rule: deadline date");
    expect(rules).toContain(escaped(fixture.copy.cancelDescription));
    expect(rules).toContain("Start from the Camp Meeting rule");
  });

  it("keeps the old event-named exports out of shared source", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    expect(read("modules/cancellation-policy/rules.ts")).not.toContain("campMeetingPreset");
    expect(read("modules/meals/config-repository.ts")).not.toMatch(/campMeeting|Camp Meeting meals/);
    expect(read("components/meals-workspace.tsx")).not.toContain("Camp Meeting");
    expect(read("components/cancellation-policy-workspace.tsx")).not.toContain("Camp Meeting");
  });
});

describe("event content storage and sync (#919)", () => {
  const stored = (seed: SeededEventContent, extra: Record<string, unknown> = {}) => ({ id: `row-${seed.kind}`, kind: seed.kind, key: seed.key, version: seed.version, name: seed.name, content: seed.content, ...extra });

  /** A client that has only the one table: any read or write of an event, meals, cancellation rules or lodging would throw. */
  function fakeClient(rows: Record<string, ReturnType<typeof stored>>) {
    const table = {
      findUnique: vi.fn(async ({ where }: { where: { kind_key: { kind: string; key: string } } }) => rows[`${where.kind_key.kind}:${where.kind_key.key}`] ?? null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    };
    const tx = { $executeRaw: vi.fn(async () => 1), seededEventContent: table };
    return { table, tx, client: { $transaction: async (run: (tx: unknown) => unknown) => run(tx), seededEventContent: table } };
  }

  it("creates missing rows, leaves a current one alone, updates a lower version, and never goes backwards", async () => {
    const empty = fakeClient({});
    expect(await syncSeededEventContent(empty.client as never)).toMatchObject({ created: [{ kind: "MEAL_PRESET" }, { kind: "CANCELLATION_PRESET" }], updated: [], unchanged: [], ahead: [] });
    expect(empty.table.create).toHaveBeenCalledTimes(2);
    expect(empty.tx.$executeRaw).toHaveBeenCalledTimes(1);

    const current = fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed), [`CANCELLATION_PRESET:${cancellationSeed.key}`]: stored(cancellationSeed) });
    expect(await syncSeededEventContent(current.client as never)).toMatchObject({ created: [], updated: [], unchanged: [{}, {}], ahead: [] });
    expect(current.table.create).not.toHaveBeenCalled();
    expect(current.table.update).not.toHaveBeenCalled();

    const older = fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed, { version: 0 }), [`CANCELLATION_PRESET:${cancellationSeed.key}`]: stored(cancellationSeed, { version: mealSeed.version + 4 }) });
    const result = await syncSeededEventContent(older.client as never);
    expect(result.updated).toEqual([{ kind: "MEAL_PRESET", key: mealSeed.key, from: 0, to: mealSeed.version }]);
    expect(result.ahead).toEqual([{ kind: "CANCELLATION_PRESET", key: cancellationSeed.key, stored: mealSeed.version + 4, code: cancellationSeed.version }]);
    expect(older.table.update).toHaveBeenCalledTimes(1);
  });

  it("refuses a seed the app would refuse before writing anything", async () => {
    const broken = structuredClone(cancellationSeed);
    (broken.content.rules as Record<string, unknown>).windows = "not a list";
    const fake = fakeClient({});
    await expect(syncSeededEventContent(fake.client as never, [broken])).rejects.toThrow();
    expect(fake.table.create).not.toHaveBeenCalled();
  });

  it("pins each bundled (key, version) to a content hash, so changing content without raising its version fails", () => {
    const pinned: Record<string, string> = {
      "MEAL_PRESET:camp-meeting-2026@1": "497eb4bb78f2a2c5b0d1b994d625c552b9801aa96e58b2c3a0a16caef38ab237",
      "CANCELLATION_PRESET:camp-meeting-2026@1": "4a32a922acf6f1b09469ea7b11d0537461ad7778c1b2cf3dd601d5cad08eaf1c",
    };
    const actual = Object.fromEntries(bundledEventContent.map((seed) => [`${seed.kind}:${seed.key}@${seed.version}`, digest({ name: seed.name, content: seed.content })]));
    expect(actual).toEqual(pinned);
  });

  it("prefers the bundled copy over a stale or equal stored row, and a stored row only when it is newer", async () => {
    const stale = structuredClone(mealSeed.content);
    stale.label = "Stale";
    const staleRow = fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed, { version: mealSeed.version, content: stale }) });
    expect(await loadEventContent(staleRow.client as never, "MEAL_PRESET", mealSeed.key)).toEqual(mealSeed);
    const olderRow = fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed, { version: 0, content: stale }) });
    expect(await loadEventContent(olderRow.client as never, "MEAL_PRESET", mealSeed.key)).toEqual(mealSeed);
    const newerRow = fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed, { version: mealSeed.version + 1, content: stale }) });
    expect(await loadEventContent(newerRow.client as never, "MEAL_PRESET", mealSeed.key)).toMatchObject({ version: mealSeed.version + 1, content: { label: "Stale" } });
  });

  it("falls back to the bundled copy when the table does not exist yet (P2021), and rethrows other database errors", async () => {
    const missing = new Prisma.PrismaClientKnownRequestError("table missing", { code: "P2021", clientVersion: "test" });
    const noTable = { seededEventContent: { findUnique: vi.fn().mockRejectedValue(missing) } };
    expect(await loadEventContent(noTable as never, "MEAL_PRESET", mealSeed.key)).toEqual(mealSeed);
    expect((await listMealPresetOptions(noTable as never)).map((option) => option.key)).toEqual([mealSeed.key]);
    const other = { seededEventContent: { findUnique: vi.fn().mockRejectedValue(new Error("connection lost")) } };
    await expect(loadEventContent(other as never, "MEAL_PRESET", mealSeed.key)).rejects.toThrow("connection lost");
  });

  it("reads the stored row when it reads, and the bundled seed when there is none or the row is unreadable", async () => {
    expect(await loadEventContent(fakeClient({}).client as never, "MEAL_PRESET", mealSeed.key)).toEqual(mealSeed);
    expect(await loadEventContent(fakeClient({}).client as never, "MEAL_PRESET", "no-such-preset")).toBeNull();
    const revised = structuredClone(mealSeed.content);
    revised.label = "Synthetic Revised";
    const fromRow = await loadEventContent(fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed, { version: 7, content: revised }) }).client as never, "MEAL_PRESET", mealSeed.key);
    expect(fromRow).toMatchObject({ version: 7, content: { label: "Synthetic Revised" } });
    const unreadable = await loadEventContent(fakeClient({ [`MEAL_PRESET:${mealSeed.key}`]: stored(mealSeed, { content: { nonsense: true } }) }).client as never, "MEAL_PRESET", mealSeed.key);
    expect(unreadable).toEqual(mealSeed);
  });
});

describe("applying the meal preset to an event (#919)", () => {
  beforeEach(() => {
    mocks.createMealDefinitions.mockReset().mockResolvedValue({ services: 13, plans: 2, prices: 12 });
    mocks.writeAuditLog.mockReset();
  });

  function database(options: { existing?: number; stored?: { content: unknown; version: number } | null } = {}) {
    const tx = {
      seededEventContent: { findUnique: vi.fn().mockResolvedValue(options.stored ? { id: "row", kind: "MEAL_PRESET", key: mealSeed.key, name: "Stored", ...options.stored } : null) },
      event: { findUnique: vi.fn().mockResolvedValue({ startsAt: new Date("2026-10-13T14:00:00.000Z"), timezone: "America/Chicago" }) },
      eventMealService: { count: vi.fn().mockResolvedValue(options.existing ?? 0) },
      eventMealPlan: { count: vi.fn().mockResolvedValue(0) },
    };
    mocks.getPrisma.mockReturnValue({ $transaction: async (run: (tx: unknown) => unknown) => run(tx) });
    return tx;
  }

  it("creates the same dated services, plans and prices the pre-#919 preset did, and records the preset key", async () => {
    database();
    await applyMealPreset("evt_synthetic", "user_synthetic", mealSeed.key);
    const [, eventId, definitions, actor] = mocks.createMealDefinitions.mock.calls[0]!;
    expect({ eventId, actor }).toEqual({ eventId: "evt_synthetic", actor: "user_synthetic" });
    expect(definitions).toEqual(mealDefinitionsFromTemplate(fixture.meals.meals as never, "2026-10-13"));
    expect(mocks.writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "MEAL_PRESET_APPLIED", summary: fixture.copy.mealsAudit, metadata: { preset: "camp-meeting-2026", firstDay: "2026-10-13" } });
  });

  it("still refuses an event that already has meals, with the same message, and an unknown preset", async () => {
    database({ existing: 1 });
    await expect(applyMealPreset("evt_synthetic", "user_synthetic", mealSeed.key)).rejects.toMatchObject({ code: "CONFLICT", message: fixture.copy.mealsConflict });
    await expect(applyMealPreset("evt_synthetic", "user_synthetic", "no-such-preset")).rejects.toMatchObject({ code: "INVALID" });
    await expect(applyMealPreset("evt_synthetic", "user_synthetic", "no-such-preset")).rejects.toBeInstanceOf(MealError);
    expect(mocks.createMealDefinitions).not.toHaveBeenCalled();
  });

  it("applies a newer stored version of the preset to events that apply it afterwards", async () => {
    const revised = structuredClone(mealSeed.content);
    revised.meals.plans[0]!.name = "Synthetic revised plan";
    database({ stored: { version: 2, content: revised } });
    await applyMealPreset("evt_synthetic", "user_synthetic", mealSeed.key);
    expect(mocks.createMealDefinitions.mock.calls[0]![2].plans[0].name).toBe("Synthetic revised plan");
  });
});
