/**
 * Where "Switch club" (#1759) sends a coordinator: the same tab on the chosen club. The club's honors, forms, awards and
 * month pages carry over; a single form submission goes to the forms list (it belongs to the old club); anything else
 * (the home, a hash tab, an unknown page) goes to the chosen club's home. Pure, so it is tested without a browser.
 */
export function switchClubHref(pathname: string | null | undefined, targetClubId: string): string {
  const base = `/account/area/${encodeURIComponent(targetClubId)}`;
  const match = /^\/account\/area\/[^/]+((?:\/[^/]+)*)\/?$/.exec(pathname ?? "");
  const rest = match?.[1] ?? "";
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 1 && ["honors", "forms", "awards"].includes(parts[0]!)) return `${base}/${parts[0]}`;
  if (parts[0] === "forms" && parts.length > 1) return `${base}/forms`;
  if (parts.length === 2 && parts[0] === "reports" && /^\d{4}-\d{2}$/.test(parts[1]!)) return `${base}/reports/${parts[1]}`;
  return base;
}

export type SwitchableClub = { id: string; name: string; church: string | null };
