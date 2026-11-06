"""Build the TV edition of the IMAdventist getting-started deck.

For presenting on a small screen such as a 32-inch TV. Same 31 slides in the
same order, with the same slide numbers and speaker notes as the screen deck
(exports/IMAdventist-getting-started.pptx), but larger text and one screenshot
per TV slide: a slide with two or three screenshots becomes two or three
parts. Each screenshot is cropped to the part the slide teaches (the crops are shared with
the print edition, plus the tighter TV_CROPS below).

Run from this pack's folder:
    python3 print/build-tv-edition.py
Then convert to PDF:
    soffice --headless --convert-to pdf --outdir exports exports/IMAdventist-getting-started-tv.pptx
"""

import importlib.util
from pathlib import Path

from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

_spec = importlib.util.spec_from_file_location(
    "print_edition", Path(__file__).resolve().parent / "build-print-edition.py")
pe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pe)

OUT = pe.PACK / "exports" / "IMAdventist-getting-started-tv.pptx"
SLIDE_W, SLIDE_H = 13.333, 7.5
MARGIN = 0.4
CONTENT_W = SLIDE_W - 2 * MARGIN
BOTTOM = SLIDE_H - 0.35

LABEL_PT, TITLE_PT, BODY_PT, CAPTION_PT = 16, 34, 22, 18

# Tighter crops for the TV, where a picture often shares the width with a
# second one. CSS pixels, as in the print edition. Each keeps its pink marker.
TV_CROPS = {
    "roster-edit-top": (0, 145, 1240, 375),
    "roster-added": (0, 330, 1240, 850),
    "records-list": (0, 280, 1280, 600),
    "meeting-note": (0, 580, 780, 820),
    "events-list": (0, 220, 1280, 420),
    "event-attendees": (0, 560, 1240, 880),
    "event-review": (0, 0, 900, 860),
    "event-saved": (0, 110, 940, 640),
    "club-class-tracking": (0, 220, 1280, 700),
    "club-orders-top": (0, 110, 1280, 500),
    "club-orders-handout": (0, 220, 700, 500),
    "club-orders-stock-after": (0, 120, 1220, 735),
    "club-year-end-header": (0, 280, 1240, 500),
    "club-year-end": (0, 300, 1240, 500),
    "club-year-end-save": (0, 640, 1240, 880),
    "coordinator-overview": (0, 248, 700, 848),
    "coordinator-all-clubs": (0, 334, 1240, 764),
    "coordinator-glance": (0, 104, 1240, 600),
    "coordinator-club-view": (0, 240, 1280, 790),
    "coordinator-reports": (0, 540, 1240, 900),
    "coordinator-report-detail": (0, 55, 1280, 510),
}


def crop_box(name):
    return TV_CROPS.get(name, pe.CROPS[name])


def text(slide, left, top, width, height, paras, size, color, bold=False, align=PP_ALIGN.LEFT, space_after=8):
    return pe.add_text(slide, left, top, width, height, paras, size, color, bold=bold, align=align,
                       space_after=space_after)


def picture(slide, name, caption, screens, left, top, max_w, max_h):
    path, aspect = pe.crop_image(name, screens, crop_box(name))
    w = min(max_w, max_h * aspect)
    h = w / aspect
    x = left + (max_w - w) / 2
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(top), Inches(w), Inches(h))
    pic._element.nvPicPr.cNvPr.set("descr", pe.alt_text({"caption": caption}))
    pe.add_rect(slide, x, top, w, h, line=pe.RULE, line_w=1)
    if caption:
        text(slide, left, top + h + 0.05, max_w, 0.35, [caption], CAPTION_PT, pe.MUTED, align=PP_ALIGN.CENTER,
             space_after=0)
    return h


def chrome(slide, number, data, corner=None):
    pe.add_rect(slide, 0, 0, SLIDE_W, 0.1, fill=pe.NAVY)
    text(slide, MARGIN, 0.22, CONTENT_W - 2.6, 0.3, [data["label"]], LABEL_PT, pe.PURPLE, bold=True, space_after=0)
    text(slide, SLIDE_W - MARGIN - 2.5, 0.22, 2.5, 0.3, [corner or str(number)], LABEL_PT, pe.MUTED, align=PP_ALIGN.RIGHT,
         space_after=0)
    title_h = pe.text_height([data["title"]], TITLE_PT, CONTENT_W, 0)
    text(slide, MARGIN, 0.5, CONTENT_W, title_h, [data["title"]], TITLE_PT, pe.NAVY, space_after=0)
    return 0.5 + title_h + 0.15


