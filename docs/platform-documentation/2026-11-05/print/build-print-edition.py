"""Build the print edition of the IMAdventist getting-started deck.

Reads the screen deck (exports/IMAdventist-getting-started.pptx) for text and
speaker notes, and the original screenshots (assets/training/) for pictures.
Writes exports/IMAdventist-getting-started-print.pptx: one portrait US Letter
page per slide, white background, with each screenshot cropped to the part
the slide teaches so its text is readable on paper.

Run from this pack's folder:
    python3 print/build-print-edition.py
Then convert to PDF:
    soffice --headless --convert-to pdf --outdir exports exports/IMAdventist-getting-started-print.pptx
"""

import hashlib
import io
import json
import tempfile
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

PACK = Path(__file__).resolve().parent.parent
SRC = PACK / "exports" / "IMAdventist-getting-started.pptx"
OUT = PACK / "exports" / "IMAdventist-getting-started-print.pptx"
LOGO = PACK / "assets" / "imadventist-symbol.png"
CROP_DIR = Path(tempfile.mkdtemp(prefix="imadventist-print-"))

NAVY = RGBColor(0x00, 0x3B, 0x5C)
PURPLE = RGBColor(0x58, 0x2C, 0x83)
INK = RGBColor(0x1F, 0x2A, 0x37)
MUTED = RGBColor(0x45, 0x55, 0x63)
RULE = RGBColor(0xB8, 0xC2, 0xCC)
FONT = "Noto Sans"

PAGE_W, PAGE_H = 8.5, 11.0
MARGIN = 0.6
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_TOP = PAGE_H - 0.5

# Crop boxes in CSS pixels (screenshots are 1280 x 900 at 2x). Each box keeps
# the area the slide teaches and every pink numbered marker its caption names.
CROPS = {
    "public-home": (0, 0, 1280, 560),
    "public-calendar": (0, 40, 1280, 820),
    "sign-in": (380, 20, 880, 880),
    "two-step": (0, 40, 1280, 650),
    "director-account": (0, 0, 880, 880),
    "director-home": (0, 90, 1280, 880),
    "roster-edit-top": (0, 170, 1240, 790),
    "roster-add": (300, 0, 960, 880),
    "roster-add-save": (300, 0, 960, 880),
    "roster-added": (0, 330, 1240, 850),
    "roster-export": (0, 250, 1280, 880),
    "forms": (0, 40, 1240, 640),
    "honors": (0, 170, 1280, 760),
    "records-list": (0, 100, 1280, 720),
    "meeting-note": (0, 300, 780, 880),
    "report-sign": (100, 0, 860, 880),
    "report-submitted": (200, 0, 1080, 880),
    "events-list": (0, 140, 1280, 480),
    "event-attendees": (0, 380, 1240, 880),
    "event-review": (0, 0, 1240, 860),
    "event-saved": (0, 170, 940, 880),
    "club-class-tracking": (0, 280, 1280, 880),
    "club-class-suggestions": (0, 320, 720, 880),
    "club-orders-top": (0, 170, 1280, 760),
    "club-orders-list": (0, 40, 1240, 520),
    "club-orders-handout": (0, 0, 1220, 500),
    "club-orders-stock-after": (0, 40, 1220, 880),
    "club-year-end-header": (0, 170, 1240, 560),
    "club-year-end": (0, 0, 1240, 500),
    "club-year-end-save": (0, 480, 1240, 880),
    "forms-help": (200, 200, 1100, 700),
    "help-walkthroughs": (0, 0, 720, 880),
    "coordinator-account": (0, 0, 1240, 880),
    "coordinator-overview": (0, 180, 1240, 880),
    "coordinator-all-clubs": (0, 280, 1240, 880),
    "coordinator-glance": (0, 100, 1240, 880),
    "coordinator-club-view": (0, 280, 1280, 880),
    "coordinator-reports": (0, 180, 1240, 880),
    "coordinator-report-detail": (0, 160, 1280, 880),
    "coordinator-points": (0, 180, 1280, 880),
    "coordinator-events": (0, 60, 1240, 880),
    "new-clubs": (0, 170, 1280, 880),
    "account-sign-out": (0, 0, 1240, 560),
}
# The title page shows the top of each home page only.
TITLE_CROP = (0, 0, 1280, 520)

