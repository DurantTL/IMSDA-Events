import "server-only";

import { getPrisma } from "@/lib/prisma";
import { assertScopedToggleAllowed, loadScopedToolEvent, scopedModuleIsOn, writeScopedModuleSwitch, type ScopedToggleActor } from "@/modules/event-modules/scoped-toggle";
import { RECOGNITION_MODULE_KEY } from "@/modules/recognitions/domain";

/**
 * Switching Recognitions on or off (#1683) is the shared scoped switch (`scoped-toggle.ts`), staff side only in this release: a
 * system administrator, an Event Admin or the Clubs Administrator (`requireStaffToggleAccess`). An Area Coordinator has no
 * switch yet; the coordinator-side page is a later slice. Off hides the tool and keeps every mark.
 */
export async function applyRecognitionsSwitch(actor: ScopedToggleActor & { kind: "staff" }, eventId: string, enabled: boolean) {
  await assertScopedToggleAllowed(RECOGNITION_MODULE_KEY, actor);
  await loadScopedToolEvent(eventId, actor.kind, "Recognitions are for club events. Choose a club event, or this one may be archived.");
  await getPrisma().$transaction(async (tx) => {
    await writeScopedModuleSwitch(tx, { actor, eventId, moduleKey: RECOGNITION_MODULE_KEY, enabled });
  });
  return { enabled: await scopedModuleIsOn(eventId, RECOGNITION_MODULE_KEY) };
}
