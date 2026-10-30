import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { firstParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "People & access" };

/** Accounts moved into People & access (#1275); the search carries over. */
export default async function AttendeeAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = firstParam(q)?.trim().slice(0, 120);
  redirect(query ? `/admin/people?q=${encodeURIComponent(query)}` : "/admin/people");
}