EMU = 914400


def inches(emu):
    return emu / EMU


def load_screens():
    capture = json.loads((PACK / "evidence" / "screenshot-capture.json").read_text())
    return {v["sha256"]: k for k, v in capture["screens"].items()}, capture["screens"]


def read_slide(slide, by_sha):
    """Pull label, title, bullets, cards, pictures+captions and notes."""
    texts, pictures = [], []
    for sh in slide.shapes:
        if sh.shape_type == 13:
            if sh.width > EMU:  # skip the small footer and title-page logos
                name = by_sha.get(hashlib.sha256(sh.image.blob).hexdigest())
                if name is None:  # the title-page logo, not a screenshot
                    continue
                pictures.append({"name": name, "left": inches(sh.left), "top": inches(sh.top),
                                 "width": inches(sh.width), "height": inches(sh.height)})
        elif sh.has_text_frame and sh.text_frame.text.strip():
            texts.append({"text": sh.text_frame.text, "left": inches(sh.left), "top": inches(sh.top),
                          "width": inches(sh.width),
                          "paras": [p.text for p in sh.text_frame.paragraphs if p.text.strip()]})
    label = next(t["text"] for t in texts if abs(t["top"] - 0.35) < 0.01)
    title = next(t["text"] for t in texts if abs(t["top"] - 0.68) < 0.01)
    body = [t for t in texts if t["top"] > 1.0 and t["top"] < 6.9]
    for pic in pictures:
        below = [t for t in body if abs(t["left"] - pic["left"]) < 0.1 and 0 < t["top"] - (pic["top"] + pic["height"]) < 0.2]
        pic["caption"] = below[0]["text"] if below else ""
        for t in below:
            body.remove(t)
    cards = []
    headings = [t for t in body if abs(t["top"] - 1.9) < 0.01]
    for h in headings:
        items = [t for t in body if abs(t["left"] - h["left"]) < 0.01 and abs(t["top"] - 2.5) < 0.01]
        cards.append({"heading": h["text"], "bullets": items[0]["paras"] if items else []})
        body = [t for t in body if t is not h and t not in items]
    bullets = [p for t in sorted(body, key=lambda t: (t["top"], t["left"])) for p in t["paras"]]
    pictures.sort(key=lambda p: (p["top"], p["left"]))
    notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
    return {"label": label, "title": title, "bullets": bullets, "cards": cards,
            "pictures": pictures, "notes": notes}


def crop_image(name, screens, box):
    CROP_DIR.mkdir(parents=True, exist_ok=True)
    out = CROP_DIR / f"{name}-{box[0]}-{box[1]}-{box[2]}-{box[3]}.png"
    im = Image.open(PACK / screens[name]["path"])
    scale = im.width / screens[name]["viewport_css_px"][0]
    region = im.crop(tuple(int(v * scale) for v in box))
    region.save(out, optimize=True)
    return out, region.width / region.height


