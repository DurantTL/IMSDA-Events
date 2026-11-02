import { z } from "zod";

const emailSchema = z.string().trim().email().max(254);

/**
 * The address a registration form's answers carry, for the strict per-address limit on a submission that arrived with
 * no Security check token (#1480). Form fields are configured per event, so this reads the first top-level answer
 * whose key mentions "email" and whose value is a valid address. It only picks a rate-limit key: it decides nothing
 * about who the person is, and a form with no such answer is limited per source address alone.
 */
export function emailFromRegistrationResponses(responses: Record<string, unknown> | null | undefined): string | null {
  if (!responses) return null;
  for (const [key, value] of Object.entries(responses)) {
    if (!/e-?mail/i.test(key) || typeof value !== "string") continue;
    const parsed = emailSchema.safeParse(value);
    if (parsed.success) return parsed.data.toLowerCase();
  }
  return null;
}
