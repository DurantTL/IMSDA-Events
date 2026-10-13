import { z } from "zod";

export const manualPaymentSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  method: z.enum(["CASH", "CHECK", "MANUAL"]),
  reference: z.string().trim().max(120).default(""),
  /** Record this as the registration's reservation deposit, e.g. a mailed check (#415). */
  isDeposit: z.boolean().default(false),
});

export const refundInputSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  reason: z.string().trim().min(3, "A refund reason is required.").max(300),
  /** One per reviewed refund operation; reused on every retry of it (#525). */
  idempotencyKey: z.string().trim().min(8, "A refund idempotency key is required.").max(100),
});

