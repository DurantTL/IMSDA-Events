/**
 * Synthetic central-email setup for the DB-backed verification scripts (#1043). Real email is on for an event unless it
 * is paused, and only where this environment has email configured (a provider key, an account email sender) and the
 * platform has a central sender address. A script that wants an event to send real email (to its local provider stub)
 * calls both of these; a script that wants capture-only sets `deliveryPaused: true` on the event's settings.
 */
import type { PrismaClient } from "@prisma/client";

export const SYNTHETIC_CENTRAL_SENDER = { name: "Synthetic Events", email: "events@example.test" } as const;

/** Call before anything imports the server environment. The provider key and URL are set by each script's stub. */
export function configureSyntheticEmailEnvironment() {
  process.env.ACCOUNT_EMAIL_SENDER_ADDRESS ||= SYNTHETIC_CENTRAL_SENDER.email;
  process.env.RESEND_API_KEY ||= "re_synthetic_stub_key";
}

export async function setSyntheticCentralSender(
  prisma: Pick<PrismaClient, "platformSettings">,
  sender: { name?: string; email?: string | null } = {},
) {
  const data = {
    defaultSenderName: sender.name ?? SYNTHETIC_CENTRAL_SENDER.name,
    defaultSenderEmail: sender.email === undefined ? SYNTHETIC_CENTRAL_SENDER.email : sender.email,
  };
  await prisma.platformSettings.upsert({ where: { id: "platform" }, update: data, create: { id: "platform", ...data } });
}

/** Back to the seeded state (no central sender address), so a later script or the running app is not left able to send. */
export async function clearSyntheticCentralSender(prisma: Pick<PrismaClient, "platformSettings">) {
  await prisma.platformSettings.updateMany({
    where: { id: "platform" },
    data: { defaultSenderName: "IMSDA Events", defaultSenderEmail: null, defaultReplyToEmail: null },
  });
}
