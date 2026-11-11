"use server";

import { resolveAdminRoles } from "@/modules/access/admin-roles";
import { heldAdminRoles } from "@/modules/access/admin-roles-domain";
import { getCurrentSession } from "@/modules/access/current-session";
import { resolveHomeLayout, sanitizeHomeLayoutInput, type HomeLayout } from "@/modules/system-admin/home-layout-domain";
import { resetHomeLayout, saveHomeLayout } from "@/modules/system-admin/home-layout-repository";

export type HomeLayoutResult = { ok: true; layout: HomeLayout } | { ok: false; message: string };

const refused: HomeLayoutResult = { ok: false, message: "Your layout could not be saved." };

/** The signed-in person and their admin roles, read fresh. The person is only ever the session's, never anything sent in. */
async function currentAdmin() {
  const { user } = await getCurrentSession();
  if (!user) return null;
  const roles = await resolveAdminRoles(user);
  if (heldAdminRoles(roles).length === 0) return null;
  return { userId: user.id, roles };
}

/** Saves the signed-in admin's own staff Home layout (#1705). A personal view preference: nothing else is changed. */
export async function saveHomeLayoutAction(input: unknown): Promise<HomeLayoutResult> {
  const admin = await currentAdmin();
  if (!admin) return refused;
  const modules = sanitizeHomeLayoutInput(input, admin.roles);
  if (!modules) return refused;
  try {
    await saveHomeLayout(admin.userId, modules);
  } catch {
    return refused;
  }
  return { ok: true, layout: resolveHomeLayout(modules, admin.roles) };
}

/** Puts back the signed-in admin's role defaults. */
export async function resetHomeLayoutAction(): Promise<HomeLayoutResult> {
  const admin = await currentAdmin();
  if (!admin) return refused;
  try {
    await resetHomeLayout(admin.userId);
  } catch {
    return refused;
  }
  return { ok: true, layout: resolveHomeLayout(null, admin.roles) };
}
