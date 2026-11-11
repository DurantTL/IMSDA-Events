import "server-only";

import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import type { AdminRoles } from "@/modules/access/admin-roles-domain";
import { resolveHomeLayout, type HomeLayout, type HomeLayoutEntry } from "@/modules/system-admin/home-layout-domain";

/** One person's saved Home layout checked against their current roles (#1705). A failed read falls back to the role defaults. */
export async function loadHomeLayout(userId: string, roles: AdminRoles): Promise<HomeLayout> {
  try {
    const row = await getPrisma().staffHomeLayout.findUnique({ where: { userId }, select: { modules: true } });
    return resolveHomeLayout(row?.modules ?? null, roles);
  } catch (error) {
    logError("Home layout could not be read", error);
    return resolveHomeLayout(null, roles);
  }
}

export async function saveHomeLayout(userId: string, modules: readonly HomeLayoutEntry[]): Promise<void> {
  const value = modules.map(({ key, shown }) => ({ key, shown }));
  await getPrisma().staffHomeLayout.upsert({
    where: { userId },
    create: { userId, modules: value },
    update: { modules: value },
  });
}

export async function resetHomeLayout(userId: string): Promise<void> {
  await getPrisma().staffHomeLayout.deleteMany({ where: { userId } });
}
