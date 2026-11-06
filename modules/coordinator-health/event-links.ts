import "server-only";

import { resolveAreaHealthViewer } from "@/modules/coordinator-health/access";
import { listHealthEvents } from "@/modules/coordinator-health/repository";

/**
 * Event ids that get a "Health information" link on Club coordination (#1618).
 * It asks the same two things `/account/area/health` asks, with the same
 * helpers: an active Area Coordinator with a verified second step
 * (`resolveAreaHealthViewer`), and the events that page would list (`listHealthEvents`:
 * the viewer's scope and the health window, open through the event's last day).
 * Names and dates only; it opens no health data and writes no audit row. Staff
 * acting as a coordinator get no viewer, so no link, exactly as the page refuses them.
 * A failed read hides the links rather than the page.
 */
export async function areaHealthLinkEventIds(): Promise<string[]> {
  try {
    const viewer = await resolveAreaHealthViewer();
    if (!viewer) return [];
    return (await listHealthEvents(viewer)).map((event) => event.id);
  } catch {
    // Nothing in this module logs (privacy guard); a failed read just hides the links.
    return [];
  }
}
