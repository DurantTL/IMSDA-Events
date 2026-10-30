export class EventOperationError extends Error {
  constructor(
    public readonly code: "EVENT_NOT_FOUND" | "EVENT_NOT_READY" | "EVENT_HAS_SPONSORED_PROMO_CODES" | "EVENT_BUSY" | "EVENT_CHANGED" | "EVENT_LIFECYCLE_REFUSED",
    message: string,
  ) {
    super(message);
    this.name = "EventOperationError";
  }
}
