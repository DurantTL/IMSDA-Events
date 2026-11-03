/**
 * The declared re-consent rule (#130, ADR 0016): what happens to a person's earlier acknowledgment of a policy
 * version when a later version takes effect. It is configuration, not logic buried in the status code, so the rule is
 * visible, testable both ways, and changed in one place once the owner confirms it.
 *
 * Whether a change is material is never inferred: it is the publisher's flag, recorded when the version was published (#129).
 * Either way the earlier acknowledgment stays on record as evidence for the period it covered; the rule only decides what
 * the person's status is from the later version's effective date on.
 */
export type ReconsentAction = "REQUIRE_FRESH_AGREEMENT" | "CARRY_FORWARD";

export type ReconsentRule = {
  /** A later version the publisher marked a material change. */
  materialChange: ReconsentAction;
  /** A later version the publisher did not mark material. */
  nonMaterialChange: ReconsentAction;
};

export const RECONSENT_RULE: ReconsentRule = {
  materialChange: "REQUIRE_FRESH_AGREEMENT",
  nonMaterialChange: "CARRY_FORWARD",
};
