import Link from "next/link";
import { LockKeyhole } from "lucide-react";

/**
 * The shared "you do not have permission for this page" state. It never names a hidden page. Help & learning is open
 * to every staff member (#1259), so it offers a permitted next step; the hub lists only the guides this person may see.
 */
export function AccessRestricted({ title, detail }: { title: string; detail: string }) {
  return <section className="page-stack"><div className="forbidden-state panel"><span><LockKeyhole size={26} /></span><p className="eyebrow">Permission required</p><h2>{title}</h2><p>{detail}</p><Link className="secondary-button forbidden-state-action" href="/help">Open Help &amp; learning</Link></div></section>;
}
