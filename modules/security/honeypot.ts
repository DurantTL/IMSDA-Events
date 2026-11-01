import { z } from "zod";

/**
 * The hidden `website` field every public form carries (a person never fills it in). Shared by the forms that take
 * the Security check fallback (#1480): the fallback only applies after this passed, because a request that skips the
 * check must at least not look like a bot.
 */
export const HONEYPOT_FIELD = "website";
export const honeypotFieldSchema = z.literal("").optional();
