import { z } from "zod";

/**
 * Event-owned selections for the grouped operational packets (#155).
 *
 * The packet used to be a fixed Women's Retreat layout. Every section is now a
 * named switch that an event can turn off, and the grouping answer can be pinned
 * to one registration field instead of the automatic church/club/household guess.
 * A missing or unreadable stored value yields the default: every section on and
 * automatic grouping, which is what every event printed before the setting
 * existed, so Women's Retreat output is unchanged.
 */
export const eventPacketSectionKeys = [
  "registrationContacts",
  "attendeeChecklist",
  "assignedSessions",
  "planningTotals",
  "coverNotes",
  /** Compatibility: the bespoke shirt-size column. Retired once merchandise sizes (#148) own it. */
  "shirtSize",
] as const;

export type EventPacketSectionKey = (typeof eventPacketSectionKeys)[number];

export type EventPacketConfig = {
  /** Registration field key that groups the packets; null keeps the automatic choice. */
  groupingFieldKey: string | null;
  sections: Record<EventPacketSectionKey, boolean>;
};

export const defaultEventPacketConfig: EventPacketConfig = {
  groupingFieldKey: null,
  sections: {
    registrationContacts: true,
    attendeeChecklist: true,
    assignedSessions: true,
    planningTotals: true,
    coverNotes: true,
    shirtSize: true,
  },
};

const storedSchema = z.object({
  groupingFieldKey: z.string().trim().min(1).max(120).nullish(),
  sections: z.partialRecord(z.enum(eventPacketSectionKeys), z.boolean()).optional(),
});

export function parseEventPacketConfig(value: unknown): EventPacketConfig {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) return defaultEventPacketConfig;
  return {
    groupingFieldKey: parsed.data.groupingFieldKey ?? null,
    sections: { ...defaultEventPacketConfig.sections, ...parsed.data.sections },
  };
}
