/** The kitchen count kinds and limits (#1029), apart from the rest of the counts module so a client component can import them without pulling in server code. */

export const kitchenCountKinds = ["PREPARED", "WASTED", "DONATED", "TRANSFERRED"] as const;
export type KitchenCountKind = (typeof kitchenCountKinds)[number];

export const kitchenCountKindLabels: Record<KitchenCountKind, string> = {
  PREPARED: "Prepared", WASTED: "Wasted", DONATED: "Donated", TRANSFERRED: "Transferred",
};

export const KITCHEN_COUNT_MAX = 100_000;
export const KITCHEN_NOTE_MAX = 500;

/** The short definitions shown with the report's columns (screen and the counts page). Here, with the kinds, so a client component can show them too. */
export const kitchenColumnDefinitions = {
  ordered: "Ordered: café meal tickets sold for the service, on live registrations. Not a count of food.",
  served: "Served: meals the café scanner recorded as eaten. Comes only from the imported scanner results.",
  PREPARED: "Prepared: portions the kitchen made, as the kitchen entered them.",
  WASTED: "Wasted: prepared portions thrown away, as the kitchen entered them.",
  DONATED: "Donated: prepared portions given away outside the event, as the kitchen entered them.",
  TRANSFERRED: "Transferred: prepared portions sent to another service or group, as the kitchen entered them.",
  variance: "Variance: prepared minus served. Positive means more was made than eaten. Blank until prepared is entered.",
} as const;
