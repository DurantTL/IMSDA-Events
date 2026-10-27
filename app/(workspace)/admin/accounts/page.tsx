import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "People & access" };

/** Accounts moved into People & access (#1275); the search carries over. */
export default async function AttendeeAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim().slice(0, 120);
  redirect(query ? `/admin/people?q=${encodeURIComponent(query)}` : "/admin/people");
}
