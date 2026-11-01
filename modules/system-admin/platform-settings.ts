import "server-only";

import { z } from "zod";
import { MAX_PHONE_LENGTH, resolvePhoneChange } from "@/lib/field-validation";
import { logError } from "@/lib/logger";
import { getPrisma } from "@/lib/prisma";
import { isValidRelyingPartyId } from "@/modules/attendee-accounts/passkey-domain";
import { checkEmailHeaderName } from "@/modules/communications/email-layout-domain";
import { loadEmailLayoutSettings } from "@/modules/communications/email-layout-settings";
import { resolveFormsHelpContact, type FormsHelpContact } from "@/modules/system-admin/forms-help-contact";

export const PLATFORM_SETTINGS_ID = "platform";

/**
 * Blank means "not set", not the string "". Storing an empty string would make
 * an unset default indistinguishable from one deliberately cleared, and the
 * inheritance below has to be able to tell those apart.
 */
/**
 * Trims before validating, not after. A pasted address arrives as
 * "  Name@Example.org " often enough that validating first would reject a value
 * the user plainly meant, and a transform that runs afterwards never gets the
 * chance to clean it.
 */
function optionalField<T extends z.ZodType<string>>(inner: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.union([z.literal(""), inner]),
  ).nullable().optional().transform((value) => (value ? value : null));
}

export const optionalEmail = optionalField(
  z.email().max(200).transform((value) => value.toLowerCase()),
);

const optionalUrl = optionalField(z.url().max(500));

/** An email header name (#1443): 1 to 40 characters on one line. Absent means "leave as it is", never "reset". */
const emailHeaderNameField = z.string().transform((value, ctx) => {
  const check = checkEmailHeaderName(value);
  if (!check.ok) {
    ctx.addIssue({ code: "custom", message: check.message });
    return z.NEVER;
  }
  return check.value;
}).optional();

export const platformSettingsInputSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  logoUrl: optionalUrl,
  publicWebsiteUrl: optionalUrl,
  defaultTimezone: z.string().trim().min(1).max(60),
  // The central email sender (name, address, reply-to) is edited on System management > Email only (#1043), so the
  // platform settings form cannot send it and `.strict()` refuses it.
  defaultAttendeeEditPolicy: z
    .enum(["TIERED", "VERIFY_EVERY_EDIT"])
    .default("VERIFY_EVERY_EDIT"),
  /** The site's own domain, with no https:// or path. Blank keeps passkeys off. */
  passkeyRpId: optionalField(
    z.string().max(253).transform((value) => value.toLowerCase())
      .refine(isValidRelyingPartyId, "Enter just the domain, like events.imsda.org."),
  ),
  /**
   * The header block of the church invoice PDF (#780): the department line, the organization name, the mailing
   * address (one line per row) and the phone. All blank means the PDF prints the platform organization name alone.
   */
  invoiceHeaderDepartment: optionalField(z.string().max(120)),
  invoiceHeaderOrganization: optionalField(z.string().max(120)),
  invoiceHeaderAddress: optionalField(
    z.string().max(400).refine((value) => value.split(/\r?\n/).length <= 4, "Use at most four address lines."),
  ),
  // Judged in `updatePlatformSettings` against the stored phone (#1193), so an old saved one is not held against a save.
  invoiceHeaderPhone: optionalField(z.string().max(MAX_PHONE_LENGTH)),
  /**
   * The help line in the public homepage footer (#1251): "Need help? Call ... or email ...". Blank leaves that part out. Not
   * `supportContact`, the internal alert inbox. The phone is judged in `updatePlatformSettings`, like the invoice phone.
   */
  publicHelpPhone: optionalField(z.string().max(MAX_PHONE_LENGTH)),
  publicHelpEmail: optionalEmail,
  /**
   * The shared email layout (#1443): the header name for event and general email, the one for club email, and the
   * footer help contact. A blank contact is left out of the footer. The phone is judged in `updatePlatformSettings`.
   */
  emailHeaderName: emailHeaderNameField,
  emailClubHeaderName: emailHeaderNameField,
  // Absent means "leave as it is" (a client from before this setting), not "clear": a blank string clears.
  emailHelpEmail: z.union([z.undefined(), optionalEmail]),
  emailHelpPhone: z.union([z.undefined(), optionalField(z.string().max(MAX_PHONE_LENGTH))]),
}).strict();

