import "server-only";

import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { optionalEmail, PLATFORM_SETTINGS_ID } from "@/modules/system-admin/platform-settings";

/**
 * The one central email sender (#1043): the display name, From address and reply-to every event's email uses. It is
 * edited on System management > Email. These are the same three platform columns Platform settings has always held
 * (`defaultSenderName`, `defaultSenderEmail`, `defaultReplyToEmail`), so there is one stored sender. An event overrides
 * only its display name and reply-to; the From address is always this one.
 */
export const centralSenderInputSchema = z.object({
  defaultSenderName: z.string().trim().min(2).max(120),
  defaultSenderEmail: optionalEmail,
  defaultReplyToEmail: optionalEmail,
}).strict();

export type CentralSenderInput = z.infer<typeof centralSenderInputSchema>;

export async function updateCentralSender(
  input: CentralSenderInput,
  actorUserId: string,
): Promise<CentralSenderInput> {
  const prisma = getPrisma();
  const after = {
    defaultSenderName: input.defaultSenderName,
    defaultSenderEmail: input.defaultSenderEmail ?? null,
    defaultReplyToEmail: input.defaultReplyToEmail ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const before = await tx.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { defaultSenderName: true, defaultSenderEmail: true, defaultReplyToEmail: true },
    });
    await tx.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      update: { ...after, updatedByUserId: actorUserId },
      create: { id: PLATFORM_SETTINGS_ID, ...after, updatedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "CENTRAL_EMAIL_SENDER_UPDATED",
        entityType: "PlatformSettings",
        entityId: PLATFORM_SETTINGS_ID,
        correlationId: `central-email-sender:${Date.now()}`,
        summary: "Updated the central email sender.",
        // Which fields changed, not their values.
        metadata: {
          changed: (Object.keys(after) as Array<keyof typeof after>).filter((key) => (before?.[key] ?? null) !== after[key]),
        },
      },
    });
  });
  return after;
}
