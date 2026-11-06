/**
 * The help paragraphs in the /account side cards, each with the number of lines it takes in the web font in the 272px
 * side column (two-column layout, 901px and wider). The page reserves that many lines so the cards below do not move
 * when the web font replaces the fallback (#1557, B17). The counts are measured in a browser; a wording change must
 * re-measure and update them (tests/font-swap-load-shift-1557.test.ts pins each one).
 */
export const ACCOUNT_CARD_INTRO = "Registrations connected to this verified email appear here.";

export const SECURITY_NOTES = {
  on: { text: "Two-step sign-in is on.", lines: 3 },
  club: { text: "Club rosters hold young people's birth dates, so they need an authenticator. Set one up to open your club.", lines: 5 },
  off: { text: "Two-step sign-in is off. Add an authenticator app for extra protection.", lines: 4 },
} as const;

export const HELP_NOTES = {
  withEvent: { text: "Open a registration to find its event team, arrangements and anything that needs a change.", lines: 3 },
  noEvent: { text: "Registered with a different email, or not sure where your registration is? We can help you find it.", lines: 3 },
} as const;