export type PlatformSettingsInput = z.infer<typeof platformSettingsInputSchema>;

/**
 * What the form sent: the settings plus, optionally, the values the page loaded (#1076). When present, a save is refused if
 * any of those fields has changed in the database since, so one administrator cannot silently overwrite another's edit.
 * Compared field by field rather than by `updatedAt`, because the Email page and the sign-in switch write the same row.
 */
export const platformSettingsRequestSchema = platformSettingsInputSchema.extend({
  baseline: z.record(z.string(), z.string()).optional(),
}).strict();

/**
 * The three addresses automatic alerts are sent to (#1016). They are edited on
 * System management > Notifications and nowhere else, so the platform settings
 * form above cannot clear them by leaving them out of its request.
 *
 * - `supportContact`: also receives event feature requests.
 * - `securityAlertEmail`: gets the short lockout alert (#456), in addition to
 *   the account holder. Blank means only the account holder is emailed.
 * - `newClubApplicationEmail`: gets the "a new club applied" notice (#817).
 *   Blank means no notice is sent; applications still wait in the queue.
 */
export const platformAddressesInputSchema = z.object({
  supportContact: optionalEmail,
  securityAlertEmail: optionalEmail,
  newClubApplicationEmail: optionalEmail,
}).strict();

export type PlatformAddressesInput = z.infer<typeof platformAddressesInputSchema>;

export type PlatformSettingsRecord = PlatformSettingsInput & PlatformAddressesInput & {
  /** The central sender, read-only here; `central-sender.ts` writes it. */
  defaultSenderName: string;
  defaultSenderEmail: string | null;
  defaultReplyToEmail: string | null;
  /** Never blank: the form always shows, and the layout always has, a name (#1443). */
  emailHeaderName: string;
  emailClubHeaderName: string;
  updatedAt: string;
  updatedByName: string | null;
};

/**
 * Reads the single settings row, creating it if a database predates the seed.
 *
 * Callers are allowed to assume it exists. Making each one handle its absence
 * would spread the same defaulting decision across every reader, which is how
 * two readers end up disagreeing about what the default is.
 */
export async function getPlatformSettings(): Promise<PlatformSettingsRecord> {
  const prisma = getPrisma();
  const row = await prisma.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {},
    create: { id: PLATFORM_SETTINGS_ID },
    include: { updatedBy: { select: { displayName: true } } },
  });
  return {
    organizationName: row.organizationName,
    logoUrl: row.logoUrl,
    supportContact: row.supportContact,
    publicWebsiteUrl: row.publicWebsiteUrl,
    defaultTimezone: row.defaultTimezone,
    defaultSenderName: row.defaultSenderName,
    defaultSenderEmail: row.defaultSenderEmail,
    defaultReplyToEmail: row.defaultReplyToEmail,
    defaultAttendeeEditPolicy: row.defaultAttendeeEditPolicy,
    passkeyRpId: row.passkeyRpId,
    securityAlertEmail: row.securityAlertEmail,
    newClubApplicationEmail: row.newClubApplicationEmail,
    invoiceHeaderDepartment: row.invoiceHeaderDepartment,
    invoiceHeaderOrganization: row.invoiceHeaderOrganization,
    invoiceHeaderAddress: row.invoiceHeaderAddress,
    invoiceHeaderPhone: row.invoiceHeaderPhone,
    publicHelpPhone: row.publicHelpPhone,
    publicHelpEmail: row.publicHelpEmail,
    emailHeaderName: row.emailHeaderName,
    emailClubHeaderName: row.emailClubHeaderName,
    emailHelpEmail: row.emailHelpEmail,
    emailHelpPhone: row.emailHelpPhone,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedBy?.displayName ?? null,
  };
}

