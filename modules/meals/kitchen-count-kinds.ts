/** The kitchen count kinds and limits (#1029), apart from the rest of the counts module so a client component can import them without pulling in server code. */

export const kitchenCountKinds = ["PREPARED", "WASTED", "DONATED", "TRANSFERRED"] as const;
export type KitchenCountKind = (typeof kitchenCountKinds)[number];

export const kitchenCountKindLabels: Record<KitchenCountKind, string> = {
  PREPARED: "Prepared", WASTED: "Wasted", DONATED: "Donated", TRANSFERRED: "Transferred",
};

export const KITCHEN_COUNT_MAX = 100_000;
export const KITCHEN_NOTE_MAX = 500;
