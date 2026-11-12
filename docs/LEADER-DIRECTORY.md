# Leader directory (#1707)

An optional page where club directors, deputies and Area Coordinators can look up other clubs' leaders.

## The switch

- Platform settings has a "Leader directory" on/off setting. It is **off by default**, and with it off, a signed-in
  account that is not allowed in gets "not found" (signed-out visitors go to sign-in, and an account that still owes the
  second step goes to the code step first), and nothing new appears in the account menu. Site rule DR1 in
  `docs/SITE-RULES.md` records this.
- Only a system administrator can change it. Each change is written to the audit log with the old and new value, and the
  platform settings row keeps when it was last changed and by whom.
- No email announces it.

## Who can open it

Only while the switch is on, and only for a signed-in account (second step passed) that is:

- an active club director or deputy on at least one active club, or
- an Area Coordinator with an active grant.

A registrar or reporter alone, a plain attendee, a signed-out visitor, and staff "acting as" a role cannot open it. The
server checks this on every request.

## Who is listed and what is shown

- Every active, unrevoked, in-date club leader grant (director, deputy, registrar, reporter) on an active club is listed,
  **unless that leader opted out**. A leader in two clubs appears once per club.
- Each entry shows the leader's name, club and role, and the email and phone only if that leader chose to share them. The
  database read selects only those fields.
- Search matches a name or a club name; there is an optional role filter.
- Each page view is audited with counts and filter keys only, never a name or the search text.

## A leader's choices

Anyone with an active club leader role sees a "Leader directory" section on their profile, even while the switch is off, so
they can opt out before the directory goes live.

- "List me in the leader directory": on by default. Off removes the leader from the page and its search results at once.
- "Share my email": on by default (the email they sign in with).
- "Share my phone": off by default (the phone in their usual details).

With no saved choice a leader has these defaults. Saving a choice writes an audit entry holding only the three yes/no
values.
