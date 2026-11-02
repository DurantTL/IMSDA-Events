/** The controlled fields of the registrant lodging form (B6, #1468). */
export type LodgingFormValues = {
  category: string;
  firstNight: string;
  lastNight: string;
  partySize: number;
  roomCount: number;
  bringsExtraBedding: boolean;
};

type LoadedView = {
  nights: readonly string[];
  people: readonly unknown[];
  request: null | {
    category?: string | null;
    firstNight?: string | null;
    lastNight?: string | null;
    partySize?: number | null;
    roomCount?: number | null;
    bringsExtraBedding?: boolean | null;
  };
};

/** The values the form starts with for a view: the saved request, or the defaults. Also used for the last-saved view. */
export function lodgingFormValuesFor(view: LoadedView): LodgingFormValues {
  const request = view.request;
  return {
    category: request?.category ?? "",
    firstNight: request?.firstNight ?? view.nights[0] ?? "",
    lastNight: request?.lastNight ?? view.nights[view.nights.length - 1] ?? "",
    partySize: request?.partySize ?? Math.max(1, view.people.length),
    roomCount: request?.roomCount ?? 1,
    bringsExtraBedding: request?.bringsExtraBedding ?? false,
  };
}

/** True when any controlled value differs from the loaded or last-saved one. Putting a value back makes it clean again. */
export function lodgingFormChanged(current: LodgingFormValues, saved: LodgingFormValues): boolean {
  return (Object.keys(saved) as Array<keyof LodgingFormValues>).some((key) => current[key] !== saved[key]);
}

/** The uncontrolled lodging fields, which only the form's change event can see. */
export const lodgingUncontrolledFields: readonly string[] = ["householdPreference", "privateRoomRequested", "groundFloorNeeded", "accessibleRoomNeeded"];
