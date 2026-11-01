import { formatPersonName } from "@/lib/person-name";
/**
 * Type-to-search for honors (#819). Pure, so the combobox and its tests share
 * one rule: a honor matches when every word typed is the start of some word in
 * its name, ignoring case and accents. "ab" finds "Abseiling - Advanced" and
 * "Aboriginal Lore", but not "Arab Culture" or "Lab Safety" (a match in the
 * middle of a word does not count).
 */

const wordsOf = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en-US")
    // An apostrophe joins, not splits: "Hiker's Guide" is the words "hikers" and "guide".
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function matchesWordPrefixes(text: string, query: string | undefined) {
  const typed = wordsOf(query ?? "");
  if (typed.length === 0) return true;
  const words = wordsOf(text);
  return typed.every((word) => words.some((candidate) => candidate.startsWith(word)));
}

/** Keeps the honors whose name has a word starting with each word typed. Blank keeps all. Never mutates the input. */
export function filterHonorsByWordPrefix<T extends { name: string }>(options: readonly T[], query: string | undefined): T[] {
  return options.filter((option) => matchesWordPrefixes(option.name, query));
}

export type ComboboxKeyState = { open: boolean; active: number; count: number };
export type ComboboxKeyResult = { open: boolean; active: number; choose: boolean; handled: boolean };

/**
 * What a key does in the honor combobox (#819), kept pure so it can be tested
 * without a browser. Arrow keys open the list and wrap through the matches,
 * Enter chooses the active match (and is left alone while the list is closed,
 * so a form can still submit), Escape closes an open list and is left alone
 * otherwise so an enclosing dialog can close, Tab closes without handling.
 */
export function comboboxKeyResult(key: string, state: ComboboxKeyState): ComboboxKeyResult {
  const last = Math.max(state.count - 1, 0);
  const keep = { open: state.open, active: Math.min(state.active, last), choose: false, handled: false };
  switch (key) {
    case "ArrowDown":
      return { ...keep, open: true, handled: true, active: state.open && state.count > 0 ? (keep.active + 1) % state.count : 0 };
    case "ArrowUp":
      return { ...keep, open: true, handled: true, active: state.open && state.count > 0 ? (keep.active - 1 + state.count) % state.count : last };
    case "Enter":
      return state.open && state.count > 0 ? { ...keep, choose: true, handled: true } : { ...keep, handled: state.open };
    case "Escape":
      return state.open ? { ...keep, open: false, handled: true } : keep;
    case "Tab":
      return { ...keep, open: false };
    default:
      return keep;
  }
}

export type ComboboxPlacementInput = {
  /** The input's top and bottom edges, in viewport pixels. */
  anchorTop: number;
  anchorBottom: number;
  /** The visible area the list may use (the window, or the dialog or scroll box around the field), in viewport pixels. */
  boundsTop: number;
  boundsBottom: number;
  /** The full height of the list if nothing limited it. */
  contentHeight: number;
};
export type ComboboxPlacement = { side: "below" | "above"; maxHeight: number };

/** The tallest the floating list gets (14rem), and the least it is squeezed to so a few choices still show. */
export const COMBOBOX_LIST_MAX_HEIGHT = 224;
export const COMBOBOX_LIST_MIN_HEIGHT = 96;
const COMBOBOX_LIST_GAP = 4;
const COMBOBOX_EDGE_MARGIN = 8;

/**
 * Where the floating honor/class list goes (the owner's Oct 13 request), kept
 * pure so it can be tested without a browser. It opens below the field when it
 * fits there (or when below has more room than above), otherwise above, and its
 * height is capped to the room on that side so it never runs off the screen or
 * out of the dialog around it. It scrolls inside itself past that.
 */
export function comboboxPopoverPlacement(input: ComboboxPlacementInput): ComboboxPlacement {
  const wanted = Math.min(Math.max(input.contentHeight, 0), COMBOBOX_LIST_MAX_HEIGHT);
  const below = input.boundsBottom - input.anchorBottom - COMBOBOX_LIST_GAP - COMBOBOX_EDGE_MARGIN;
  const above = input.anchorTop - input.boundsTop - COMBOBOX_LIST_GAP - COMBOBOX_EDGE_MARGIN;
  const side = below >= wanted || below >= above ? "below" : "above";
  const room = side === "below" ? below : above;
  return {
    side,
    maxHeight: Math.floor(Math.max(COMBOBOX_LIST_MIN_HEIGHT, Math.min(COMBOBOX_LIST_MAX_HEIGHT, room))),
  };
}

/** The bulk popup's member search: first and last name, from the start of any word. */
export function filterPeopleByWordPrefix<T extends { firstName: string; lastName: string }>(people: readonly T[], query: string | undefined): T[] {
  return people.filter((person) => matchesWordPrefixes(formatPersonName(person), query));
}