def build_title(slide, data):
    pe.add_rect(slide, 0, 0, SLIDE_W, 0.1, fill=pe.NAVY)
    text(slide, MARGIN + 0.2, 0.7, 9, 0.4, [data["label"]], 20, pe.PURPLE, bold=True)
    text(slide, MARGIN + 0.2, 1.2, 12, 1.0, [data["title"]], 48, pe.NAVY)
    slide.shapes.add_picture(str(pe.LOGO), Inches(MARGIN + 0.2), Inches(2.7), Inches(1.6), Inches(1.6))
    text(slide, MARGIN + 2.1, 2.95, 8, 1.2, ["IMAdventist", "Events & Club Ministry"], 34, pe.NAVY, bold=True,
         space_after=0)
    subtitle = [t for t in data["bullets"] if t not in ("IMAdventist", "Events & Club Ministry")]
    text(slide, MARGIN + 0.2, 4.9, 12, 1.5, subtitle, 26, pe.INK, space_after=6)


def build_cards(slide, data, top):
    n = len(data["cards"])
    col = (CONTENT_W - 0.4 * (n - 1)) / n
    for i, card in enumerate(data["cards"]):
        x = MARGIN + i * (col + 0.4)
        pe.add_rect(slide, x, top, col, BOTTOM - top, line=pe.RULE, line_w=1)
        pe.add_rect(slide, x, top, col, 0.1, fill=pe.NAVY)
        head_h = pe.text_height([card["heading"]], 26, col - 0.5, 0)
        text(slide, x + 0.25, top + 0.3, col - 0.5, head_h, [card["heading"]], 26, pe.NAVY, bold=True)
        text(slide, x + 0.25, top + 0.45 + head_h, col - 0.5, BOTTOM - top - 0.6 - head_h, card["bullets"],
             BODY_PT, pe.INK, space_after=12)


def build_slide(slide, number, data, screens, pic=None, corner=None):
    """One screenshot per TV slide; a slide with several becomes several parts."""
    top = chrome(slide, number, data, corner)
    if data["cards"]:
        build_cards(slide, data, top + 0.1)
        return
    bullets = data["bullets"]
    if pic is None:
        text(slide, MARGIN, top + 0.1, CONTENT_W, BOTTOM - top, bullets, BODY_PT, pe.INK, space_after=14)
        return
    # Picture on the right at full height with the bullets beside it, or the
    # bullets on top and the picture across the whole width: whichever shows
    # the picture larger.
    box = crop_box(pic["name"])
    aspect = (box[2] - box[0]) / (box[3] - box[1])
    side_w = 4.2
    pic_w = CONTENT_W - side_w - 0.35
    avail_h = BOTTOM - top - 0.42
    side_size = min(pic_w, avail_h * aspect)
    bullets_h = pe.text_height(bullets, BODY_PT, CONTENT_W, 8)
    wide_size = min(CONTENT_W, (avail_h - bullets_h - 0.15) * aspect)
    if side_size >= wide_size:
        text(slide, MARGIN, top + 0.1, side_w, BOTTOM - top, bullets, BODY_PT, pe.INK, space_after=14)
        picture(slide, pic["name"], pic["caption"], screens, MARGIN + side_w + 0.35, top, pic_w, avail_h)
        return
    text(slide, MARGIN, top, CONTENT_W, bullets_h, bullets, BODY_PT, pe.INK)
    top += bullets_h + 0.15
    picture(slide, pic["name"], pic["caption"], screens, MARGIN, top, CONTENT_W, BOTTOM - top - 0.42)


def main():
    by_sha, screens = pe.load_screens()
    src = Presentation(str(pe.SRC))
    out = Presentation()
    out.slide_width = Inches(SLIDE_W)
    out.slide_height = Inches(SLIDE_H)
    blank = out.slide_layouts[6]
    for number, source in enumerate(src.slides, 1):
        data = pe.read_slide(source, by_sha)
        if number == 1:
            slide = out.slides.add_slide(blank)
            build_title(slide, data)
            slide.notes_slide.notes_text_frame.text = data["notes"]
            continue
        pics = data["pictures"] or [None]
        for part, pic in enumerate(pics, 1):
            slide = out.slides.add_slide(blank)
            corner = f"Slide {number} · part {part} of {len(pics)}" if len(pics) > 1 else f"Slide {number}"
            build_slide(slide, number, data, screens, pic, corner)
            notes = data["notes"] if part == 1 else f"Slide {number}, part {part} of {len(pics)}. Notes are on part 1."
            slide.notes_slide.notes_text_frame.text = notes
    out.save(str(OUT))
    print(f"Wrote {OUT.relative_to(pe.PACK)} with {len(out.slides)} TV slides for {len(src.slides)} slides")


if __name__ == "__main__":
    main()
