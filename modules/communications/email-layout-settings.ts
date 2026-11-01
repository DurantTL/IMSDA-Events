import { logWarn } from "@/lib/logger";
import {
  DEFAULT_EMAIL_LAYOUT_SETTINGS,
  emailLayoutSettingsFromRow,
  type EmailLayoutSettings,
  type EmailLayoutSettingsRow,
} from "@/modules/communications/email-layout-domain";

/** The part of Prisma this read needs, so delivery and tests can hand in a narrow client. */
export type EmailLayoutSettingsReader = {
  platformSettings?: {
    findUnique: (args: {
      where: { id: string };
      select: Record<keyof EmailLayoutSettingsRow, true>;
    }) => Promise<EmailLayoutSettingsRow | null>;
  };
};

/**
 * The header names and footer help contact (#1443), read once by a delivery run and used for every message in it.
 * Never throws: a database problem sends the run's email with the defaults rather than stopping the run, and the
 * defaults are the same values a fresh install has.
 */
export async function loadEmailLayoutSettings(prisma: EmailLayoutSettingsReader): Promise<EmailLayoutSettings> {
  if (!prisma.platformSettings) return DEFAULT_EMAIL_LAYOUT_SETTINGS;
  try {
    const row = await prisma.platformSettings.findUnique({
      where: { id: "platform" },
      select: { emailHeaderName: true, emailClubHeaderName: true, emailHelpEmail: true, emailHelpPhone: true },
    });
    return emailLayoutSettingsFromRow(row);
  } catch (error) {
    logWarn("The email header and help settings could not be read; this run uses the defaults.", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return DEFAULT_EMAIL_LAYOUT_SETTINGS;
  }
}
