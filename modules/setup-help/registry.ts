/**
 * Shows each full "How to set this up" panel once per page (#1434, reused by #1435). A page makes one registry per
 * render and each panel claims its key; the first claim in render order shows the steps, later ones show a short link
 * to them. It holds keys only, no text, and it is made fresh for every render.
 */
export type SetupHelpRegistry = { claim(key: string): boolean };

export function createSetupHelpRegistry(): SetupHelpRegistry {
  const shown = new Set<string>();
  return {
    claim(key) {
      if (shown.has(key)) return false;
      shown.add(key);
      return true;
    },
  };
}

/** The id of the steps list of the first panel for a key, which the later links point at. */
export const setupHelpAnchor = (key: string) => `setup-help-${key}`;
