import "server-only";

import { getPrisma } from "@/lib/prisma";
import { effectiveClubFormFillMode } from "@/modules/club-forms/domain";
import type { ClubFormFillMode } from "@/modules/club-forms/definitions";
import { publicClubFormTemplateKeys } from "@/modules/club-forms/public-index-domain";

/** Which of the page's club form templates are turned on: the key and the switch, nothing else. */
export async function listEnabledPublicClubFormKeys(): Promise<Set<string>> {
  const rows = await getPrisma().clubFormTemplate.findMany({
    where: { key: { in: [...publicClubFormTemplateKeys] }, enabled: true },
    select: { key: true },
  });
  return new Set(rows.map((row) => row.key));
}

/** Who fills in each of the page's club forms (#1229): the stored setting, or the code's default. Keys and modes only. */
export async function listPublicClubFormFillModes(): Promise<Map<string, ClubFormFillMode>> {
  const rows = await getPrisma().clubFormTemplate.findMany({
    where: { key: { in: [...publicClubFormTemplateKeys] } },
    select: { key: true, fillMode: true },
  });
  return new Map(rows.map((row) => [row.key, effectiveClubFormFillMode(row.fillMode, row.key)]));
}
