import { getTurnstileConfiguration, type TurnstileConfiguration } from "@/modules/security/turnstile";
import type { SignalState } from "./model";

/**
 * The System report row for the Cloudflare Turnstile "Security check" on public forms and sign-in (#1399). Environment
 * presence only: the row names the variables that are missing and never shows a key or any other value.
 */

export const SECURITY_CHECK_NOT_CONFIGURED_TEXT = "Security check not configured";

type Fields = { key: string; state: SignalState; resultText: string; checkedAt: string; whenLabel: string; needsSetup?: boolean };

export function securityCheckFields(
  configuration: TurnstileConfiguration = getTurnstileConfiguration(),
  now: Date = new Date(),
): Fields {
  const common = { key: "security-check", checkedAt: now.toISOString(), whenLabel: "Checked" };
  if (configuration.mode === "enforce") {
    return { ...common, state: "ok", resultText: "Configured" };
  }
  if (!configuration.production) {
    return { ...common, state: "info", resultText: "Skipped outside production" };
  }
  const names = configuration.missing.length === 2 ? "" : ` ${configuration.missing[0]} is not set.`;
  return {
    ...common,
    state: "watch",
    needsSetup: true,
    resultText: `${SECURITY_CHECK_NOT_CONFIGURED_TEXT}. Forms are open to bots until both keys are set.${names}`,
  };
}
