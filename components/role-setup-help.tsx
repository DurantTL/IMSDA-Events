import Link from "next/link";
import { BookOpen } from "lucide-react";
import { SetupHelpPanel } from "@/components/setup-help";
import { clubSetupFor, type ClubSetupId } from "@/modules/setup-help/club-setup-steps";
import { coordinatorSetupFor, type CoordinatorSetupId } from "@/modules/setup-help/coordinator-setup-steps";
import styles from "./role-setup-help.module.css";
import { portalGuideHref, type RoleSetupEntry } from "@/modules/setup-help/role-setup";

/**
 * The setup help under a club director's or area coordinator's "not set up / missing / blocked" state (#1435): the
 * shared #1434 panel (a **Set up** link, or **How to do this** steps, and who to ask) plus a link to the Help guide.
 * The words live in `modules/setup-help/*-setup-steps.ts`; a page only names an id. No client code.
 */
function RoleSetupHelp({ entry, context }: { entry: RoleSetupEntry; context?: string }) {
  return (
    <div className={styles.help} data-role-setup-help="">
      <SetupHelpPanel context={context} heading="How to do this" setup={entry.setup} whoToAsk={entry.whoToAsk} />
      <Link className="text-button" href={portalGuideHref(entry.guideId)}>
        <BookOpen aria-hidden="true" size={14} /> Help guide{context && <span className="sr-only"> for {context}</span>}
      </Link>
    </div>
  );
}

export function ClubSetupHelp({ id, base, context }: { id: ClubSetupId; base: string; context?: string }) {
  return <RoleSetupHelp context={context} entry={clubSetupFor(id, base)} />;
}

export function CoordinatorSetupHelp({ id, context }: { id: CoordinatorSetupId; context?: string }) {
  return <RoleSetupHelp context={context} entry={coordinatorSetupFor(id)} />;
}
