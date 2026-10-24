/** One item in Club Home's "Continue club work" list (#743, #1166). */
export type ClubHomeStep = {
  key: string;
  text: string;
  /** One line of explanation under the task (what is saved, what is blank); never invented requiredness. */
  detail?: string;
  href: string;
  action: string;
  /** Hidden text after the action, so repeated links ("Continue form") have distinct names for assistive technology. */
  actionContext?: string;
  danger?: boolean;
};
