import "server-only";

import { addDays, buildCalendarIcs } from "@/modules/calendar/domain";
import { conferenceToday, listPublicCalendarItems } from "@/modules/calendar/repository";
import { siteBaseUrl } from "@/modules/calendar/subscribe";
import { REACHABILITY_TIMEOUT_MS, type ReachabilityResult } from "@/modules/operations/reachability";

/** The public calendar as iCalendar text: the last two months and the next eighteen. Shared by the feed route and its test. */
export async function buildPublicCalendarFeedBody() {
  const now = new Date();
  const today = conferenceToday(now);
  const items = await listPublicCalendarItems(addDays(today, -60), addDays(today, 548), now, { expandRepeats: false });
  return buildCalendarIcs(items, { baseUrl: siteBaseUrl(), now });
}

/**
 * A READ-ONLY test that our own calendar feed builds (#1380): the feed is built in-process, no network, and the text is
 * checked for its calendar start and end and then dropped. Always set up. One of four fixed words; a build error or
 * more than the time limit reads unavailable.
 */
export async function checkCalendarFeedReachable(
  options: { build?: () => Promise<string>; timeoutMs?: number } = {},
): Promise<ReachabilityResult> {
  const started = Date.now();
  const done = (outcome: "reachable" | "unavailable"): ReachabilityResult => ({ outcome, ms: Date.now() - started });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([
      (options.build ?? buildPublicCalendarFeedBody)(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), options.timeoutMs ?? REACHABILITY_TIMEOUT_MS);
      }),
    ]);
    const text = typeof body === "string" ? body.trim() : "";
    return done(text.startsWith("BEGIN:VCALENDAR") && text.endsWith("END:VCALENDAR") ? "reachable" : "unavailable");
  } catch {
    return done("unavailable");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
