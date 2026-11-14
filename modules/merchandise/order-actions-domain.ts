import { z } from "zod";
import { merchandiseOrderStatusWords, type MerchandiseOrderStatusValue } from "@/modules/merchandise/domain";

/**
 * Staff actions on a merchandise order (#148): mark paid, comp, cancel. Pure rules only; the transaction that applies
 * them is in `order-actions.ts`. Nothing here moves money: Mark paid records a payment the treasurer already holds
 * (cash, check, or a Square card payment taken elsewhere) and never talks to Square. A paid order cannot be cancelled
 * here, because that is a refund and refunds are a separate, human-approved step.
 */

export type MerchandiseOrderActionValue = "MARK_PAID" | "COMP" | "CANCEL";
export type MerchandiseRecordedMethod = "CASH" | "CHECK" | "CARD_REFERENCE";

export const MERCHANDISE_RECORDED_METHOD_LABELS: Record<MerchandiseRecordedMethod, string> = {
  CASH: "Cash",
  CHECK: "Check",
  CARD_REFERENCE: "Card (Square)",
};

const clientRequestId = z.string().trim().uuid("Reload the page and try again.");
const reason = z.string().trim().min(3, "Enter a reason.").max(300, "Keep the reason under 300 characters.");

export const merchandiseOrderActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("MARK_PAID"),
    clientRequestId,
    method: z.enum(["CASH", "CHECK", "CARD_REFERENCE"]),
    /** The check number for a check, or the Square receipt or transaction reference for a card payment. */
    reference: z.string().trim().max(60, "Keep the reference under 60 characters.").optional(),
    note: z.string().trim().max(300, "Keep the note under 300 characters.").optional(),
  }),
  z.object({ action: z.literal("COMP"), clientRequestId, reason }),
  z.object({ action: z.literal("CANCEL"), clientRequestId, reason }),
]).superRefine((value, ctx) => {
  if (value.action === "MARK_PAID" && value.method === "CHECK" && !value.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the check number." });
  if (value.action === "MARK_PAID" && value.method === "CARD_REFERENCE" && !value.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the Square receipt or transaction reference." });
});

export type MerchandiseOrderActionInput = z.infer<typeof merchandiseOrderActionSchema>;

export type MerchandiseOrderActionRefusalCode = "ORDER_NOT_ACTIONABLE" | "PAID_ORDER_NEEDS_REFUND";

const NEXT_STATUS = { MARK_PAID: "PAID", COMP: "COMPED", CANCEL: "CANCELLED" } as const satisfies Record<MerchandiseOrderActionValue, MerchandiseOrderStatusValue>;

const ALLOWED_FROM: Record<MerchandiseOrderActionValue, readonly MerchandiseOrderStatusValue[]> = {
  MARK_PAID: ["PENDING"],
  COMP: ["PENDING"],
  CANCEL: ["PENDING", "COMPED"],
};

export const PAID_ORDER_CANCEL_MESSAGE = "A paid order can't be cancelled here. Cancelling a paid order means a refund, which is handled separately by a finance administrator.";

/** The status an action leads to, or the reason it is refused for an order in `from`. */
export function planMerchandiseOrderTransition(action: MerchandiseOrderActionValue, from: MerchandiseOrderStatusValue):
  | { ok: true; to: MerchandiseOrderStatusValue }
  | { ok: false; code: MerchandiseOrderActionRefusalCode; message: string } {
  if (ALLOWED_FROM[action].includes(from)) return { ok: true, to: NEXT_STATUS[action] };
  if (action === "CANCEL" && (from === "PAID" || from === "REFUNDED")) return { ok: false, code: "PAID_ORDER_NEEDS_REFUND", message: PAID_ORDER_CANCEL_MESSAGE };
  return { ok: false, code: "ORDER_NOT_ACTIONABLE", message: `This order is already marked "${merchandiseOrderStatusWords[from]}", so that can't be done. Reload the page to see its current state.` };
}

/** Which action buttons a staff member sees. The server checks again; this only decides what to show. */
export function merchandiseOrderActionPermissions(permissions: ReadonlyArray<string>) {
  const canView = permissions.includes("CONFIGURE_EVENT") && (permissions.includes("MANAGE_REGISTRATION") || permissions.includes("MANAGE_FINANCE"));
  const finance = canView && permissions.includes("MANAGE_FINANCE");
  return { canMarkPaid: finance, canComp: finance, canCancel: canView };
}
export type MerchandiseOrderActionPermissions = ReturnType<typeof merchandiseOrderActionPermissions>;

export const COMPED_CANCEL_FINANCE_MESSAGE = "Cancelling a comped order needs finance access. Ask a finance administrator.";

/** Cancelling a comped order undoes a finance decision, so it needs finance access; cancelling an unpaid one does not. */
export function merchandiseOrderActionAllowed(action: MerchandiseOrderActionValue, status: MerchandiseOrderStatusValue, permissions: MerchandiseOrderActionPermissions) {
  if (action === "MARK_PAID") return permissions.canMarkPaid;
  if (action === "COMP") return permissions.canComp;
  return status === "COMPED" ? permissions.canMarkPaid : permissions.canCancel;
}

/** Which actions can still be taken on an order in this status, ignoring who is asking. */
export function availableMerchandiseOrderActions(status: MerchandiseOrderStatusValue): MerchandiseOrderActionValue[] {
  return (["MARK_PAID", "COMP", "CANCEL"] as const).filter((action) => ALLOWED_FROM[action].includes(status));
}

export function formatReceiptNumber(sequence: number) {
  return `M-${String(sequence).padStart(4, "0")}`;
}

/** The sequence in a receipt number such as M-0007, or null for anything else. */
export function receiptSequence(receiptNumber: string | null | undefined) {
  const match = /^M-(\d+)$/.exec(receiptNumber ?? "");
  return match ? Number(match[1]) : null;
}

/** "Cash", "Check #123", "Card (Square), ref …" or "Comped — no charge". */
export function merchandisePaymentMethodLine(input: { status: MerchandiseOrderStatusValue; method: string | null; reference: string | null }) {
  if (input.status === "COMPED") return "Comped — no charge";
  const label = input.method === "CASH" || input.method === "CHECK" || input.method === "CARD_REFERENCE" ? MERCHANDISE_RECORDED_METHOD_LABELS[input.method] : null;
  if (!label) return null;
  if (input.method === "CHECK") return input.reference ? `Check #${input.reference}` : "Check";
  if (input.method === "CARD_REFERENCE") return input.reference ? `${label}, ref ${input.reference}` : label;
  return label;
}

export const merchandiseActionWords: Record<MerchandiseOrderActionValue, string> = { MARK_PAID: "Marked paid", COMP: "Comped", CANCEL: "Cancelled" };
