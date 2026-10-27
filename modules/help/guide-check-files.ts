import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The real page routes under `app/`, route groups removed, for the outdated-guide check. Node only. */
export function listPageRoutes(root = process.cwd()): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
        const segments = relative(join(root, "app"), dir).split(sep).filter((segment) => segment && !/^\(.*\)$/.test(segment));
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(join(root, "app"));
  return routes;
}

export function docFileExists(path: string, root = process.cwd()): boolean {
  return existsSync(join(root, path));
}

/** Whether a site path such as `/help/example.png` is a file under `public/`. */
export function publicFileExists(sitePath: string, root = process.cwd()): boolean {
  if (!sitePath.startsWith("/") || sitePath.includes("..")) return false;
  return existsSync(join(root, "public", sitePath));
}
