import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Budget sheet is a planning sheet (#1682): it never writes payments, invoices, the ledger or registrations, and it holds no
 * receipt files. These read the boundary's source, so a later change that crosses either line fails here.
 */

const root = process.cwd();
const dir = join(root, "modules/event-budgets");
const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
const sources = files.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));

const importsOf = (text: string) => [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);

describe("the Budget sheet boundary", () => {
  it("has the domain, access, repository and settings files", () => {
    expect(files).toEqual(expect.arrayContaining(["domain.ts", "access.ts", "repository.ts", "settings.ts", "figures.ts"]));
  });

  it("imports no payment, invoice, ledger or refund module and no registration writer", () => {
    for (const { name, text } of sources) {
      for (const specifier of importsOf(text)) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(/modules\/(payments|invoices|ledger|refunds|church-invoices|deferred-billing)\b/);
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(/registrations\/(service|mutations|operations|payments)/);
      }
    }
  });

  it("reads registrations only through listRegistrations, and writes only cost lines and the audit log", () => {
    const repository = sources.find((source) => source.name === "repository.ts")!.text;
    expect(repository).toContain('import { listRegistrations } from "@/modules/registrations/repository"');
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/\.(payment|invoice|ledgerEntry|registration|refund|adjustment|attendee)\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/);
    }
    const writes = [...repository.matchAll(/\b(tx|prisma|getPrisma\(\))\.(\w+)\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/g)].map((match) => match[2]);
    expect(new Set(writes)).toEqual(new Set(["eventBudgetCostLine"]));
  });

  it("has no upload: no file store, no file input, no receipt field", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/asset-storage|putObject|multipart|formData\(|FormData|type="file"/);
    }
    for (const component of ["components/budget-sheet.tsx", "components/budget-sheet-view.tsx", "components/budget-panel.tsx", "components/budget-last-year.tsx"]) {
      const text = readFileSync(join(root, component), "utf8");
      expect(text, component).not.toMatch(/type="file"|asset-storage|<input[^>]*accept=/);
    }
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    const model = /model EventBudgetCostLine \{[\s\S]*?\n\}/.exec(schema)![0];
    expect(model).not.toMatch(/receipt|file|url|upload/i);
  });

  it("stores no personal data on a cost line and keeps the free description out of the audit log", () => {
    const repository = sources.find((source) => source.name === "repository.ts")!.text;
    expect(repository).not.toMatch(/description:\s*line\.description|metadata:[^\n]*description/);
  });
});
