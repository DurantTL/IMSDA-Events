import { z } from "zod";

/**
 * The hidden `website` field every public form carries (a person never fills it in). Shared by the forms that take
 * the Security check fallback (#1480): the fallback only applies after this passed, because a request that skips the
 * check must at least not look like a bot.
 */
export const HONEYPOT_FIELD = "website";
/** Shown when autofill filled the hidden field; routes that pass zod's message through (club forms) show these words (#1411). */
export const HONEYPOT_MESSAGE = "We couldn't send this form. Clear your browser's autofill and try again.";
export const honeypotFieldSchema = z.literal("", { error: HONEYPOT_MESSAGE }).optional();