def add_text(slide, left, top, width, height, paras, size, color, bold=False,
             align=PP_ALIGN.LEFT, space_after=6, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, text in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(space_after)
        run = p.add_run()
        run.text = text
        run.font.name = FONT
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
    return box


def text_height(paras, size, width, space_after=6):
    """Rough height in inches for wrapped text in Noto Sans."""
    chars_per_line = max(10, int(width * 72 / (size * 0.52)))
    lines = sum(max(1, -(-len(p) // chars_per_line)) for p in paras)
    return lines * size * 1.3 / 72 + len(paras) * space_after / 72


def add_rect(slide, left, top, width, height, fill=None, line=None, line_w=0.75):
    shape = slide.shapes.add_shape(1, Inches(left), Inches(top), Inches(width), Inches(height))
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(line_w)
    shape.shadow.inherit = False
    return shape


def add_picture(slide, path, aspect, left, top, max_w, max_h, caption, alt):
    w = min(max_w, max_h * aspect)
    h = w / aspect
    x = left + (max_w - w) / 2
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(top), Inches(w), Inches(h))
    pic._element.nvPicPr.cNvPr.set("descr", alt)
    add_rect(slide, x, top, w, h, line=RULE)
    if caption:
        add_text(slide, left, top + h + 0.06, max_w, 0.25, [caption], 11, MUTED, align=PP_ALIGN.CENTER, space_after=0)
    return h


def page_chrome(slide, number):
    add_rect(slide, 0, 0, PAGE_W, 0.08, fill=NAVY)
    slide.shapes.add_picture(str(LOGO), Inches(MARGIN), Inches(FOOTER_TOP), Inches(0.25), Inches(0.25))
    add_text(slide, MARGIN + 0.35, FOOTER_TOP + 0.02, 4.0, 0.25, ["IMAdventist · Events & Club Ministry"], 9, MUTED, space_after=0)
    add_text(slide, PAGE_W - MARGIN - 3.0, FOOTER_TOP + 0.02, 3.0, 0.25,
             [f"Fictional training data · Slide {number}"], 9, MUTED, align=PP_ALIGN.RIGHT, space_after=0)


def build_title(slide, data, screens):
    add_rect(slide, 0, 0, PAGE_W, 0.08, fill=NAVY)
    add_text(slide, MARGIN, 0.6, CONTENT_W, 0.3, [data["label"]], 12, PURPLE, bold=True)
    add_text(slide, MARGIN, 0.95, CONTENT_W, 0.6, [data["title"]], 28, NAVY)
    slide.shapes.add_picture(str(LOGO), Inches(MARGIN), Inches(1.8), Inches(0.9), Inches(0.9))
    add_text(slide, MARGIN + 1.1, 1.92, 5.0, 0.7, ["IMAdventist", "Events & Club Ministry"], 18, NAVY, bold=True, space_after=0)
    subtitle = [t for t in data["bullets"] if t not in ("IMAdventist", "Events & Club Ministry")]
    add_text(slide, MARGIN, 2.95, CONTENT_W, 0.6, subtitle, 13, INK, space_after=2)
    guide = [
        "Print edition: one page per slide. Page numbers match the slide numbers on screen.",
        "Directors and deputies: slides 1–21 and 31. Area Coordinators: slides 1–6 and 22–31.",
    ]
    add_rect(slide, MARGIN, 3.65, CONTENT_W, 0.75, line=RULE)
    add_text(slide, MARGIN + 0.15, 3.75, CONTENT_W - 0.3, 0.6, guide, 11, INK, space_after=3)
    top = 4.65
    for pic in data["pictures"]:
        path, aspect = crop_image(pic["name"], screens, TITLE_CROP)
        h = add_picture(slide, path, aspect, MARGIN, top, CONTENT_W, 2.55, pic["caption"],
                        f"Screenshot: {pic['caption']}")
        top += h + 0.45
    slide.shapes.add_picture(str(LOGO), Inches(MARGIN), Inches(FOOTER_TOP), Inches(0.25), Inches(0.25))
    add_text(slide, MARGIN + 0.35, FOOTER_TOP + 0.02, 4.0, 0.25, ["IMAdventist · Events & Club Ministry"], 9, MUTED, space_after=0)
    add_text(slide, PAGE_W - MARGIN - 3.0, FOOTER_TOP + 0.02, 3.0, 0.25,
             ["Fictional training data · Slide 1"], 9, MUTED, align=PP_ALIGN.RIGHT, space_after=0)


def build_page(slide, number, data, screens):
    page_chrome(slide, number)
    add_text(slide, MARGIN, 0.4, CONTENT_W, 0.25, [data["label"]], 11, PURPLE, bold=True)
    title_h = text_height([data["title"]], 24, CONTENT_W, 0)
    add_text(slide, MARGIN, 0.7, CONTENT_W, title_h, [data["title"]], 24, NAVY, space_after=0)
    top = 0.7 + title_h + 0.2

    if data["cards"]:
        for card in data["cards"]:
            h = 0.45 + text_height(card["bullets"], 13, CONTENT_W - 0.45)
            add_rect(slide, MARGIN, top, 0.06, h, fill=NAVY)
            add_text(slide, MARGIN + 0.25, top + 0.02, CONTENT_W - 0.25, 0.35, [card["heading"]], 16, NAVY, bold=True)
            add_text(slide, MARGIN + 0.25, top + 0.45, CONTENT_W - 0.25, h - 0.45, card["bullets"], 13, INK)
            top += h + 0.35
        add_note_lines(slide, top)
        return

    if data["bullets"]:
        h = text_height(data["bullets"], 13, CONTENT_W)
        add_text(slide, MARGIN, top, CONTENT_W, h, data["bullets"], 13, INK)
        top += h + 0.15

    pics = data["pictures"]
    if not pics:
        add_note_lines(slide, top + 0.2)
        return
    crops = [crop_image(p["name"], screens, CROPS[p["name"]]) for p in pics]
    css_w = [CROPS[p["name"]][2] - CROPS[p["name"]][0] for p in pics]
    available = FOOTER_TOP - 0.15 - top
    caption_h, gap = 0.3, 0.2

    def stacked(scale):
        sizes = [min(w * scale, CONTENT_W) for w in css_w]
        return sum(w / a for w, (_, a) in zip(sizes, crops)) + len(pics) * (caption_h + gap)

    def side_by_side(scale):
        col = (CONTENT_W - 0.3) / 2
        return max(min(w * scale, col) / a for w, (_, a) in zip(css_w, crops)) + caption_h + gap

    def best_scale(height_of):
        lo, hi = 0.0, CONTENT_W / min(css_w)
        for _ in range(40):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if height_of(mid) <= available else (lo, mid)
        return lo

    # Same scale for every picture on a page, so their text prints the same size.
    def effective(scale, cap):
        return min(min(w * scale, cap) / w for w in css_w)

    col = (CONTENT_W - 0.3) / 2
    scale = best_scale(stacked)
    side_scale = best_scale(side_by_side)
    if len(pics) == 2 and effective(side_scale, col) > effective(scale, CONTENT_W) * 1.1:
        scale = side_scale
        heights = []
        for i, (pic, (path, aspect), w) in enumerate(zip(pics, crops, css_w)):
            width = min(w * scale, col)
            heights.append(add_picture(slide, path, aspect, MARGIN + i * (col + 0.3), top, col, width / aspect,
                                       pic["caption"], alt_text(pic)))
        add_note_lines(slide, top + max(heights) + caption_h + gap + 0.1)
        return
    for pic, (path, aspect), w in zip(pics, crops, css_w):
        width = min(w * scale, CONTENT_W)
        h = add_picture(slide, path, aspect, MARGIN, top, CONTENT_W, width / aspect, pic["caption"], alt_text(pic))
        top += h + caption_h + gap
    add_note_lines(slide, top + 0.1)


def alt_text(pic):
    return f"Screenshot: {pic['caption'].lstrip('①②③ ')}"


def add_note_lines(slide, top):
    """Fill leftover space with ruled lines for handwritten notes."""
    bottom = FOOTER_TOP - 0.25
    if bottom - top < 1.1:
        return
    add_text(slide, MARGIN, top, CONTENT_W, 0.25, ["Notes"], 11, MUTED, bold=True, space_after=0)
    y = top + 0.6
    while y <= bottom:
        line = slide.shapes.add_connector(1, Inches(MARGIN), Inches(y), Inches(MARGIN + CONTENT_W), Inches(y))
        line.line.color.rgb = RULE
        line.line.width = Pt(0.5)
        y += 0.38


def main():
    by_sha, screens = load_screens()
    src = Presentation(str(SRC))
    out = Presentation()
    out.slide_width = Inches(PAGE_W)
    out.slide_height = Inches(PAGE_H)
    blank = out.slide_layouts[6]
    for number, slide in enumerate(src.slides, 1):
        data = read_slide(slide, by_sha)
        missing = [p for p in data["pictures"] if p["name"] not in CROPS and number != 1]
        if missing:
            raise SystemExit(f"Slide {number}: no crop for {[p['name'] for p in missing]}")
        page = out.slides.add_slide(blank)
        if number == 1:
            build_title(page, data, screens)
        else:
            build_page(page, number, data, screens)
        page.notes_slide.notes_text_frame.text = data["notes"]
    out.save(str(OUT))
    print(f"Wrote {OUT.relative_to(PACK)} with {len(src.slides)} pages")


if __name__ == "__main__":
    main()
