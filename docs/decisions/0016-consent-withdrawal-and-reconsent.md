# 0016: Consent withdrawal and re-consent (#130)

Status: Proposed, owner to confirm.

## Context

Acknowledgment evidence (#150) records what a person was shown and that they agreed. Two more things happen in real life: a
person declines, and a person who agreed later withdraws, or a policy changes in a way that needs a fresh agreement. #130 adds
these to the existing evidence without a new consent model. This record writes down the rules the build follows so the owner
can confirm or change them.

## Decision (proposed)

1. **A material change requires a fresh agreement.** When a later policy version is marked a material change (the publisher's
   own flag, #129), a person who agreed to an earlier version has the status "Needs to acknowledge the updated policy" from the
   later version's effective date. A non-material change carries forward ("Acknowledged an earlier version"). The rule is
   declared in `modules/acknowledgments/reconsent-rule.ts` (`RECONSENT_RULE`), so changing it is a one-line, reviewable change
   and both settings are tested.
2. **Earlier consent stays valid evidence for its period.** Neither a material change nor a withdrawal rewrites or invalidates
   the earlier acceptance. Asked about a date before the change or the withdrawal, the answer is still "Acknowledged". Nothing
   is overwritten; the history only grows.
3. **Withdrawal is a new event.** A withdrawal is its own append-only record naming the acceptance it withdraws, with its own
   date, actor and channel. It changes the status from its date on. Accepting again afterward is another new record. A void
   (a correction of a mistaken record) stays separate from a withdrawal (the person changed their mind). A withdrawn
   acceptance cannot be voided; a mistake is corrected by recording a fresh act.
4. **Decline is recorded, and is not a withdrawal.** A decline is another evidence row: the person was shown the wording and
   said no. It is refused while an acceptance stands (withdraw it instead). Status is derived from the latest of the history,
   never stored.
5. **Decline and withdraw are staff-recorded only, for now.** An unticked box on the public form is not a decline. There is no
   online or attendee-portal decline or withdrawal until the owner decides how a person proves who they are for it.
6. **Paper location, not paper contents.** A paper record notes where the paper physically lives, never what it says. That
   location is read only by staff allowed to see sensitive data, and is kept out of audit rows, logs and exports.

## Not decided here

- Whether a withdrawal should ever block registration or check-in (today it only changes the derived status).
- Retention of evidence and withdrawals when an event is deleted (still refused while any exist, as for evidence).
- A separate record of what was presented, apart from the evidence row (deferred; the evidence already holds the exact text or
  the policy version by id).
