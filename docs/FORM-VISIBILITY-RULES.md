# Form visibility rules: All / Any groups (#1072)

A question can be shown only when its rule is true. A rule is one **flat group**: one or more conditions
(question / condition / answer) joined by **All of these are true** or **Any of these is true**. There are no nested
groups. **Required unless** (`optionalWhen`) is a separate setting and is unchanged.

## Storage and mixed-version reading

Form definitions are JSON, so no database migration is involved. A field carries at most one of:

- `conditional`: the original single condition. Every form and every published version saved before groups existed
  uses only this.
- `conditionalGroup`: `{ match: "ALL" | "ANY", conditions: [...] }`, written by the builder only when a question has
  two or more conditions. The schema rejects a field that has both.

`modules/forms/visibility-rule.ts` is the one reader. A single `conditional` is read at read time as an **All group of
one**, so it evaluates exactly as it always did, in the builder it opens as an "All" rule with one condition, and
nothing is rewritten. Removing conditions down to one writes the single `conditional` back; removing the last clears
the rule.

Published versions are immutable and registrations stay pinned to the version they were made on. Old versions keep
their `conditional` rules untouched, new drafts may use `conditionalGroup`, and both are evaluated by the same
`isFieldVisible`. Nothing rewrites a published version, a registration's stored definition or an answer.

## Evaluation

`isFieldVisible` (the single source for pricing, capacity, validation, preview, reporting and pruning) evaluates All as
every member and Any as at least one. A hidden question's answer is dropped before validation, pricing and capacity,
exactly as for a single rule. A group with no conditions (rejected by the schema) fails open and shows the question.

## Validation (every member)

The definition schema, the builder, and the Rule summary use `visibilityRuleProblems`:

- every member names a real question that is not the question itself;
- a registration-level question cannot depend on an attendee answer;
- an address or calculated total can only be checked as answered; operators come from the fixed list;
- Equals and Includes need an answer;
- a question stays after every controller (order), and a rule cannot depend on itself through other rules (cycle);
- a group is not empty.

A single `conditional` saved before groups is held only to the checks it always had (a real other question, scope),
so a stored form still parses. The stricter checks apply to groups, and the builder shows all of them.

## Copy and remap

Adding a ready-made module, inserting a palette entry, or copying a saved library question remaps **every** member to
the copy's new keys. If any member of a library question's rule points at a question that was not part of the saved
item, the whole rule is dropped (never half-kept, which would change what All or Any means), the question becomes
optional, and the builder shows the notice. Deleting a question in the club form builder removes the members that
named it.

## Sensitive and filter disclosure

`isLinkedToBlockedField` follows every member, up (controllers) and down (dependents), so the answer filter and the
check-in book treat a question wired to a sensitive question through any member as sensitive. The public draft and the
registration PDF leave out a question when any member's controller is excluded. A form being visible is never
authorization or operational eligibility.

## Rule summary

The builder's **Rule summary** tab lists every question that only shows sometimes with an **Edit rule** link. A rule
that depends on a removed question is flagged **Needs a fix** with a **Fix rule** link.
