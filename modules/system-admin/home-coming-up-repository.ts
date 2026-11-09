import "server-only";

import { logError } from "@/lib/logger";
import type { AdminRole } from "@/modules/access/admin-roles-domain";
import { listEventsForUser } from "@/modules/events/repository";
import { buildComingUp, comingUpNextStep, type ComingUpEvent } from "@/modules/system-admin/home-needs-model";

/**
 * The Coming up list for one person (#1568), shared by the Coming up page and the Needs you page (#1747), which shows it
 * when nothing needs them. The events are the ones the shell builds for the viewer; `null` is "could not be read".
 */
export async function loadComingUp(
  user: { id: string; globalRole?: string | null },
  held: () => Promise<readonly AdminRole[]>,
): Promise<{ events: ComingUpEvent[] | null; nextStep: { href: string; label: string } | null }> {
  const isSystemAdmin = user.globalRole === "SYSTEM_ADMIN";
  let events: ComingUpEvent[] | null;
  try {
    events = buildComingUp(await listEventsForUser(user.id, isSystemAdmin), new Date());
  } catch (error) {
    logError("Home coming-up events could not load", error);
    events = null;
  }
  const nextStep = events?.length === 0 ? comingUpNextStep(await held(), isSystemAdmin) : null;
  return { events, nextStep };
}
