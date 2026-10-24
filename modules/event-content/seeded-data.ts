import { parseSeededEventContent, type SeededEventContent } from "@/modules/event-content/domain";
import campMeetingCancellation from "../../prisma/seed-data/event-content/camp-meeting-cancellation.json";
import campMeetingMeals from "../../prisma/seed-data/event-content/camp-meeting-meals.json";

/**
 * Seeded event content files (#919), validated on load. This module only lists the files and holds no event content
 * itself. Raise a file's `version` to ship a revision; `npm run event-content:sync` stores it when it is newer than the
 * stored one. Events that already applied an earlier version keep what they were given.
 */
export const bundledEventContent: readonly SeededEventContent[] = [
  campMeetingMeals,
  campMeetingCancellation,
].map((file) => parseSeededEventContent(file));
