/** Documentation only: derive the staff subset of #1558 from existing registries. */
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRouteMapping } from "../components/route-mapping";
import { clubsAdminActiveHref, clubsAdminGroups, navigation } from "../components/staff-navigation";
import { systemNavActiveItem, systemNavGroups } from "../components/system-navigation";
import { staffWorkspaceFor } from "../components/staff-workspace-model";

function pages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? pages(file) : entry.name === "page.tsx" ? [file] : [];
  });
}

const rows = buildRouteMapping();
const files = [...pages("app/(workspace)"), "app/archived-events/page.tsx", "app/select-event/page.tsx", "app/check-in-station/page.tsx"];
const table = files.map((file) => {
  const route = file.replace(/^app(?:\/\(workspace\))?/, "").replace(/\/page\.tsx$/, "") || "/";
  return { file, route };
}).filter(({ route }) => route !== "/profile").sort((a, b) => a.route.localeCompare(b.route));

const text = [
  "# Staff workspace route ownership (#1565)",
  "",
  "Generated with `npx tsx docs/generate-staff-workspace-map.ts`. This is the staff-only subset for #1558, not a second runtime registry or a decision to build a whole-system site-map page.",
  "",
  "Workspace columns show the existing System and Clubs view policies for a system administrator. Shared destinations keep their contextual workspace; this choice never grants access. Every route retains its server guard, and menu/search visibility retains the existing role/grant/module predicates. Record pages open through their existing parent links. Help follows the current workspace. Query filters, club year and the selected event are preserved by the existing link helpers.",
  "",
  "| Route | Previously reached from | System view | Clubs view | Section / contextual entry | Source |",
  "| --- | --- | --- | --- | --- | --- |",
];
for (const { route, file } of table) {
  const exact = rows.find((row) => row.route === route);
  const parent = exact ?? rows.filter((row) => route.startsWith(row.route + "/")).sort((a, b) => b.route.length - a.route.length)[0];
  const systemItem = systemNavActiveItem(route);
  const systemGroup = systemItem ? systemNavGroups.find((group) => group.items.includes(systemItem)) : null;
  const clubsHref = clubsAdminActiveHref(route);
  const clubsGroup = clubsAdminGroups.find((group) => group.items.some((item) => item.href === clubsHref));
  const eventItem = navigation.filter((item) => route === item.href || route.startsWith(item.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  const section = systemGroup?.label ?? clubsGroup?.label ?? eventItem?.sidebar ?? "Contextual page";
  const entry = parent?.destinationPath ?? (route.startsWith("/help") ? "/help" : route);
  const workspace = (activeRole: "SYSTEM_ADMIN" | "CLUBS_ADMIN") => staffWorkspaceFor({ pathname: route, activeRole, isSystemAdmin: true });
  text.push(`| \`${route}\` | ${parent?.oldPlace ?? "Existing page link"} | ${workspace("SYSTEM_ADMIN")} | ${workspace("CLUBS_ADMIN")} | ${section}: \`${entry}\` | \`${file}\` |`);
}
text.push("", `${table.length} staff page definitions. Dynamic patterns count once. Alias routes remain aliases. The table does not enumerate query states, permissions or approved data fields; those remain with each owning issue and page guard.`, "");
writeFileSync("docs/STAFF-WORKSPACE-ROUTES.md", text.join("\n"));
console.log(`Wrote ${table.length} staff route rows from existing registries.`);
