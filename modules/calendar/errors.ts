export class CalendarError extends Error {
  constructor(
    public readonly code:
      | "ENTRY_NOT_FOUND"
      | "EVENT_NOT_FOUND"
      | "INVALID_REPEAT"
      | "FEED_NOT_FOUND"
      | "INVALID_FEED"
      | "FEED_FETCH_FAILED"
      | "FEED_SECRET_MISSING"
      | "NOT_IMPORTED"
      // Calendar items and registration events (#445)
      | "NOT_LINKABLE"
      | "ENTRY_ALREADY_LINKED"
      | "NOT_LINKED"
      | "EVENT_ARCHIVED"
      | "DATES_CHANGED"
      | "DATES_CONFLICT"
      | "ENTRY_REQUIRED"
      | "UPDATE_NEEDS_SINGLE_LINK",
    message: string,
  ) {
    super(message);
    this.name = "CalendarError";
  }
}
