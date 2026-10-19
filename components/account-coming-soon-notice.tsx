/** One wording everywhere an account is offered: accounts work today, more is coming, and none is ever needed to register. */
export const ACCOUNT_COMING_SOON_TEXT =
  "Accounts are new: you can make one now, and more account features are coming soon. You don't need an account to register for an event: your confirmation code works, and you can ask for a new private link at any time.";

export function AccountComingSoonNotice() {
  return <p className="inline-notice account-coming-soon-notice">{ACCOUNT_COMING_SOON_TEXT}</p>;
}
