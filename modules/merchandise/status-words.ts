import type { StatusWord } from "@/modules/registrations/status-words";

/** Client-safe: no node: or server-only imports, so browser components can use these. */
export type MerchandiseOrderStatusValue = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED" | "COMPED";

/** The shared status word for a merchandise order (#1479, rule B12). Display only: the stored values do not change. */
export const merchandiseOrderStatusWords = {
  PENDING: "Pending payment",
  PAID: "Confirmed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  // Rule B12: no new word. A comped order is confirmed; the staff panel adds "No charge".
  COMPED: "Confirmed",
} as const satisfies Record<MerchandiseOrderStatusValue, StatusWord>;
