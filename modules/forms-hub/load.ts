import "server-only";

import { listClubFormsForHub } from "@/modules/club-forms/hub";
import { listInformationFormsForHub } from "@/modules/information-forms/hub";
import { sortFormsHubRows, type FormsHubRow } from "@/modules/forms-hub/rows";

/** Every non-registration form (#1151). The caller has already checked for a system administrator. */
export async function loadFormsHub(): Promise<FormsHubRow[]> {
  const [club, information] = await Promise.all([listClubFormsForHub(), listInformationFormsForHub()]);
  return sortFormsHubRows([...club, ...information]);
}
