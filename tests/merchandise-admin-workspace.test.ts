import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MerchandiseAdminWorkspace } from "@/components/merchandise-admin-workspace";

const root = process.cwd();
const workspaceSource = readFileSync(path.join(root, "components/merchandise-admin-workspace.tsx"), "utf8");
const dialogSource = readFileSync(path.join(root, "components/editor-dialog.tsx"), "utf8");
const workspaceCss = readFileSync(path.join(root, "components/merchandise-admin-workspace.module.css"), "utf8");

describe("merchandise admin workspace accessibility", () => {
  it("announces the initial catalog load to assistive technology, not just visually", () => {
    // The component fetches on mount via an effect, which never runs during a
    // static render, so this frame is the real first paint every staff
    // member's screen reader sees while the catalog request is in flight.
    const markup = renderToStaticMarkup(createElement(MerchandiseAdminWorkspace, { eventId: "event_1" }));

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading merchandise catalog");
  });

  it("labels every reorder control with the specific item it moves, not a generic 'up'/'down'", () => {
    expect(workspaceSource).toContain("aria-label={`Move ${product.name} up`}");
    expect(workspaceSource).toContain("aria-label={`Move ${product.name} down`}");
    expect(workspaceSource).toContain("aria-label={`Move ${variant.label} up`}");
    expect(workspaceSource).toContain("aria-label={`Move ${variant.label} down`}");
    expect(workspaceSource).toContain("aria-label={`Edit ${product.name}`}");
    expect(workspaceSource).toContain("aria-label={`Archive ${product.name}`}");
  });

  it("gives every product and variant a visible Edit button and one Actions menu named for it (#1581)", () => {
    expect(workspaceSource).toContain("aria-label={`Edit ${product.name}`} onClick={() => openProductEditor(product)}>Edit</button>");
    expect(workspaceSource).toContain("aria-label={`Edit ${variant.label}`} onClick={() => openVariantEditor(variant)}>Edit</button>");
    expect(workspaceSource).toContain("<ActionsMenu ariaLabel={`Actions for ${product.name}`}>");
    expect(workspaceSource).toContain("<ActionsMenu ariaLabel={`Actions for ${variant.label}`}>");
    for (const word of [">Move up</button>", ">Move down</button>", ">Archive</button>"]) expect(workspaceSource.split(word).length - 1, word).toBe(2);
    // No icon-only row controls remain.
    expect(workspaceSource).not.toContain('className="icon-button" type="button" aria-label');
  });

  it("disables reorder controls at the visible edges instead of only hiding them, so keyboard/switch focus never lands on a dead move button", () => {
    expect(workspaceSource).toMatch(/aria-label=\{`Move \$\{product\.name\} up`\}[^>]*disabled=\{saving \|\| index === 0\}/);
    expect(workspaceSource).toMatch(/aria-label=\{`Move \$\{product\.name\} down`\}[^>]*disabled=\{saving \|\| index === ordered\.length - 1\}/);
  });

  it("exposes stateful toggle buttons (catalog enabled, item selected, preview audience) through aria-pressed, not color alone", () => {
    expect(workspaceSource).toMatch(/Disable catalog[\s\S]{0,40}aria-pressed=\{catalog\.isEnabled\}|aria-pressed=\{catalog\.isEnabled\}[\s\S]{0,80}Disable catalog/);
    expect(workspaceSource).toContain("aria-pressed={selectedId === product.id}");
    expect(workspaceSource).toContain('aria-pressed={previewAudience === audience.value}');
  });

  it("gives every modal dialog a role, an aria-modal flag, and an aria-labelledby that resolves to a heading in the same dialog", () => {
    // Both editors share EditorDialog (components/editor-dialog.tsx, also used by the issued items page, #1581),
    // which wires aria-labelledby to its own heading id.
    expect(workspaceSource).toContain('import { EditorDialog } from "@/components/editor-dialog"');
    expect(workspaceSource).not.toContain("function EditorDialog");
    expect(dialogSource).toContain('role="dialog"');
    expect(dialogSource).toContain('aria-modal="true"');
    expect(dialogSource).toContain("aria-labelledby={titleId}");
    expect(dialogSource).toContain("<h2 id={titleId}>");

    expect(workspaceSource).toContain('closeLabel="Close variant editor"');
    expect(workspaceSource).toContain('closeLabel="Close product editor"');
  });

  it("keeps every landmark section's heading connected via aria-labelledby so assistive tech can name each region", () => {
    expect(workspaceSource).toContain('aria-labelledby="catalog-products-heading"');
    expect(workspaceSource).toContain('id="catalog-products-heading"');
    expect(workspaceSource).toContain('aria-labelledby="preview-heading"');
    expect(workspaceSource).toContain('id="preview-heading"');
  });

  it("groups the preview audience switcher as a labeled control group rather than loose buttons", () => {
    expect(workspaceSource).toContain('role="group"');
    expect(workspaceSource).toContain('aria-label="Preview as attendee context"');
  });

  it("marks purely decorative icons aria-hidden so they are not announced redundantly next to their text labels", () => {
    const iconUses = workspaceSource.match(/<(?:Archive|ChevronDown|ChevronUp|ImagePlus|PackageOpen|Pencil|Plus|Save|ShoppingBag|X) [^>]*\/>/g) ?? [];
    expect(iconUses.length).toBeGreaterThan(5);
    for (const use of iconUses) {
      expect(use).toContain('aria-hidden="true"');
    }
  });

  it("associates every catalog-item form field with a visible label element, not a bare input", () => {
    expect(workspaceSource).toMatch(/<label>Product name<input name="name"/);
    expect(workspaceSource).toMatch(/<label>Variant label<input name="label"/);
    expect(workspaceSource).toMatch(/<label>Price /);
    expect(workspaceSource).toContain('<label className="public-registration-check"><input name="isEnabled" type="checkbox"');
  });
});

