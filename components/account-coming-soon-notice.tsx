/** One wording everywhere an account is offered: accounts work today, more is coming, and none is ever needed to register. */
export const ACCOUNT_COMING_SOON_TEXT =
  "Accounts are new: you can make one now, and more account features are coming soon. You never need an account to register; your confirmation code or private email link always works.";

export function AccountComingSoonNotice() {
  return <p className="inline-notice account-coming-soon-notice">{ACCOUNT_COMING_SOON_TEXT}</p>;
}
