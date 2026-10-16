/**
 * The "covered by the church code" tick on the roster form (#961). Pure, so the form and its tests share one rule.
 *
 * Tick mode applies only to a church-sponsored code the holder (the person who typed it first) has applied. An ordinary
 * code leaves everyone with their own text input, as before (#397).
 */

export function normalizeTickCode(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toUpperCase() : "";
}

/** Whether everyone else is a tick: the holder's code is applied and church-sponsored. */
export function isChurchTickMode(input: {
  sharedCode: string;
  /** The codes the last quote applied (normalized). */
  appliedCodes: readonly string[];
  /** Sponsoring church by normalized code, from the quote. */
  sponsors: Record<string, string> | undefined;
}) {
  return Boolean(
    input.sharedCode
    && input.appliedCodes.includes(input.sharedCode)
    && input.sponsors?.[input.sharedCode],
  );
}

export type PersonPromoView = "INPUT" | "TICK" | "CONFLICT";

/**
 * What a person's promo field shows. The holder, and everyone outside tick mode, keep the text input. In tick mode
 * a non-holder is a tick, unless they carry a different code (a restored draft): that shows the text input with a conflict.
 */
export function personPromoView(input: {
  tickMode: boolean;
  isHolder: boolean;
  sharedCode: string;
  value: unknown;
}): PersonPromoView {
  if (!input.tickMode || input.isHolder) return "INPUT";
  const value = normalizeTickCode(input.value);
  return value !== "" && value !== input.sharedCode ? "CONFLICT" : "TICK";
}

/**
 * The attendees whose code follows the holder when the holder's code changes or is removed: everyone else who has a code.
 * Returns the indexes to rewrite and the code they take.
 */
export function ticksToRewrite(input: {
  values: readonly unknown[];
  holderIndex: number;
  nextCode: unknown;
}) {
  const code = normalizeTickCode(input.nextCode);
  const indexes = input.values.flatMap((value, index) => (
    index !== input.holderIndex && normalizeTickCode(value) !== "" && normalizeTickCode(value) !== code ? [index] : []
  ));
  return { indexes, code };
}
