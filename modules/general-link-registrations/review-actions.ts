/**
 * Which buttons a waiting team's card shows (#931). "Confirm <named club>" and "Attach to the chosen club" are the same action
 * whenever the club picked in the menu is the club the director named (or nothing is picked yet, which defaults to it), so the
 * card then shows one button. When another club is picked, the named club's confirm stays as a secondary button and attaching
 * to the picked club is the primary one. With no named club in the directory the one button attaches to the picked club.
 * Layout and labels only: what each button sends is decided here too, so it can be tested.
 */
export type PendingTeamButtons = {
  confirmNamed: { style: "primary" | "secondary"; organizationId: string } | null;
  attachChosen: { style: "primary"; action: "CONFIRM" | "REASSIGN"; organizationId: string } | null;
};

export function pendingTeamButtons(input: { suggestedId: string | null; choiceId: string }): PendingTeamButtons {
  const { suggestedId, choiceId } = input;
  const pickedIsSuggested = suggestedId !== null && (choiceId === suggestedId || choiceId === "");
  return {
    confirmNamed: suggestedId === null ? null : { style: pickedIsSuggested ? "primary" : "secondary", organizationId: suggestedId },
    attachChosen: pickedIsSuggested
      ? null
      : { style: "primary", action: choiceId === suggestedId ? "CONFIRM" : "REASSIGN", organizationId: choiceId },
  };
}