/**
 * The help contact the public homepage footer shows (#1251). A narrow read that never creates the row and never throws:
 * a database problem just leaves the help line off, so the front page still loads.
 */
export async function getPublicHelpContact(): Promise<{ phone: string | null; email: string | null }> {
  try {
    const row = await getPrisma().platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { publicHelpPhone: true, publicHelpEmail: true },
    });
    return { phone: row?.publicHelpPhone?.trim() || null, email: row?.publicHelpEmail?.trim() || null };
  } catch (error) {
    logError("Reading the homepage help contact failed", error);
    return { phone: null, email: null };
  }
}

/**
 * The contact the "Forms help" popup shows (#1445): Platform settings → Email header and footer → footer help email and
 * phone (#1443), the same contact every email's footer shows. A field left blank still shows the IMSDA support default
 * here, because the popup always needs a way to reach someone. Never throws (`loadEmailLayoutSettings` falls back to
 * the defaults when the read fails).
 */
export async function getFormsHelpContact(): Promise<FormsHelpContact> {
  const settings = await loadEmailLayoutSettings(getPrisma());
  return resolveFormsHelpContact({ email: settings.helpEmail, phone: settings.helpPhone });
}

export class PlatformSettingsError extends Error {
  constructor(
    public readonly code: "PASSKEY_ONLY_STAFF_WOULD_BE_LOCKED_OUT" | "INVALID_SETTING" | "PLATFORM_SETTINGS_CONFLICT",
    message: string,
    /** The form fields someone else changed, for `PLATFORM_SETTINGS_CONFLICT`. */
    public readonly fields: string[] = [],
  ) {
    super(message);
    this.name = "PlatformSettingsError";
  }
}

/**
 * Staff who could sign in only with a passkey: an active account that has to
 * pass a second step (a system administrator, or anyone with an ACTIVE event
 * membership — the rule in modules/access/mfa-rules.ts), at least one live
 * passkey, and no active authenticator to fall back on. Changing or clearing
 * the passkey domain invalidates every existing passkey, which would strand
 * exactly these people. Staff with no second-step requirement still sign in
 * with a password alone, so they are not counted.
 */
async function countPasskeyOnlyStaff(tx: Pick<ReturnType<typeof getPrisma>, "user">) {
  return tx.user.count({
    where: {
      accountStatus: "ACTIVE",
      passkeys: { some: { revokedAt: null } },
      NOT: { mfaEnrollment: { is: { status: "ACTIVE" } } },
      OR: [
        { globalRole: "SYSTEM_ADMIN" },
        { memberships: { some: { status: "ACTIVE" } } },
      ],
    },
  });
}

const BASELINE_FIELDS = [
  "organizationName",
  "logoUrl",
  "publicWebsiteUrl",
  "defaultTimezone",
  "defaultAttendeeEditPolicy",
  "passkeyRpId",
  "invoiceHeaderDepartment",
  "invoiceHeaderOrganization",
  "invoiceHeaderAddress",
  "invoiceHeaderPhone",
  "publicHelpPhone",
  "publicHelpEmail",
  "emailHeaderName",
  "emailClubHeaderName",
  "emailHelpEmail",
  "emailHelpPhone",
] as const;

