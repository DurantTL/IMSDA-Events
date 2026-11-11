/**
 * The mark drawn on a walkthrough screenshot (#1482, #1840): a 3 px purple outline with a gold ring around the control, a
 * numbered circle beside it, placed where it covers no text, and a light shade over the rest of the screen so the eye goes
 * to the marked part. Browser focus rings are hidden while the picture is taken, so the mark is the only outline. Colors come from the app's own tokens (`--imsda-purple`, `--imsda-gold`).
 * The functions run in the page, so each is one self-contained function (Playwright serialises it).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const overlayId = "help-walkthrough-overlay";

export function drawMarkInPage(args: { number: number; id: string }) {
  const targets = (window as any).__walkthroughTargets as Element[] | undefined;
  if (!targets || targets.length === 0) return null;
  const inTarget = (node: Node) => targets.some((element) => element.contains(node));
  const root = getComputedStyle(document.documentElement);
  const purple = root.getPropertyValue("--imsda-purple").trim() || "#582c83";
  const gold = root.getPropertyValue("--imsda-gold").trim() || "#f0b323";
  const rects = targets.map((element) => element.getBoundingClientRect());
  // One outline around the control, or around both controls of a step that marks two.
  const rect = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
  const pad = 4;
  const layer = document.createElement("div");
  layer.id = args.id;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const quiet = document.createElement("style");
  quiet.textContent = "*:focus, *:focus-visible { outline: none !important; }";
  layer.append(quiet);
  const box = document.createElement("div");
  const left = Math.max(2, rect.left - pad);
  const top = Math.max(2, rect.top - pad);
  const width = Math.min(window.innerWidth - 2, rect.right + pad) - left;
  const height = Math.min(window.innerHeight - 2, rect.bottom + pad) - top;
  box.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;border-radius:10px;outline:3px solid ${purple};box-shadow:0 0 0 6px ${gold},0 0 0 9999px rgba(24,16,40,0.12);box-sizing:border-box;`;
  const size = 30;
  const badge = document.createElement("div");
  badge.textContent = String(args.number);
  // The badge always touches its own outline. It goes left of the outline, then right of it, centred on it, when that covers no
  // visible text and no other control; otherwise it sits on a corner of the outline (top-left first), with its centre on the corner, where it hides no text.
  const blocked: DOMRect[] = [];
  const ownText: DOMRect[] = [];
  const visible = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) if (visible(r)) (inTarget(node) ? ownText : blocked).push(r);
  }
  const controls = "button, a[href], input, select, textarea, label, summary, [role=button], [role=option], [role=checkbox]";
  for (const element of Array.from(document.querySelectorAll(controls))) {
    if (inTarget(element) || targets.some((t) => element.contains(t))) continue;
    const r = element.getBoundingClientRect();
    if (visible(r)) blocked.push(r);
  }
  const middle = top + height / 2 - size / 2;
  const touch = 6;
  const candidates = [
    { x: left - size - touch, y: middle },
    { x: left + width + touch, y: middle },
  ];
  const fits = (c: { x: number; y: number }, rects: DOMRect[] = blocked) =>
    c.x >= 2 && c.y >= 2 && c.x + size <= window.innerWidth - 2 && c.y + size <= window.innerHeight - 2 &&
    !rects.some((r) => c.x < r.right + 2 && c.x + size > r.left - 2 && c.y < r.bottom + 2 && c.y + size > r.top - 2);
  // On a corner, with its centre on the corner: the top-left one, or another when the control's own label sits there.
  const corners = [
    { x: left - size / 2, y: top - size / 2 },
    { x: left + width - size / 2, y: top - size / 2 },
    { x: left + width - size / 2, y: top + height - size / 2 },
    { x: left - size / 2, y: top + height - size / 2 },
  ];
  const chosen = candidates.find((c) => fits(c)) ?? corners.find((c) => fits(c, [...blocked, ...ownText])) ?? corners[0]!;
  const badgeLeft = Math.min(Math.max(2, chosen.x), window.innerWidth - size - 2);
  const badgeTop = Math.min(Math.max(2, chosen.y), window.innerHeight - size - 2);
  badge.style.cssText = `position:absolute;left:${badgeLeft}px;top:${badgeTop}px;width:${size}px;height:${size}px;border-radius:50%;background:${purple};color:#fff;border:3px solid ${gold};display:flex;align-items:center;justify-content:center;font:700 15px/1 system-ui,sans-serif;box-sizing:border-box;`;
  layer.append(box, badge);
  document.body.append(layer);
  // The area the picture is cropped around: the outline, its ring and the number.
  const ring = 6;
  return {
    left: Math.min(left - ring, badgeLeft),
    top: Math.min(top - ring, badgeTop),
    right: Math.max(left + width + ring, badgeLeft + size),
    bottom: Math.max(top + height + ring, badgeTop + size),
  };
}

export function removeMarkInPage(id: string) {
  document.getElementById(id)?.remove();
  delete (window as any).__walkthroughTargets;
}
