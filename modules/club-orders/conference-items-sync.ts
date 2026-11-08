import type { PrismaClient } from "@prisma/client";
import { CONFERENCE_SUPPLY_ITEMS } from "@/modules/club-orders/conference-orders";
import { normalizeClubSupplyName } from "@/modules/club-supplies/domain";

/**
 * Makes sure the three conference-supplied items exist in the club supply catalog (#1688): the Pathfinder Shoulder Patch, the
 * Pathfinder Conference Pin and the Adventurer Shoulder Patch, at the prices on the conference's "Shoulder Patches and Pins"
 * sheet. Only adds what is missing; a row that already exists (whatever staff set its price or supplier to) is never changed,
 * so a price staff chose is never overwritten. Safe to run any number of times. Staff change prices in Admin, Club supply catalog.
 */
export async function syncConferenceSupplyItems(prisma: Pick<PrismaClient, "clubSupplyItem">) {
  const created: string[] = [];
  const existing: string[] = [];
  for (const item of CONFERENCE_SUPPLY_ITEMS) {
    const normalizedName = normalizeClubSupplyName(item.name);
    const found = await prisma.clubSupplyItem.findUnique({
      where: { section_normalizedName: { section: "MISCELLANEOUS", normalizedName } },
      select: { id: true },
    });
    if (found) {
      existing.push(item.name);
      continue;
    }
    await prisma.clubSupplyItem.create({
      data: { section: "MISCELLANEOUS", name: item.name, normalizedName, catalogNumber: null, supplier: "CONFERENCE", unitPriceCents: item.unitPriceCents, isActive: true },
    });
    created.push(item.name);
  }
  return { created, existing };
}
