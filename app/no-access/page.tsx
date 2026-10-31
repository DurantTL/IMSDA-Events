import { staffLoginRedirectPath } from "@/modules/access/login-redirect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldX } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { getCurrentSession } from "@/modules/access/current-session";
import { EVENT_PICKER_PATH } from "@/modules/access/login-routing";
import { noAccessCopy } from "@/modules/access/no-access-copy";
import { listEventsForUser } from "@/modules/events/repository";

export const metadata: Metadata = { title: "No event access", robots: { index: false, follow: false } };

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const session = await getCurrentSession();
  if (!session.user) redirect(await staffLoginRedirectPath());
  if (session.user.globalRole === "SYSTEM_ADMIN") redirect("/event-setup");
  const { from } = await searchParams;
  // Event Admins and anyone working in an event are sent here from the event-creation pages (#1411).
  const hasEvents = (await listEventsForUser(session.user.id, false)).length > 0;
  const copy = noAccessCopy({ from: typeof from === "string" ? from : null, hasEvents, email: session.user.email });
  return <main className="auth-page"><section className="auth-card no-access-card"><div className="auth-brand"><BrandMark /><span><strong>IMSDA</strong><small>Events</small></span></div><span className="access-state-icon"><ShieldX size={28} /></span><div className="auth-heading"><p className="eyebrow">Access needed</p><h1>{copy.heading}</h1><p>{copy.body}</p></div>{copy.showEvents && <Link className="primary-button full-button" href={EVENT_PICKER_PATH}>Back to your events</Link>}<Link className="secondary-button full-button" href="/help">Read the Help guides</Link><SignOutButton className="secondary-button full-button" /></section></main>;
}