export async function updatePlatformSettings(
  rawInput: PlatformSettingsInput & { baseline?: Record<string, string> },
  actorUserId: string,
): Promise<PlatformSettingsRecord> {
  const prisma = getPrisma();
  const { baseline, ...rest } = rawInput;
  let input: PlatformSettingsInput = rest;
  await prisma.$transaction(async (tx) => {
    // Held until commit, so two saves with the same baseline cannot both pass the compare below.
    await tx.$queryRaw`SELECT "id" FROM "PlatformSettings" WHERE "id" = ${PLATFORM_SETTINGS_ID} FOR UPDATE`;
    const before = await tx.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
    });
    // With a baseline, only the fields this save actually edited are compared and written, so a field someone else saved
    // meanwhile is neither reported as a conflict nor written back stale (#1076).
    const normalize = (key: string, value: unknown) => {
      const text = String(value ?? "").trim();
      return key === "passkeyRpId" || key === "publicHelpEmail" || key === "emailHelpEmail" ? text.toLowerCase() : text;
    };
    let edited: readonly (typeof BASELINE_FIELDS)[number][] = BASELINE_FIELDS;
    if (baseline && before) {
      edited = BASELINE_FIELDS.filter((key) => key in baseline && normalize(key, input[key]) !== baseline[key]);
      const stale = edited.filter((key) => normalize(key, before[key]) !== baseline[key] && normalize(key, before[key]) !== normalize(key, input[key]));
      if (stale.length > 0) {
        throw new PlatformSettingsError(
          "PLATFORM_SETTINGS_CONFLICT",
          "Someone else saved platform settings since you opened this page.",
          [...stale],
        );
      }
      // The merged row: this save's edits over whatever is stored now.
      const merged: Record<string, unknown> = { ...input };
      for (const key of BASELINE_FIELDS) if (!edited.includes(key)) merged[key] = before[key];
      input = merged as PlatformSettingsInput;
    }
    // The invoice phone must pass the shared check unless it is the phone already stored (#1193), decided here from the
    // stored row. Valid phones are stored in one form. The message never carries the phone.
    if (input.invoiceHeaderPhone && edited.includes("invoiceHeaderPhone")) {
      const phone = resolvePhoneChange(input.invoiceHeaderPhone, before?.invoiceHeaderPhone);
      if (!phone.ok) throw new PlatformSettingsError("INVALID_SETTING", `Invoice phone: ${phone.message}`);
      input = { ...input, invoiceHeaderPhone: phone.value };
    }
    if (input.publicHelpPhone && edited.includes("publicHelpPhone")) {
      const phone = resolvePhoneChange(input.publicHelpPhone, before?.publicHelpPhone);
      if (!phone.ok) throw new PlatformSettingsError("INVALID_SETTING", `Help phone: ${phone.message}`);
      input = { ...input, publicHelpPhone: phone.value };
    }
    if (input.emailHelpPhone && edited.includes("emailHelpPhone")) {
      const phone = resolvePhoneChange(input.emailHelpPhone, before?.emailHelpPhone);
      if (!phone.ok) throw new PlatformSettingsError("INVALID_SETTING", `Email help phone: ${phone.message}`);
      input = { ...input, emailHelpPhone: phone.value };
    }
    // Any change, not only clearing: a passkey is bound to the domain it was
    // made for, so a new domain strands existing passkeys just the same.
    if (before?.passkeyRpId && before.passkeyRpId !== (input.passkeyRpId ?? null)) {
      const stranded = await countPasskeyOnlyStaff(tx);
      if (stranded > 0) {
        throw new PlatformSettingsError(
          "PASSKEY_ONLY_STAFF_WOULD_BE_LOCKED_OUT",
          `${stranded} staff sign in only with a passkey; they'd be locked out. `
            + "Ask them to add an authenticator app first, then change the passkey domain.",
        );
      }
    }
    await tx.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      update: {
        ...(baseline && before ? Object.fromEntries(edited.map((key) => [key, input[key]])) : input),
        updatedByUserId: actorUserId,
      },
      create: { id: PLATFORM_SETTINGS_ID, ...input, updatedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "PLATFORM_SETTINGS_UPDATED",
        entityType: "PlatformSettings",
        entityId: PLATFORM_SETTINGS_ID,
        correlationId: `platform-settings:${Date.now()}`,
        summary: `Updated platform settings for ${input.organizationName}.`,
        // Both sides, because "who changed the sender address and what was it
        // before" is the question asked after a delivery goes wrong.
        metadata: {
          before: before
            ? {
              organizationName: before.organizationName,
              defaultTimezone: before.defaultTimezone,
              defaultAttendeeEditPolicy: before.defaultAttendeeEditPolicy,
              passkeyRpId: before.passkeyRpId,
              invoiceHeaderDepartment: before.invoiceHeaderDepartment,
              invoiceHeaderOrganization: before.invoiceHeaderOrganization,
              invoiceHeaderAddress: before.invoiceHeaderAddress,
              invoiceHeaderPhone: before.invoiceHeaderPhone,
              publicHelpPhone: before.publicHelpPhone,
              publicHelpEmail: before.publicHelpEmail,
              emailHeaderName: before.emailHeaderName,
              emailClubHeaderName: before.emailClubHeaderName,
              emailHelpEmail: before.emailHelpEmail,
              emailHelpPhone: before.emailHelpPhone,
            }
            : null,
          after: {
            organizationName: input.organizationName,
            defaultTimezone: input.defaultTimezone,
            defaultAttendeeEditPolicy: input.defaultAttendeeEditPolicy,
            passkeyRpId: input.passkeyRpId ?? null,
            invoiceHeaderDepartment: input.invoiceHeaderDepartment ?? null,
            invoiceHeaderOrganization: input.invoiceHeaderOrganization ?? null,
            invoiceHeaderAddress: input.invoiceHeaderAddress ?? null,
            invoiceHeaderPhone: input.invoiceHeaderPhone ?? null,
            publicHelpPhone: input.publicHelpPhone ?? null,
            publicHelpEmail: input.publicHelpEmail ?? null,
            emailHeaderName: input.emailHeaderName ?? before?.emailHeaderName ?? null,
            emailClubHeaderName: input.emailClubHeaderName ?? before?.emailClubHeaderName ?? null,
            emailHelpEmail: input.emailHelpEmail === undefined ? before?.emailHelpEmail ?? null : input.emailHelpEmail,
            emailHelpPhone: input.emailHelpPhone === undefined ? before?.emailHelpPhone ?? null : input.emailHelpPhone,
          },
        },
      },
    });
  });
  return getPlatformSettings();
}

