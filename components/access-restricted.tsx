import Link from "next/link";
import { LockKeyhole } from "lucide-react";

/**
 * The shared "you do not have permission for this page" state (rule 14). It never names a hidden page. Help & learning
 * is open to every staff member (#1259), so it offers a permitted next step; the hub lists only the guides this person
 * may see. `whoToAsk` is required so no one is left at a dead end: pass the person who can actually grant access, such
 * as "your event administrator", "your club director" or "a system administrator". `detail` is one sentence on why and
 * should not repeat the ask.
 */
export function AccessRestricted({ title, detail, whoToAsk }: { title: string; detail: string; whoToAsk: string }) {
  return <section className="page-stack"><div className="forbidden-state panel"><span><LockKeyhole size={26} /></span><p className="eyebrow">Permission required</p><h2>{title}</h2><p>{detail}</p><p>Ask {whoToAsk} if you need access.</p><Link className="secondary-button forbidden-state-action" href="/help">Open Help &amp; learning</Link></div></section>;
}
