import { describe, expect, it } from "vitest";
import { walkthroughCrop, walkthroughImageSizes, walkthroughViewports } from "@/modules/help/walkthrough-images";

/** The part of the screen each walkthrough picture shows (#1840). Phone: 390 x 640 of a 390 x 844 screen. Desktop: 960 x 600 of 1280 x 800. */
describe("walkthroughCrop", () => {
  it("is the shown picture size, whatever the mark", () => {
    for (const kind of ["phone", "desktop"] as const) {
      const crop = walkthroughCrop(kind, { left: 100, top: 300, right: 200, bottom: 360 });
      expect({ width: crop.width, height: crop.height }).toEqual(walkthroughImageSizes[kind]);
    }
  });

  it("centres on the mark", () => {
    // Desktop mark centred at (640, 400) on the 1280 x 800 screen: the 960 x 600 window starts at (160, 100).
    expect(walkthroughCrop("desktop", { left: 600, top: 380, right: 680, bottom: 420 })).toMatchObject({ left: 160, top: 100 });
  });

  it("stays inside the screen at every edge", () => {
    const phone = walkthroughViewports.phone;
    const size = walkthroughImageSizes.phone;
    expect(walkthroughCrop("phone", { left: 0, top: 0, right: 30, bottom: 30 })).toMatchObject({ left: 0, top: 0 });
    const far = walkthroughCrop("phone", { left: phone.width - 30, top: phone.height - 30, right: phone.width, bottom: phone.height });
    expect(far).toMatchObject({ left: phone.width - size.width, top: phone.height - size.height });
  });

  it("keeps the top of a mark that is taller than the picture in view", () => {
    const crop = walkthroughCrop("phone", { left: 10, top: 120, right: 380, bottom: 840 });
    expect(crop.top).toBe(108);
  });

  it("shows the top-left of the screen when there is no mark", () => {
    expect(walkthroughCrop("phone", null)).toEqual({ left: 0, top: 0, ...walkthroughImageSizes.phone });
  });

  it("centres on the mark and the extra area together when both fit", () => {
    const mark = { left: 20, top: 400, right: 120, bottom: 440 };
    const area = { left: 10, top: 300, right: 380, bottom: 460 };
    // The union is 300 to 460, centre 380: the window starts at 60 and holds both.
    const crop = walkthroughCrop("phone", mark, area);
    expect(crop.top).toBe(60);
    expect(crop.top).toBeLessThanOrEqual(area.top);
    expect(crop.top + crop.height).toBeGreaterThanOrEqual(area.bottom);
  });

  it("keeps the mark in view when the area is too big to fit with it", () => {
    const mark = { left: 20, top: 700, right: 120, bottom: 740 };
    const area = { left: 0, top: 0, right: 390, bottom: 800 };
    const crop = walkthroughCrop("phone", mark, area);
    expect(crop.top).toBeLessThanOrEqual(mark.top);
    expect(crop.top + crop.height).toBeGreaterThanOrEqual(mark.bottom);
  });
});
