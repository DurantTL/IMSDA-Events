/** The JSON a "Send a private link" form posts (#1221). A coordinator's body has no roster member at all. */
export function clubFormLinkRequestBody(input: {
  templateKey: string;
  recipientEmail: string;
  rosterMemberId: string;
  subjectName: string;
  days: string;
  asAreaCoordinator: boolean;
}) {
  return {
    templateKey: input.templateKey,
    recipientEmail: input.recipientEmail,
    ...(input.asAreaCoordinator ? {} : { rosterMemberId: input.rosterMemberId || null }),
    subjectName: input.rosterMemberId ? undefined : input.subjectName || undefined,
    expiresInDays: Number(input.days) || undefined,
  };
}
