import "server-only";

import { createHash } from "node:crypto";

import {
  getResendEmailAvailability,
  getResendEmailConfiguration,
  sendEmailWithResend,
  type ResendEmailConfiguration,
} from "./resend";
import {
  getSesEmailAvailability,
  getSesEmailConfiguration,
  isSesEmailConfiguration,
  sendEmailWithSes,
  verifySesConnection,
  type SesEmailConfiguration,
} from "./ses";
import {
  EmailProviderConfigurationError,
  type EmailDeliveryInput,
  type EmailDeliveryResult,
  type EmailProviderName,
} from "./types";

/**
 * The one place that knows which outbound email provider is active (#861). `EMAIL_PROVIDER=ses` selects Amazon
 * SES; unset, blank or `resend` keeps Resend, so nothing changes until a server sets it.
 */

export type EmailProviderConfiguration = ResendEmailConfiguration | SesEmailConfiguration;

/** `null` for a value that is neither provider, so a typo is reported rather than silently routed. */
function parseProvider(value: string | undefined): EmailProviderName | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "" || normalized === "resend") return "RESEND";
  if (normalized === "ses") return "SES";
  return null;
}

/**
 * The backup provider (#1444). `EMAIL_BACKUP_PROVIDER=resend` is the only accepted value, and the backup is active only
 * while Amazon SES is the primary and a Resend API key is set. Unset or blank leaves everything exactly as it was. A
 * value that is anything else, or one that names the primary itself, switches the backup off and is reported (never
 * thrown), so a typo can't stop the primary from sending.
 */
export type EmailBackupStatus = {
  active: boolean;
  /** Why it is off, in words a System report row can show. Null while active. */
  reason: "not_set" | "invalid_value" | "primary_not_ses" | "same_as_primary" | "missing_api_key" | null;
};

export function getEmailBackupStatus(env: NodeJS.ProcessEnv = process.env): EmailBackupStatus {
  const value = env.EMAIL_BACKUP_PROVIDER?.trim().toLowerCase() ?? "";
  if (value === "") return { active: false, reason: "not_set" };
  if (value !== "resend") return { active: false, reason: "invalid_value" };
  const primary = parseProvider(env.EMAIL_PROVIDER);
  if (primary === "RESEND") return { active: false, reason: "same_as_primary" };
  if (primary !== "SES") return { active: false, reason: "primary_not_ses" };
  if (!env.RESEND_API_KEY?.trim()) return { active: false, reason: "missing_api_key" };
  return { active: true, reason: null };
}

/** The Resend configuration to use as the backup, or null when the backup is not active. */
export function getBackupEmailConfiguration(): ResendEmailConfiguration | null {
  return getEmailBackupStatus().active ? getResendEmailConfiguration() : null;
}

/** The provider name recorded on outbox rows and delivery attempts. */
export function getActiveEmailProviderName(): EmailProviderName {
  return parseProvider(process.env.EMAIL_PROVIDER) ?? "RESEND";
}

export function getEmailAvailability() {
  const provider = parseProvider(process.env.EMAIL_PROVIDER);
  if (provider === null) return { deliveryConfigured: false, webhookConfigured: false };
  return provider === "SES" ? getSesEmailAvailability() : getResendEmailAvailability();
}

export function getEmailConfiguration(): EmailProviderConfiguration {
  const provider = parseProvider(process.env.EMAIL_PROVIDER);
  if (provider === null) {
    throw new EmailProviderConfigurationError("EMAIL_PROVIDER must be ses or resend.");
  }
  return provider === "SES" ? getSesEmailConfiguration() : getResendEmailConfiguration();
}

export async function sendEmail(
  input: EmailDeliveryInput,
  configuration?: EmailProviderConfiguration,
): Promise<EmailDeliveryResult> {
  const resolved = configuration ?? getEmailConfiguration();
  return isSesEmailConfiguration(resolved)
    ? sendEmailWithSes(input, resolved)
    : sendEmailWithResend(input, resolved);
}

/** The provider a configuration belongs to, which is what was actually used, whatever the environment says now. */
export function providerNameForConfiguration(configuration: EmailProviderConfiguration): EmailProviderName {
  return isSesEmailConfiguration(configuration) ? "SES" : "RESEND";
}

/** Run before a batch claims any message: bad credentials stop here, with every message left untouched. */
export async function preflightEmailProvider(
  configuration: EmailProviderConfiguration,
  now: () => number = Date.now,
) {
  if (!isSesEmailConfiguration(configuration)) return;
  // A login that worked is trusted for a few minutes, so a busy sweep or a run of inline sends logs in once.
  const key = createHash("sha256")
    .update([configuration.smtpHost, configuration.smtpPort, configuration.username, configuration.password].join("\u0000"))
    .digest("hex");
  const verifiedAt = verifiedConfigurations.get(key);
  if (verifiedAt !== undefined && now() - verifiedAt < PREFLIGHT_CACHE_MS) return;
  await verifySesConnection(configuration);
  verifiedConfigurations.set(key, now());
}

export const PREFLIGHT_CACHE_MS = 5 * 60 * 1000;
const verifiedConfigurations = new Map<string, number>();

/** Test hook: forget every cached pre-flight. */
export function resetEmailPreflightCache() {
  verifiedConfigurations.clear();
}
