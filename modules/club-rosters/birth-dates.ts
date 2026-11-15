import "server-only";

import { DataKeyUnavailableError, openData, sealData } from "@/lib/secret-box";

/**
 * The only place roster birth dates are sealed or opened (ADR 0005 Addendum
 * A). The purpose string gives them their own derived key. Birth dates are
 * personal data, so they use the personal-data key (#1652); a value sealed
 * with the sign-in key before the move still opens.
 */
const BIRTH_DATE_PURPOSE = "club-roster:birth-date";

export function sealBirthDate(birthDate: string) {
  return sealData(birthDate, BIRTH_DATE_PURPOSE);
}

export function openBirthDate(sealed: string) {
  return openData(sealed, BIRTH_DATE_PURPOSE);
}

export { BIRTH_DATE_LOCKED_ACTION_MESSAGE, BIRTH_DATE_LOCKED_TEXT } from "@/modules/club-rosters/birth-dates-text";

export type BirthDateOrLocked = { locked: false; birthDate: string } | { locked: true };

/**
 * Opens a birth date, or says it is locked when the personal-data key is not loaded. Any other failure
 * (a value that cannot be decrypted) still throws, as `openBirthDate` does.
 */
export function openBirthDateOrLocked(sealed: string): BirthDateOrLocked {
  try {
    return { locked: false, birthDate: openBirthDate(sealed) };
  } catch (error) {
    if (error instanceof DataKeyUnavailableError) return { locked: true };
    throw error;
  }
}

/**
 * The birth date, or null when there is none or it is locked. A locked birth date behaves like an unknown one
 * (an age of null), so registration, guards and lists carry on.
 */
export function openBirthDateOrNull(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const opened = openBirthDateOrLocked(sealed);
  return opened.locked ? null : opened.birthDate;
}

export function isBirthDateLocked(sealed: string | null | undefined) {
  return Boolean(sealed) && openBirthDateOrLocked(sealed as string).locked;
}