describe("merchandise admin workspace responsive layout", () => {
  it("collapses the two-column product/preview layout to one column on narrow viewports", () => {
    expect(workspaceCss).toContain(".layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr);");
    expect(workspaceCss).toMatch(/@media \(max-width: 850px\)\s*\{\s*\.layout \{ grid-template-columns: 1fr; \}\s*\}/);
  });

  it("drops each product's Edit and Actions under its name on phone-sized viewports, and lets long names wrap (#1581)", () => {
    const smallBreakpoint = workspaceCss.match(/@media \(max-width: 520px\)\s*\{([\s\S]*?)\n\}/);
    expect(smallBreakpoint).not.toBeNull();
    const body = smallBreakpoint![1];
    expect(body).toContain(".cardActions { flex: 1 1 100%; justify-content: flex-start; }");
    expect(workspaceCss).toMatch(/\.productSelect strong \{[^}]*overflow-wrap: anywhere;/);
    expect(workspaceCss).not.toMatch(/\.productSelect strong \{[^}]*white-space: nowrap/);
    expect(workspaceCss).toMatch(/\.variantInfo \{[^}]*overflow-wrap: anywhere;/);
    expect(workspaceCss).toMatch(/\.productCard \{[^}]*flex-wrap: wrap;/);
  });

  it("keeps the shared 44px row controls: the dense rows rule and 44px targets for the small buttons (#1581)", () => {
    expect(workspaceSource).toContain("dense-rows");
    expect(workspaceCss).toMatch(/\.variantHeading \.secondary-button \{[^}]*min-height: var\(--touch-target\);/);
    expect(workspaceCss).toMatch(/\.audienceToggle button \{[^}]*min-height: var\(--touch-target\);/);
    expect(workspaceCss).toMatch(/\.productSelect \{[^}]*min-height: var\(--touch-target\);/);
  });

  it("shrinks preview artwork thumbnails on phone-sized viewports so the card still fits without horizontal scrolling", () => {
    const smallBreakpoint = workspaceCss.match(/@media \(max-width: 520px\)\s*\{([\s\S]*?)\n\}/);
    const body = smallBreakpoint![1];
    expect(body).toContain(".previewCard { grid-template-columns: 48px minmax(0, 1fr); }");
    expect(body).toContain(".previewCard > img { width: 48px; height: 48px; }");
  });

  it("ties preview cards to the audience they were evaluated for and ignores stale responses (#1108)", () => {
    expect(workspaceSource).toContain("previewRequestId.current");
    expect(workspaceSource).toContain("requestId !== previewRequestId.current");
    expect(workspaceSource).toContain("preview.audience === previewAudience");
    expect(workspaceSource).toContain("Preview as…");
    expect(workspaceSource).toContain("could not be loaded");
    expect(workspaceSource).toContain("Try again");
    expect(workspaceSource).not.toContain("integer cents");
  });

  it("gives both editors the shared accessible dialog and a discard confirmation (#1108)", () => {
    expect(dialogSource).toContain("useAccessibleDialog<HTMLElement>(true, onRequestClose)");
    expect(workspaceSource).toContain('requestCloseEditor("variant")');
    expect(workspaceSource).toContain('requestCloseEditor("product")');
    expect(workspaceSource).toContain("Discard your changes?");
    expect(workspaceSource).toMatch(/if \(saving\) return;\s+if \(editorDirty\)/);
    expect(workspaceCss).toContain("position: sticky");
  });
});
