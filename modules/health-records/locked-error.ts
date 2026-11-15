import { DataKeyUnavailableError } from "@/lib/secret-box";

/**
 * The personal-data key is unavailable while a record is opened (#1652). Carries the member's and club's names, which are
 * not protected, so a page can still say whose record is locked. Never a value.
 */
export class HealthRecordLockedError extends DataKeyUnavailableError {
  constructor(public readonly memberName: string, public readonly clubName: string) {
    super("Health records are locked right now.");
  }
}
