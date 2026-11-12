import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { EventOperationError } from "@/modules/events/operation-error";
import { mapSiteLabel, type MapSiteOption } from "@/modules/events/map-site-domain";

/**
 * The host church or site an event can use as its public map pin (#1212).
 * Any active organization with map coordinates (a church, camp, school and so
 * on) qualifies. Only the name and town are read, never contact details.
 */
export async function listMapSiteOptions(): Promise<MapSiteOption[]> {
  const rows = await getPrisma().organization.findMany({
    where: {
      isActive: true,
      churchLocation: { is: { latitude: { not: null }, longitude: { not: null } } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, churchLocation: { select: { city: true, state: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: mapSiteLabel(row.name, row.churchLocation?.city ?? "", row.churchLocation?.state ?? ""),
  }));
}

/**
 * Server-side check on save: the chosen site must be an existing, active
 * organization. Null (no pin) is always fine. The form only offers mapped
 * sites, but the server never trusts the form.
 */
export async function assertMapSiteUsable(tx: Prisma.TransactionClient, organizationId: string | null | undefined) {
  if (organizationId === null || organizationId === undefined) return;
  const site = await tx.organization.findUnique({ where: { id: organizationId }, select: { isActive: true } });
  if (!site || !site.isActive) {
    throw new EventOperationError(
      "EVENT_MAP_SITE_INVALID",
      "Choose a church or site that is listed for the map pin, or leave it empty. The one you chose is no longer available.",
    );
  }
}
