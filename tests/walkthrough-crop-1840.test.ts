import { describe, expect, it } from "vitest";
import { walkthroughCrop, walkthroughCropSizes, walkthroughImageSizes, walkthroughViewports } from "@/modules/help/walkthrough-images";

/** The part of the screen each walkthrough picture keeps (#1840). Phone: 390 x 640 of a 390 x 844 screen. Desktop: the whole 1280 x 800 screen. */
describe("walkthroughCrop", () => {
  it("is the crop size, whatever the mark", () => {
    for (const kind of ["phone", "desktop"] as const) {
      const crop = walkthroughCrop(kind, { left: 100, top: 300, right: 200, bottom: 360 });
      expect({ width: crop.width, height: crop.height }).toEqual(walkthroughCropSizes[kind]);
    }
  });

  it("keeps the whole screen on desktop, so nothing is cut at the sides", () => {
    expect(walkthroughCropSizes.desktop).toEqual(walkthroughViewports.desktop);
    expect(walkthroughCrop("desktop", { left: 1100, top: 40, right: 1270, bottom: 80 })).toMatchObject({ left: 0, top: 0 });
    // A mark wider than the picture (here nearly the whole screen width) still gives the whole screen.
    expect(walkthroughCrop("desktop", { left: 2, top: 300, right: 1278, bottom: 420 })).toMatchObject({ left: 0, top: 0 });
  });

  it("shows the desktop picture at a smaller size than it keeps", () => {
    expect(walkthroughImageSizes.desktop.width).toBeLessThan(walkthroughCropSizes.desktop.width);
    expect(walkthroughImageSizes.desktop.width / walkthroughImageSizes.desktop.height).toBeCloseTo(walkthroughCropSizes.desktop.width / walkthroughCropSizes.desktop.height);
  });

  it("centres the phone picture on the mark", () => {
    // Mark centred at y 400 of the 844 screen: the 640 tall window starts at 80.
    expect(walkthroughCrop("phone", { left: 20, top: 380, right: 120, bottom: 420 })).toMatchObject({ left: 0, top: 80 });
  });

  it("stays inside the screen at the top and bottom edges", () => {
    const phone = walkthroughViewports.phone;
    const size = walkthroughCropSizes.phone;
    expect(walkthroughCrop("phone", { left: 0, top: 0, right: 30, bottom: 30 })).toMatchObject({ left: 0, top: 0 });
    const far = walkthroughCrop("phone", { left: phone.width - 30, top: phone.height - 30, right: phone.width, bottom: phone.height });
    expect(far).toMatchObject({ left: phone.width - size.width, top: phone.height - size.height });
  });

  it("keeps the top of a mark that is taller than the picture in view", () => {
    expect(walkthroughCrop("phone", { left: 10, top: 120, right: 380, bottom: 840 }).top).toBe(108);
  });

  it("shows the top-left of the screen when there is no mark", () => {
    expect(walkthroughCrop("phone", null)).toEqual({ left: 0, top: 0, ...walkthroughCropSizes.phone });
  });

  it("centres on the mark and the extra area together when both fit", () => {
    const mark = { left: 20, top: 400, right: 120, bottom: 440 };
    const area = { left: 10, top: 300, right: 380, bottom: 460 };
    const crop = walkthroughCrop("phone", mark, area);
    expect(crop.top).toBe(60);
    expect(crop.top).toBeLessThanOrEqual(area.top);
    expect(crop.top + crop.height).toBeGreaterThanOrEqual(area.bottom);
  });

  it("keeps the mark in view when the area is too big to fit with it", () => {
    const mark = { left: 20, top: 700, right: 120, bottom: 740 };
    const crop = walkthroughCrop("phone", mark, { left: 0, top: 0, right: 390, bottom: 800 });
    expect(crop.top).toBeLessThanOrEqual(mark.top);
    expect(crop.top + crop.height).toBeGreaterThanOrEqual(mark.bottom);
  });
});
