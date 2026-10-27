import "server-only";

import { getEncryptionKeyStatus } from "@/lib/env";
import { getEmailAvailability } from "@/integrations/email/provider";
import { getSquareConfiguration } from "@/modules/payments/square-config-domain";

/**
 * Environment-managed provider status for System management > Platform settings (#1258). These services are set in the
 * server environment (deployment variables), never on a settings page, so the page only reports whether each one is
 * configured. It is a configuration fact: not live health (the System health panel) and not manual readiness evidence
 * (System readiness).
 *
 * The result holds fixed labels, a status and, for a service that is not fully configured, the NAMES of the variables
 * that are blank. It never holds a value, a prefix of a value or a length, and there is no field to edit one. It is
 * computed on the server and is returned only to a system administrator (`getEnvironmentStatusForViewer`).
 */
export type EnvironmentStatusValue = "configured" | "not-configured" | "unknown";

export type EnvironmentServiceStatus = {
  id: string;
  label: string;
  status: EnvironmentStatusValue;
  /** Variable names (never values) that are blank, for a service that is not configured. */
  missing: string[];
  /** A fixed sentence for a state the variable names cannot explain (such as Production not unlocked), never a value. */
  note: string | null;
};

export type EnvironmentStatus = { services: EnvironmentServiceStatus[] };

type Source = Record<string, string | undefined>;

const present = (source: Source, key: string) => Boolean(source[key]?.trim());

/** Configured when every required variable is set; otherwise not configured, naming the blank ones. */
function allOf(source: Source, id: string, label: string, keys: readonly string[]): EnvironmentServiceStatus {
  const missing = keys.filter((key) => !present(source, key));
  return { id, label, status: missing.length === 0 ? "configured" : "not-configured", missing, note: null };
}

const unknownService = (id: string, label: string): EnvironmentServiceStatus => ({ id, label, status: "unknown", missing: [], note: null });

/** An email provider other than the two known ones is a typo, which this page cannot judge. */
function emailProviderRecognized(source: Source) {
  const value = source.EMAIL_PROVIDER?.trim().toLowerCase() ?? "";
  return value === "" || value === "resend" || value === "ses";
}

const squareNotes: Record<string, string> = {
  INVALID_ENVIRONMENT: "SQUARE_ENVIRONMENT must be sandbox or production.",
  PRODUCTION_DISABLED: "Production is selected but not unlocked.",
  INVALID_API_URL: "The Square API address is not valid for this environment.",
  CREDENTIAL_ENVIRONMENT_MISMATCH: "The application id does not match the selected environment.",
};

/** Square, judged by the payment module's own reader so this page and the app agree (alias, derived URL, production unlock). */
function squareServices(source: Source): EnvironmentServiceStatus[] {
  const config = getSquareConfiguration(source);
  const missing = [
    ...(config.applicationId ? [] : ["SQUARE_APPLICATION_ID"]),
    ...(config.accessToken ? [] : ["SQUARE_ACCESS_TOKEN"]),
    ...(config.locationId ? [] : ["SQUARE_LOCATION_ID"]),
  ];
  // Status is the app's own verdict (`paymentConfigured` / `webhookConfigured`); the lists and notes only explain it.
  const environmentNote = config.issue ? squareNotes[config.issue] ?? null : null;
  const paymentNote = environmentNote
    ?? (config.issue === "MISSING_WEBHOOK_CONFIGURATION" ? "Card payments stay off until the Square webhook is set." : null);
  const webhookMissing = config.webhookSignatureKey ? [] : ["SQUARE_WEBHOOK_SIGNATURE_KEY (or SQUARE_WEBHOOK_SECRET)"];
  const webhookNote = environmentNote
    ?? (!config.webhookNotificationUrl
      ? "The webhook address is not valid: check SQUARE_WEBHOOK_NOTIFICATION_URL or APP_BASE_URL."
      : config.issue === "MISSING_PAYMENT_CREDENTIALS" ? "Webhooks are refused until the payment credentials are set." : null);
  return [
    { id: "payments", label: "Square payments", status: config.paymentConfigured ? "configured" : "not-configured", missing, note: paymentNote },
    { id: "payment-webhook", label: "Square payment confirmations (webhook)", status: config.webhookConfigured ? "configured" : "not-configured", missing: webhookMissing, note: webhookNote },
  ];
}

export type EmailAvailabilityReader = () => { deliveryConfigured: boolean; webhookConfigured: boolean };

/**
 * Pure apart from the two readers it is given, so a test can pass a fake environment and read the whole result. A reader
 * that throws makes that one service "unknown" rather than failing the page.
 */
export function buildEnvironmentStatus(
  source: Source,
  readers: {
    emailAvailability?: EmailAvailabilityReader;
    encryptionKey?: (source: Source) => { configured: boolean };
  } = {},
): EnvironmentStatus {
  const readEmail = readers.emailAvailability ?? getEmailAvailability;
  const readKey = readers.encryptionKey ?? ((from: Source) => getEncryptionKeyStatus(from));
  const services: EnvironmentServiceStatus[] = [];

  let email: ReturnType<EmailAvailabilityReader> | null = null;
  if (emailProviderRecognized(source)) {
    try { email = readEmail(); } catch { email = null; }
  }
  const provider = source.EMAIL_PROVIDER?.trim().toLowerCase() === "ses" ? "Amazon SES" : "Resend";
  services.push(
    email
      ? { id: "email-provider", label: `Email provider (${provider})`, status: email.deliveryConfigured ? "configured" : "not-configured", missing: [], note: null }
      : unknownService("email-provider", "Email provider"),
    email
      ? { id: "email-reports", label: "Email bounce and complaint reports", status: email.webhookConfigured ? "configured" : "not-configured", missing: [], note: null }
      : unknownService("email-reports", "Email bounce and complaint reports"),
    allOf(source, "account-email", "Account email sender", ["ACCOUNT_EMAIL_SENDER_ADDRESS"]),
    ...squareServices(source),
    allOf(source, "google-sign-in", "Google sign-in", ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]),
  );

  try {
    services.push({ id: "encryption-key", label: "Secret encryption key", status: readKey(source).configured ? "configured" : "not-configured", missing: [], note: null });
  } catch {
    services.push(unknownService("encryption-key", "Secret encryption key"));
  }
  services.push(
    allOf(source, "outbox-sweep", "Scheduled message sweep token", ["OUTBOX_SWEEP_TOKEN"]),
    allOf(source, "alert-webhook", "Operations alert webhook", ["ALERT_WEBHOOK_URL"]),
  );
  return { services };
}

/** The status for a system administrator, and `null` for anyone else: nothing about the environment goes to other roles. */
export function getEnvironmentStatusForViewer(viewer: { globalRole?: string | null } | null | undefined): EnvironmentStatus | null {
  if (viewer?.globalRole !== "SYSTEM_ADMIN") return null;
  return buildEnvironmentStatus(process.env);
}
