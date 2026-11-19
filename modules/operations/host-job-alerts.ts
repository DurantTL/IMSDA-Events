import "server-only";

import { getPrisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { dispatchAlerts } from "@/modules/operations/alerting";
import { isDiscordGroupActive } from "@/modules/operations/discord-alert-settings";
import { ONCE_ONLY_REPEAT_MINUTES, planHostJobMessage } from "@/modules/operations/discord-alerts-domain";
import type { HostJobHeartbeat } from "@/modules/operations/host-job-heartbeat";

/**
 * What an accepted host job heartbeat says to Discord (#2048): a deploy went live, a deploy failed, the database copy
 * before a deploy failed, or a restore drill or load rehearsal finished. The repeat windows of `alerting.ts` apply, and
 * a "deployed" message is sent once per version, not on every 2-minute run. Never throws: a heartbeat must be recorded
 * whatever Discord does.
 */
export async function sendHostJobMessage(heartbeat: HostJobHeartbeat, now = new Date()): Promise<void> {
  try {
    const plan = planHostJobMessage(heartbeat, now);
    if (!plan) return;
    if ("resolvePrefix" in plan) {
      await getPrisma().alertNotification.updateMany({
        where: { key: { startsWith: plan.resolvePrefix }, resolvedAt: null },
        data: { resolvedAt: now },
      });
      return;
    }
    if (!(await isDiscordGroupActive(plan.group))) return;
    await dispatchAlerts(
      [{ key: plan.key, severity: plan.message.severity, group: plan.group, summary: plan.message.summary, detail: plan.message.detail }],
      { now, repeatMinutes: plan.repeatMinutes ?? ONCE_ONLY_REPEAT_MINUTES },
    );
  } catch (error) {
    logWarn("A host job message could not be sent to Discord.", { error: error instanceof Error ? error.name : typeof error });
  }
}