/**
 * Saves the three alert addresses and writes the audit row in the same
 * transaction, with both sides, so "who changed where the lockout alert goes"
 * has an answer.
 */
export async function updatePlatformAddresses(
  input: PlatformAddressesInput,
  actorUserId: string,
): Promise<PlatformAddressesInput> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const before = await tx.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { supportContact: true, securityAlertEmail: true, newClubApplicationEmail: true },
    });
    const after = {
      supportContact: input.supportContact ?? null,
      securityAlertEmail: input.securityAlertEmail ?? null,
      newClubApplicationEmail: input.newClubApplicationEmail ?? null,
    };
    await tx.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      update: { ...after, updatedByUserId: actorUserId },
      create: { id: PLATFORM_SETTINGS_ID, ...after, updatedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "PLATFORM_ALERT_ADDRESSES_UPDATED",
        entityType: "PlatformSettings",
        entityId: PLATFORM_SETTINGS_ID,
        correlationId: `platform-alert-addresses:${Date.now()}`,
        summary: "Updated the addresses automatic alerts are sent to.",
        metadata: {
          before: before
            ? {
              supportContact: before.supportContact,
              securityAlertEmail: before.securityAlertEmail,
              newClubApplicationEmail: before.newClubApplicationEmail,
            }
            : null,
          after,
        },
      },
    });
  });
  const saved = await getPlatformSettings();
  return {
    supportContact: saved.supportContact,
    securityAlertEmail: saved.securityAlertEmail,
    newClubApplicationEmail: saved.newClubApplicationEmail,
  };
}
