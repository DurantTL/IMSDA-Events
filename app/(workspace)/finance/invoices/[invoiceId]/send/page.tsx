import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessRestricted } from "@/components/access-restricted";
import { InvoiceSendView } from "@/components/invoice-send";
import { resolveEventContext } from "@/modules/events/selection";
import type { SettlementStatus } from "@/modules/invoices/delivery-domain";
import { getInvoiceSendPreview } from "@/modules/invoices/delivery-repository";
import { loadEventLedger } from "@/modules/invoices/ledger-repository";
import { InvoiceError } from "@/modules/invoices/repository";

export const metadata: Metadata = { title: "Send invoice" };
export const dynamic = "force-dynamic";

/**
 * The preview before an invoice is sent (#168): the exact recipients, the version and the message. Nothing is sent by
 * opening it. MANAGE_FINANCE on the event in the URL; a version that is not on this event is not found.
 */
export default async function SendInvoicePage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ event?: string; version?: string }> }) {
  const [{ invoiceId }, { event: requested, version }] = await Promise.all([params, searchParams]);
  const { event, permissions, user } = await resolveEventContext(requested);
  if (!permissions.includes("MANAGE_FINANCE")) {
    return <AccessRestricted title="Finance is restricted" detail="Only event administrators and finance managers can send invoices." whoToAsk="your event administrator" />;
  }
  if (!version) notFound();
  let preview;
  try {
    preview = await getInvoiceSendPreview(event.id, version);
  } catch (error) {
    if (error instanceof InvoiceError && (error.code === "VERSION_NOT_FOUND" || error.code === "EVENT_NOT_FOUND")) notFound();
    throw error;
  }
  // The version must belong to the invoice in the URL, as well as to the event.
  if (preview.invoiceId !== invoiceId) notFound();
  // Payment status for the header only (read-only); a failed read says it is unavailable.
  let settlement: SettlementStatus | "UNAVAILABLE" = "UNAVAILABLE";
  try {
    const [ledger] = await loadEventLedger(event.id, { invoiceId });
    if (ledger) settlement = ledger.settlement;
  } catch {
    settlement = "UNAVAILABLE";
  }
  return <InvoiceSendView preview={preview} settlement={settlement} viewerName={user.displayName} />;
}
