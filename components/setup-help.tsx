import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { setupHelpAnchor, type SetupHelpRegistry } from "@/modules/setup-help/registry";
import { isInAppSetup, type SetupHelp } from "@/modules/setup-help/types";
import styles from "./setup-help.module.css";

/** Where the longer guides live. The steps themselves are never repeated there (`modules/setup-help/system-setup-steps.ts`). */
const DOCS_BASE = "https://github.com/DurantTL/IMSDA-Events/blob/main/";

/**
 * What to do about something that is "not set up" (#1434, and #1435 for event admins, club directors and area
 * coordinators). In-app setup is a **Set up** link to the page that fixes it. Anything else is a **How to set this up**
 * panel that opens in place: numbered steps, the setting names to add (names only, never a value), a link to the longer
 * guide and what the row will show once it works. It has no state and no client code, so it works without JavaScript.
 *
 * `whoToAsk` is the seam for #1435's "ask your system administrator" line: it shows under the panel when only
 * someone else can fix it.
 */
export function SetupHelpPanel({
  setup,
  context,
  whoToAsk,
  heading = "How to set this up",
  registry,
  setupKey,
}: {
  setup: SetupHelp;
  /** What this is for ("Security check"), read out after the link or summary so several of them are told apart. */
  context?: string;
  whoToAsk?: string;
  heading?: string;
  /**
   * With a registry and a key, the full panel shows once per page (the first one in render order) and any later one
   * for the same key is a short link to it, so the same steps are not repeated down a long page.
   */
  registry?: SetupHelpRegistry;
  setupKey?: string;
}) {
  if (isInAppSetup(setup)) {
    return (
      <div className={styles.setup} data-setup-help="link">
        <Link className="text-button" href={setup.href}>
          {setup.label ?? "Set up"}
          {context && <span className="sr-only"> {context}</span>} <ArrowRight aria-hidden="true" size={14} />
        </Link>
        {whoToAsk && <p className={styles.ask}>{whoToAsk}</p>}
      </div>
    );
  }
  const first = registry && setupKey ? registry.claim(setupKey) : true;
  if (!first && setupKey) {
    return (
      <div className={styles.setup} data-setup-help="again">
        <a className="text-button" href={`#${setupHelpAnchor(setupKey)}`}>
          {heading}{context && <span className="sr-only"> for {context}</span>} <ArrowRight aria-hidden="true" size={14} />
        </a>
        <span className={styles.again}> Same steps as the first one above.</span>
      </div>
    );
  }
  return (
    <div className={styles.setup} data-setup-help="steps">
      <details className={`attendee-reg-action ${styles.disclosure}`}>
        <summary>
          <span>{heading}{context && <span className="sr-only"> for {context}</span>}</span>
          <ChevronDown aria-hidden="true" size={16} />
        </summary>
        <div className={`attendee-reg-action-panel ${styles.panel}`}>
          <ol className={styles.steps} id={setupKey ? setupHelpAnchor(setupKey) : undefined}>
            {setup.steps.map((step, index) => <li key={index}>{step}</li>)}
          </ol>
          {setup.settingNames.length > 0 && (
            <>
              <h4 className={styles.subhead}>Settings to add (names only)</h4>
              <ul className={styles.names}>
                {setup.settingNames.map((name) => <li key={name}><code>{name}</code></li>)}
              </ul>
            </>
          )}
          <p className={styles.done}><strong>When it works: </strong>{setup.whenDone}</p>
          {setup.docsLink && (
            <p className={styles.docs}>
              <a className="text-button" href={`${DOCS_BASE}${setup.docsLink}`} rel="noreferrer" target="_blank">Longer guide: {setup.docsLink}</a>
            </p>
          )}
          {whoToAsk && <p className={styles.ask}>{whoToAsk}</p>}
        </div>
      </details>
    </div>
  );
}
