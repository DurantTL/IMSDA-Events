/**
 * The mark drawn on a walkthrough screenshot (#1482): a 3 px purple outline with a gold ring around the control, and a
 * numbered circle beside it, placed where it covers no text. Colors come from the app's own tokens (`--imsda-purple`, `--imsda-gold`).
 * The functions run in the page, so each is one self-contained function (Playwright serialises it).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const overlayId = "help-walkthrough-overlay";

export function drawMarkInPage(args: { number: number; id: string }) {
  const target = (window as any).__walkthroughTarget as Element | undefined;
  if (!target) return false;
  const root = getComputedStyle(document.documentElement);
  const purple = root.getPropertyValue("--imsda-purple").trim() || "#582c83";
  const gold = root.getPropertyValue("--imsda-gold").trim() || "#f0b323";
  const rect = target.getBoundingClientRect();
  const pad = 4;
  const layer = document.createElement("div");
  layer.id = args.id;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const box = document.createElement("div");
  const left = Math.max(2, rect.left - pad);
  const top = Math.max(2, rect.top - pad);
  const width = Math.min(window.innerWidth - 2, rect.right + pad) - left;
  const height = Math.min(window.innerHeight - 2, rect.bottom + pad) - top;
  box.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;border-radius:10px;outline:3px solid ${purple};box-shadow:0 0 0 6px ${gold};box-sizing:border-box;`;
  const badge = document.createElement("div");
  badge.textContent = String(args.number);
  const size = 30;
  const gap = 10;
  // The badge goes where it covers no visible text: left of the box, right of it, above it, below it, and only then on
  // its top-left corner (the old place, which could hide a label next to the control).
  const textRects: DOMRect[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || target.contains(node)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) textRects.push(r);
    }
  }
  const middle = top + height / 2 - size / 2;
  const candidates = [
    { x: left - size - gap, y: middle },
    { x: left + width + gap, y: middle },
    { x: left, y: top - size - gap },
    { x: left, y: top + height + gap },
  ];
  const fits = (c: { x: number; y: number }) =>
    c.x >= 2 && c.y >= 2 && c.x + size <= window.innerWidth - 2 && c.y + size <= window.innerHeight - 2 &&
    !textRects.some((r) => c.x < r.right + 2 && c.x + size > r.left - 2 && c.y < r.bottom + 2 && c.y + size > r.top - 2);
  const chosen = candidates.find(fits) ?? { x: left - size / 2, y: top - size / 2 };
  const badgeLeft = Math.min(Math.max(2, chosen.x), window.innerWidth - size - 2);
  const badgeTop = Math.min(Math.max(2, chosen.y), window.innerHeight - size - 2);
  badge.style.cssText = `position:absolute;left:${badgeLeft}px;top:${badgeTop}px;width:${size}px;height:${size}px;border-radius:50%;background:${purple};color:#fff;border:3px solid ${gold};display:flex;align-items:center;justify-content:center;font:700 15px/1 system-ui,sans-serif;box-sizing:border-box;`;
  layer.append(box, badge);
  document.body.append(layer);
  return true;
}

export function removeMarkInPage(id: string) {
  document.getElementById(id)?.remove();
  delete (window as any).__walkthroughTarget;
}
