import { parsePageParam } from "@/lib/pagination";
import { firstParam } from "@/lib/search-params";
import { MESSAGE_TEMPLATE_KEYS } from "@/modules/communications/templates";
import type { MessageOutboxStatusValue } from "@/modules/communications/types";

/** The pure half of the Delivery log (#1492): reading the address, the where-clause and the order. Client-safe. */

/** Delivery-log rows per page (#702). The log is paged in the database, so every message is reachable (#1492). */
export const DELIVERY_PAGE_SIZE = 50;

/** The status chips, in the order they are shown. "ALL" is no status filter. */
export const DELIVERY_FILTERS: ReadonlyArray<"ALL" | MessageOutboxStatusValue> = ["ALL", "PENDING", "CAPTURED", "FAILED", "SUPPRESSED", "SENT", "CANCELLED"];

export type DeliveryLogQuery = { status: "ALL" | MessageOutboxStatusValue; page: number };

export const DEFAULT_DELIVERY_QUERY: DeliveryLogQuery = { status: "ALL", page: 1 };

/** Reads `?status=` and `?page=`: anything that is not a listed status is "All", anything that is not a positive whole number is page 1. */
export function parseDeliveryQuery(params: { status?: unknown; page?: unknown }): DeliveryLogQuery {
  const status = firstParam(params.status);
  const page = firstParam(params.page);
  return {
    status: typeof status === "string" && (DELIVERY_FILTERS as readonly string[]).includes(status) ? (status as DeliveryLogQuery["status"]) : "ALL",
    page: parsePageParam(typeof page === "string" ? page : null),
  };
}

/**
 * The event's own messages, optionally one status. Rows that carry an event id but are not event messages (invoice delivery,
 * form submissions, account email) are left out here, in the database, so the total, the status counts and the page all
 * agree: the same conditions as `isEventScopedMessage`.
 */
export function buildDeliveryWhere(eventId: string, status: DeliveryLogQuery["status"] | "ANY" = "ALL") {
  return {
    eventId,
    templateKey: { in: [...MESSAGE_TEMPLATE_KEYS] },
    recipientKind: { not: "ACCOUNT" },
    ...(status === "ALL" || status === "ANY" ? {} : { status }),
  };
}

/** Newest first, then id so rows created in the same instant keep one order from page to page. */
export const DELIVERY_ORDER_BY = [{ createdAt: "desc" }, { id: "desc" }] as const;

/** What the log reports about itself next to the page of messages. */
export type DeliveryLogMeta = { total: number; page: number; pageSize: number; status: DeliveryLogQuery["status"] };
