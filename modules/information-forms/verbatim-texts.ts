/**
 * Word-for-word texts the information form refusal check lets through (#1222, Caleb's decision of October 26). Each is
 * conference-approved wording copied from the Adventurer club forms; some contain words the sensitive-text check reads as
 * a health or family question ("parents", "insurance", "without limitation") though nothing here asks one.
 *
 * A text is exempt only when a description, section text, label or help text is EXACTLY one of these (whitespace
 * normalized, nothing else): no substring or prefix matching, so any edit brings the normal check back. Field keys,
 * types, options and every other refusal are unaffected. No imports, so the templates and the check can share it.
 */

export const ADVENTURER_PURPOSE_STATEMENT = "The purpose of having an Adventurer Program is to provide opportunities for parents and children to work together for the purpose of bonding, nurturing, and strengthening the family unit for the good of its children. The program is designed for children pre-school age through grade 4 along with their parents. We, the undersigned, have read, understand, and are in full agreement with the purpose of Adventuring and agree to support this program throughout those means with which the Lord has blessed this church including finances, staff volunteers, securing a place to meet, transportation on outings, and other such needs as may arise in the fulfillment of this ministry and to assist and support the work of the Adventurer ministry in the conference.";

export const ADVENTURER_ANNUAL_INTRO = "To be completed and submitted to the conference office each school year before October 1 by the Adventurer Leader. This form registers your club with the conference office for the current year, updates contact information for newsletters, qualifies your club to be invited to conference-wide Adventurer events, and ensures Adventurer participants are added to the conference insurance.";

export const ADVENTURER_PHOTO_RELEASE_TEXT = "I hereby grant permission and authorize the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Adventurer Clubs the irrevocable right to use, reproduce and publish photographs and videos taken of me and/or the undersigned minor children, and our names, for use for all purposes, in any form, and in any and all media, including, without limitation, printed publications, websites, and outreach purposes, in any manner or in any medium. I understand that such photographs and video recordings of me may be placed on the Internet. I release the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Adventurer Clubs from any expectation of confidentiality for the undersigned minor children and myself and attest that I am the parent or legal guardian of the children listed below and that I have the authority to consent and allow the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Adventurer Clubs to use their photographs, videos, and names. I acknowledge that since participation is voluntary, neither the minor children nor I will receive any financial compensation. I agree that participation in any publication and website produced by the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Adventurer Clubs confers no rights of ownership to me whatsoever and I hereby waive the right to approve the final product. I release the Iowa-Missouri Conference of Seventh-day Adventists, its affiliated Adventurer Clubs, its contractors, and its employees from liability for any claims by me or any third party in connection with my participation or the participation of the undersigned minor children. I agree that all such portraits, pictures, photographs, video and audio recordings, and any reproductions thereof, and all plates, negatives, recording tape and digital files are and shall remain the property of the Iowa-Missouri Conference of Seventh-day Adventists and its affiliated Adventurer Clubs. This release is binding on me and my heirs, assigns and personal representatives.";

export const ADVENTURER_PARENT_GUARDIAN_NAME_LABEL = "Parent/Guardian Name";
export const ADVENTURER_PARENT_GUARDIAN_SIGNATURE_LABEL = "Parent/Guardian Signature";
export const ADVENTURER_CHILD_PARENT_ACTIVITY_LABEL = "Held a Child/Parent activity?";

export const VERBATIM_ALLOWED_TEXTS: readonly string[] = [
  ADVENTURER_PURPOSE_STATEMENT,
  ADVENTURER_ANNUAL_INTRO,
  ADVENTURER_PHOTO_RELEASE_TEXT,
  ADVENTURER_PARENT_GUARDIAN_NAME_LABEL,
  ADVENTURER_PARENT_GUARDIAN_SIGNATURE_LABEL,
  ADVENTURER_CHILD_PARENT_ACTIVITY_LABEL,
];

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

const allowed = new Set(VERBATIM_ALLOWED_TEXTS.map(normalizeWhitespace));

/** True only when the WHOLE text equals an allowlisted string (whitespace normalized). */
export function isVerbatimAllowedText(text: string | undefined | null): boolean {
  return typeof text === "string" && allowed.has(normalizeWhitespace(text));
}
