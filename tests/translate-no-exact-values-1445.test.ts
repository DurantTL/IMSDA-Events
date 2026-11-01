import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CodeValue, EmailValue, ExactValue, Money, PhoneValue } from "@/components/exact-value";

/**
 * Rule T1 (#1445): a browser translator must leave exact values alone and
 * translate everything else. `translate="no"` therefore belongs on a name,
 * code, amount, email, phone number or web address, never on a page, layout,
 * form, container, heading text, label, instruction or button.
 */
const root = path.resolve(__dirname, "..");
const sourceRoots = ["app", "components", "modules", "lib"];

function sourceFiles(directory: string, extensions: string[], found: string[] = []) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, extensions, found);
    else if (extensions.some((extension) => full.endsWith(extension))) found.push(full);
  }
  return found;
}

/** Tags that wrap other content. Marking one `translate="no"` would stop its whole subtree from translating. */
const containerTags = new Set([
  "html", "body", "main", "form", "section", "article", "nav", "header", "footer", "aside", "div", "ul", "ol",
  "table", "thead", "tbody", "tfoot", "tr", "dialog", "label", "button", "fieldset", "details", "summary",
  "Fragment", "Suspense",
]);

type Finding = { file: string; line: number; tag: string; problem: string };

function translateNoFindings(): { findings: Finding[]; count: number } {
  const findings: Finding[] = [];
  let count = 0;
  for (const directory of sourceRoots) {
    for (const file of sourceFiles(path.join(root, directory), [".tsx"])) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("translate")) continue;
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
        const marked = opening?.attributes.properties.some(
          (property) => ts.isJsxAttribute(property) && property.name.getText() === "translate"
            && property.initializer && ts.isStringLiteral(property.initializer) && property.initializer.text === "no",
        );
        if (opening && marked) {
          count += 1;
          const tag = opening.tagName.getText();
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const relative = path.relative(root, file);
          if (containerTags.has(tag)) findings.push({ file: relative, line, tag, problem: "a container must not be translate=\"no\"" });
          if (ts.isJsxElement(node)) {
            const walk = (child: ts.Node) => {
              if (ts.isJsxText(child) && /[A-Za-z]{2,}/.test(child.getText())) {
                findings.push({ file: relative, line, tag, problem: `literal text "${child.getText().trim().slice(0, 40)}" must sit outside the exact value` });
              }
              ts.forEachChild(child, walk);
            };
            node.children.forEach(walk);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return { findings, count };
}

describe("translate=\"no\" only on exact values (#1445, rule T1)", () => {
  it("is never on a page, layout, form or container, and never around literal text", () => {
    const { findings, count } = translateNoFindings();
    expect(count).toBeGreaterThan(100);
    expect(findings, findings.map((f) => `${f.file}:${f.line} <${f.tag}> ${f.problem}`).join("\n")).toEqual([]);
  });

  it("is not a notranslate class or meta tag anywhere", () => {
    const offenders = sourceRoots
      .flatMap((directory) => sourceFiles(path.join(root, directory), [".ts", ".tsx", ".css"]))
      .filter((file) => /notranslate/i.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("keeps the page language English and the root layout translatable", () => {
    const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
    expect(layout).toContain('<html lang="en"');
    expect(layout).not.toMatch(/<(html|body)[^>]*translate=/);
    const metas = sourceFiles(path.join(root, "app"), ["layout.tsx", "page.tsx", "template.tsx"])
      .filter((file) => /<(main|html|body)\b[^>]*translate=["{]/.test(readFileSync(file, "utf8")));
    expect(metas.map((file) => path.relative(root, file))).toEqual([]);
  });
});

/**
 * Staff-only money screens whose tests assert the amount as contiguous sentence text. They still print bare
 * `formatCents(...)`; every other page and component marks amounts `translate="no"` (use `<Money>`).
 * Remove a file from this list when it is migrated; a file that no longer has a bare amount must be removed too.
 */
const bareMoneyAllowlist = new Set<string>([
  "components/asset-closeout-workspace.tsx",
  "components/asset-return-panel.tsx",
  "components/attendance-reconciliation-controls.tsx",
  "components/attendance-reconciliation.tsx",
  "components/church-code-invoices.tsx",
  "components/club-check-in-panel.tsx",
]);

function bareMoneyFiles() {
  const found = new Set<string>();
  for (const directory of ["app", "components"]) {
    for (const file of sourceFiles(path.join(root, directory), [".tsx"])) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("formatCents")) continue;
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const exactAncestor = (node: ts.Node) => {
        for (let up = node.parent; up; up = up.parent) {
          if (!ts.isJsxElement(up)) continue;
          const tag = up.openingElement.tagName.getText();
          if (tag === "Money" || tag === "ExactValue") return true;
          if (up.openingElement.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText() === "translate")) return true;
        }
        return false;
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && node.expression && ts.isCallExpression(node.expression)
          && /^formatCents(Plain)?$/.test(node.expression.expression.getText()) && !exactAncestor(node)) {
          found.add(path.relative(root, file));
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return found;
}

describe("amounts are exact values (#1445, rule T1)", () => {
  it("no bare formatCents(...) in JSX outside the documented allowlist", () => {
    const bare = [...bareMoneyFiles()].sort();
    expect(bare.filter((file) => !bareMoneyAllowlist.has(file)), "use <Money cents={...} /> instead").toEqual([]);
    expect([...bareMoneyAllowlist].filter((file) => !bare.includes(file)), "migrated: remove from the allowlist").toEqual([]);
  });
});

describe("shared exact-value components", () => {
  it("ExactValue and its typed variants render translate=\"no\" around only the value", () => {
    expect(renderToStaticMarkup(ExactValue({ children: "Synthetic Club" }))).toBe('<span translate="no">Synthetic Club</span>');
    expect(renderToStaticMarkup(ExactValue({ as: "strong", className: "x", children: "AB-123" }))).toBe('<strong class="x" translate="no">AB-123</strong>');
    expect(renderToStaticMarkup(EmailValue({ address: "lee@example.test" }))).toBe('<span translate="no">lee@example.test</span>');
    expect(renderToStaticMarkup(PhoneValue({ number: "(515) 555-0100" }))).toBe('<span translate="no">(515) 555-0100</span>');
    expect(renderToStaticMarkup(CodeValue({ code: "WR26-0001" }))).toBe('<span translate="no">WR26-0001</span>');
  });

  it("Money prints the same text as formatCents, marked translate=\"no\"", () => {
    expect(renderToStaticMarkup(Money({ cents: 123456 }))).toBe('<span translate="no">$1,234.56</span>');
    expect(renderToStaticMarkup(Money({ cents: -500, options: { grouping: false }, as: "b" }))).toBe('<b translate="no">-$5.00</b>');
  });
});
