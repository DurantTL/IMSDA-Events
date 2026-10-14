import type { ItemErrorCode } from "@/modules/issued-assets/domain";

export type AssetErrorCode =
  | ItemErrorCode
  | "EVENT_NOT_FOUND"
  | "TYPE_NOT_FOUND"
  | "TYPE_EXISTS"
  | "TYPE_MODE_LOCKED"
  | "ASSET_EXISTS"
  | "ASSET_IN_USE"
  | "ASSIGNEE_NOT_FOUND"
  | "REGISTRATION_NOT_ACTIVE"
  | "STAFF_NOT_ON_EVENT"
  | "ISSUANCE_NOT_FOUND"
  | "ISSUANCE_NOT_OPEN"
  | "SAME_HOLDER"
  | "SAME_ASSET"
  | "REPLACEMENT_TYPE_MISMATCH"
  | "IDEMPOTENCY_KEY_REUSED"
  | "ITEMS_REJECTED"
  | "CONFIGURE_REQUIRED"
  | "RANGE_INVALID"
  | "BUSY"
  // Slice 2 (#214): returns, deposits, charges, waivers and facility issues
  | "RETURN_REJECTED"
  | "DEPOSIT_NOT_FOUND"
  | "DEPOSIT_NOT_REQUIRED"
  | "DEPOSIT_COVER_INVALID"
  | "DEPOSIT_ALREADY_SETTLED"
  | "DEPOSIT_UNRESOLVED"
  | "CHARGE_NOT_FOUND"
  | "CHARGE_EXISTS"
  | "CHARGE_NOT_ALLOWED"
  | "CHARGE_ALREADY_WAIVED"
  | "CHARGE_NOT_POSTABLE"
  | "MONEY_PERMISSION_REQUIRED"
  | "FACILITY_NOT_FOUND"
  | "FACILITY_FINISHED"
  | "FACILITY_INVALID"
  | "BLOCK_EXISTS"
  | "BLOCK_REFUSED"
  | "CORRECTION_INVALID"
  | "DEPOSIT_ALREADY_KEPT"
  | "POLICY_INVALID";

/** Every refusal the issued-assets module makes. Free of server-only imports so any layer can catch it. */
export class AssetError extends Error {
  constructor(
    public readonly code: AssetErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export function assetErrorStatus(code: AssetErrorCode) {
  switch (code) {
    case "EVENT_NOT_FOUND":
    case "TYPE_NOT_FOUND":
    case "ASSET_NOT_FOUND":
    case "ASSIGNEE_NOT_FOUND":
    case "ISSUANCE_NOT_FOUND":
    case "DEPOSIT_NOT_FOUND":
    case "CHARGE_NOT_FOUND":
    case "FACILITY_NOT_FOUND":
      return 404;
    case "TYPE_EXISTS":
    case "TYPE_MODE_LOCKED":
    case "ASSET_EXISTS":
    case "ASSET_IN_USE":
    case "REGISTRATION_NOT_ACTIVE":
    case "STAFF_NOT_ON_EVENT":
    case "ISSUANCE_NOT_OPEN":
    case "SAME_HOLDER":
    case "SAME_ASSET":
    case "REPLACEMENT_TYPE_MISMATCH":
    case "IDEMPOTENCY_KEY_REUSED":
    case "ITEMS_REJECTED":
    case "ALREADY_ISSUED":
    case "INSUFFICIENT_QUANTITY":
    case "ASSET_UNAVAILABLE":
    case "TYPE_INACTIVE":
    case "ROOM_ASSIGNMENT_REQUIRED":
    case "ROOM_ASSIGNMENT_AMBIGUOUS":
    case "ROOM_ASSIGNMENT_INVALID":
    case "ROOM_ASSIGNMENT_MOVED":
    case "RETURN_REJECTED":
    case "DEPOSIT_NOT_REQUIRED":
    case "DEPOSIT_COVER_INVALID":
    case "DEPOSIT_ALREADY_SETTLED":
    case "DEPOSIT_UNRESOLVED":
    case "CHARGE_EXISTS":
    case "CHARGE_NOT_ALLOWED":
    case "CHARGE_ALREADY_WAIVED":
    case "CHARGE_NOT_POSTABLE":
    case "FACILITY_FINISHED":
    case "BLOCK_EXISTS":
    case "BLOCK_REFUSED":
    case "CORRECTION_INVALID":
      return 409;
    case "CONFIGURE_REQUIRED":
    case "MONEY_PERMISSION_REQUIRED":
    case "DEPOSIT_ALREADY_KEPT":
      return 403;
    case "BUSY":
      return 503;
    default:
      return 400;
  }
}
