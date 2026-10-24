import { z } from "zod";
import { cancellationRulesSchema, type CancellationRulesInput } from "@/modules/cancellation-policy/rules";
import { templateMealsSchema } from "@/modules/meals/clone-domain";

/**
 * Seeded event content (#919): starting points for an event's settings whose values are data, not source. Each is a
 * versioned seed file under `prisma/seed-data/event-content/`, stored in `SeededEventContent` by
 * `npm run event-content:sync`. Pure shapes only: no database, no clock, nothing here is applied to an event. A person
 * chooses a preset on the event's own screen, and applying it copies the values; the stored content is never read by
 * an event afterwards, so a new version reaches only events that apply it later.
 */
export const eventContentKinds = ["MEAL_PRESET", "CANCELLATION_PRESET"] as const;
export type EventContentKind = (typeof eventContentKinds)[number];

/** A meal preset: services, plans and prices as definitions (dated by day offsets), and the words the Meals screen shows. */
export const mealPresetContentSchema = z.object({
  /** The event's short name in the screen's sentences: "Start from Camp Meeting", "Add the Camp Meeting meals". */
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
  meals: templateMealsSchema,
}).strict();
export type MealPresetContent = z.infer<typeof mealPresetContentSchema>;

/** The placeholder a cancellation preset's rules use for the last day of the first window. */
export const DEADLINE_PLACEHOLDER = "{{deadline}}";

/** Replaces every string equal to the deadline placeholder, however deep. Everything else is returned unchanged. */
function withDeadline(value: unknown, deadlineDate: string): unknown {
  if (value === DEADLINE_PLACEHOLDER) return deadlineDate;
  if (Array.isArray(value)) return value.map((entry) => withDeadline(entry, deadlineDate));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, withDeadline(entry, deadlineDate)]));
  }
  return value;
}

/** A cancellation preset: a rules template with a deadline placeholder, and the words the rules screen shows. */
export const cancellationPresetContentSchema = z.object({
  /** The rule's name in the screen: "Camp Meeting rule: deadline date", "Start from the Camp Meeting rule". */
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
  rules: z.record(z.string(), z.unknown()),
}).strict().superRefine((content, context) => {
  const parsed = cancellationRulesSchema.safeParse(withDeadline(content.rules, "2026-01-01"));
  if (!parsed.success) context.addIssue({ code: "custom", path: ["rules"], message: parsed.error.issues[0]?.message ?? "These are not valid cancellation rules." });
});
export type CancellationPresetContent = z.infer<typeof cancellationPresetContentSchema>;

/** The preset's rules for a deadline, as the draft the staff screen starts from. A human reviews and saves it. */
export function cancellationRulesFromPreset(content: CancellationPresetContent, deadlineDate: string): CancellationRulesInput {
  return withDeadline(content.rules, deadlineDate) as CancellationRulesInput;
}

export const eventContentSchemas = {
  MEAL_PRESET: mealPresetContentSchema,
  CANCELLATION_PRESET: cancellationPresetContentSchema,
} as const;

type ContentByKind = { MEAL_PRESET: MealPresetContent; CANCELLATION_PRESET: CancellationPresetContent };

export type SeededEventContent<K extends EventContentKind = EventContentKind> = {
  [Kind in K]: { key: string; kind: Kind; version: number; name: string; content: ContentByKind[Kind] };
}[K];

/** A seed file's own shape: a key, a known kind, a positive integer version, a name, and content that fits the kind. */
export function parseSeededEventContent(value: unknown): SeededEventContent {
  const head = z.object({
    key: z.string().trim().min(1).max(80),
    kind: z.enum(eventContentKinds),
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(200),
    content: z.unknown(),
  }).strict().parse(value);
  return { ...head, content: eventContentSchemas[head.kind].parse(head.content) } as SeededEventContent;
}

/** What the Meals and cancellation rules pages show for one preset. Plain data, safe to hand to a client component. */
export type MealPresetOption = { key: string; label: string; description: string };
export type CancellationPresetOption = { key: string; label: string; description: string; content: CancellationPresetContent };
