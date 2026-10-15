import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const importModules = ["import-files", "import-parser", "import-match", "import-repository", "import-upload"].map((name) => `modules/health-records/${name}.ts`);
const importRoutes = ["app/api/staff/health-import/preview/route.ts", "app/api/staff/health-import/apply/route.ts"];

describe("the Cognito health import keeps health data in memory and out of every side channel (#878)", () => {
  it("never writes a file, never reads one by name and never makes a network request", () => {
    for (const path of [...importModules, ...importRoutes, "components/health-import-workspace.tsx"]) {
      const source = read(path);
      expect(source, path).not.toMatch(/from "node:fs|from "fs"|writeFile|createWriteStream|tmpdir|from "node:(http|https|net)"|\bfetch\(.*(storage|https?:)/);
      expect(source, path).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it("never opens a stored health value, and handles a sealed column only through the crypto helper", () => {
    for (const path of importModules) {
      expect(read(path), path).not.toMatch(/sealedValue|openHealthField|openSnapshotField|fields:\s*\{\s*select/);
    }
  });

  it("logs only through the redacting logger, with the action and a sanitised error", () => {
    for (const path of importModules) {
      for (const call of read(path).matchAll(/logError\(([^)]*)\)/g)) expect(call[1], path).toMatch(/^(action|`\$\{action\} failed`), error$/);
    }
  });

  it("is reached only from its own routes, page and component", () => {
    const users = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("modules"), ...sourceFiles("lib")]
      .filter((path) => !path.startsWith("modules/health-records/"))
      .filter((path) => /health-records\/import-(repository|upload|files|parser|match)/.test(read(path)))
      .sort();
    expect(users).toEqual([
      "app/api/staff/health-import/apply/route.ts",
      "app/api/staff/health-import/preview/route.ts",
      "components/health-import-workspace.tsx",
    ]);
  });

  it("keeps the import out of exports, reports, communications and the generic importers", () => {
    const guarded = [
      ...sourceFiles("modules/checkin"),
      ...sourceFiles("modules/reporting"),
      ...sourceFiles("modules/club-reports"),
      ...sourceFiles("modules/communications"),
      ...sourceFiles("modules/imports"),
    ];
    for (const path of guarded) expect(read(path), path).not.toMatch(/health-records\/import/);
  });

  it("asks every route for a system administrator, in this order, before it reads the upload", () => {
    for (const path of importRoutes) {
      const source = read(path);
      const order = ["healthDisabledResponse()", "rejectCrossOriginRequest(request)", "requireHealthImporter(await requireStaffHealthViewer())", "readHealthImportUpload("].map((needle) => source.indexOf(needle));
      expect(order.every((index) => index > 0), path).toBe(true);
      expect([...order].sort((x, y) => x - y), path).toEqual(order);
    }
  });

  it("decides who may import in one place: a system administrator, not acting as someone else", () => {
    const access = read("modules/health-records/import-access.ts");
    expect(access).toMatch(/viewer\.kind !== "SYSTEM_ADMIN" \|\| viewer\.actAsId/);
    expect(read("modules/health-records/import-repository.ts")).not.toMatch(/function requireImporter/);
  });

  it("adds only a plain timestamp column in its migration", () => {
    const migration = read("prisma/migrations/20261104100000_health_record_import_flag/migration.sql");
    expect(migration).toMatch(/ADD COLUMN "importedAt" TIMESTAMP\(3\)/);
    expect(migration).not.toMatch(/sealedValue|fieldKey|DROP|DELETE|UPDATE/i);
  });
});
