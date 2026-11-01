import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { SetupHelpPanel } from "@/components/setup-help";
import { setupHelpAnchor } from "@/modules/setup-help/registry";
import { clubSetupFor, type ClubSetupId } from "@/modules/setup-help/club-setup-steps";
import { coordinatorSetupFor, type CoordinatorSetupId } from "@/modules/setup-help/coordinator-setup-steps";
import styles from "./role-setup-help.module.css";
import { guideHrefFor, type RoleSetupEntry } from "@/modules/setup-help/role-setup";

/**
 * The setup help under a club director's or area coordinator's "not set up / missing / blocked" state (#1435): the
 * shared #1434 panel (a **Set up** link, or **How to do this** steps, and who to ask) plus a link to the Help guide.
 * The words live in `modules/setup-help/*-setup-steps.ts`; a page only names an id. No client code.
 */
export function RoleSetupHelp({
  entry,
  context,
  guideHref = guideHrefFor(entry),
  setupKey,
  sameAs,
}: {
  entry: RoleSetupEntry;
  context?: string;
  /** Overrides where the Help guide opens; `null` shows no guide link. */
  guideHref?: string | null;
  /** Names this panel's steps so a later panel on the same page can point at them (`sameAs`) instead of repeating them. */
  setupKey?: string;
  sameAs?: string;
}) {
  if (sameAs) {
    return (
      <div className={styles.help} data-role-setup-help="">
        <a className="text-button" href={`#${setupHelpAnchor(sameAs)}`}>
          How to do this{context && <span className="sr-only"> for {context}</span>} <ArrowRight aria-hidden="true" size={14} />
        </a>
        <span>Same steps as the first one above.</span>
      </div>
    );
  }
  return (
    <div className={styles.help} data-role-setup-help="">
      <SetupHelpPanel context={context} heading="How to do this" setup={entry.setup} setupKey={setupKey} whoToAsk={entry.whoToAsk} />
      {guideHref && (
        <Link className={`text-button ${styles.guide}`} href={guideHref}>
          <BookOpen aria-hidden="true" size={14} /> <span>Help guide{context && <span className="sr-only"> for {context}</span>}</span>
        </Link>
      )}
    </div>
  );
}

export function ClubSetupHelp({ id, base, context }: { id: ClubSetupId; base: string; context?: string }) {
  return <RoleSetupHelp context={context} entry={clubSetupFor(id, base)} />;
}

export function CoordinatorSetupHelp({ id, context }: { id: CoordinatorSetupId; context?: string }) {
  return <RoleSetupHelp context={context} entry={coordinatorSetupFor(id)} />;
}
