import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/communications/effective-delivery", async () => (await import("./support/effective-delivery-double")).effectiveDeliveryDouble);

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  processExternalEmailQueue: vi.fn(),
  captureOne: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/integrations/email/resend", () => ({
  getResendEmailAvailability: () => ({ deliveryConfigured: true, webhookConfigured: true }),
}));
vi.mock("@/modules/communications/email-delivery", () => ({
  ExternalEmailDeliveryError: class ExternalEmailDeliveryError extends Error {},
  processExternalEmailQueue: mocks.processExternalEmailQueue,
}));

import {
  AnnouncementBroadcastReviewFacts,
  announcementBroadcastConfirmState,
  workerDeliveryLabel,
} from "@/components/announcement-broadcast-review";
import { BoundedFileCache } from "@/modules/communications/email-attachments";
import { EMAIL_DELIVERY_BATCH_SIZE, outboxSweepIntervalSeconds } from "@/modules/communications/delivery-timing";
import { BACKGROUND_MAILER_FILE_BYTES_THRESHOLD, announcementBodyForDisplay } from "@/modules/communications/message-file-rules";
import { computeAnnouncementBroadcastPreview } from "@/modules/communications/announcement-broadcast-preview";
import { assertAnnouncementFits, MessageFileError } from "@/modules/communications/message-files";
import { processQueuedMessageIdsAfterCommit } from "@/modules/communications/messaging-repository";

const MB = 1024 * 1024;

describe("BoundedFileCache (#824)", () => {
  const bytes = (size: number) => new Uint8Array(size);

  it("shares a read in flight and serves a file from memory the second time", async () => {
    const cache = new BoundedFileCache(10 * MB);
    const load = vi.fn(async () => bytes(1000));
    const [first, second] = await Promise.all([cache.read("a", load), cache.read("a", load)]);
    expect(first).toBe(second);
    await cache.read("a", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("holds no more than its cap, dropping the least recently used file first", async () => {
    const cache = new BoundedFileCache(3 * MB);
    for (const key of ["a", "b", "c"]) await cache.read(key, async () => bytes(MB));
    await cache.read("a", async () => bytes(MB)); // a is now the most recently used
    await cache.read("d", async () => bytes(MB)); // over the cap: b goes
    await Promise.resolve();
    expect(cache.bytes).toBeLessThanOrEqual(3 * MB);
    const reload = vi.fn(async () => bytes(MB));
    await cache.read("a", reload);
    await cache.read("b", reload);
    expect(reload).toHaveBeenCalledTimes(1); // only b was evicted
  });

  it("does not keep a file larger than the whole cap, and forgets a failed read", async () => {
    const cache = new BoundedFileCache(MB);
    await cache.read("big", async () => bytes(5 * MB));
    expect(cache.bytes).toBe(0);
    const flaky = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(bytes(10));
    await expect(cache.read("f", flaky)).rejects.toThrow("busy");
    await Promise.resolve();
    await expect(cache.read("f", flaky)).resolves.toHaveLength(10);
  });
});

describe("the announcement review counts pictures and files alike (#824)", () => {
  const candidates = [{ registrationId: "r1", contactSnapshot: { email: "a@example.test" }, accountHolderNormalizedEmail: null }];
  const base = {
    eventId: "event-1",
    announcement: { id: "an-1", title: "T", body: "B" },
    deliveryMode: "EXTERNAL_EMAIL" as const,
    templateEnabled: true,
    templateVersionId: "v1",
  };

  it("reports carriesFiles for a picture-only send, and not for a plain one", () => {
    expect(computeAnnouncementBroadcastPreview(candidates, base).carriesFiles).toBe(false);
    expect(computeAnnouncementBroadcastPreview(candidates, { ...base, pictureIds: ["p1"] }).carriesFiles).toBe(true);
    expect(computeAnnouncementBroadcastPreview(candidates, { ...base, attachments: [{ id: "f", filename: "a.pdf", sizeBytes: 5 }] }).carriesFiles).toBe(true);
  });

  it("defers only when the files total over the threshold, and reports the worker numbers from the server", () => {
    const small = computeAnnouncementBroadcastPreview(candidates, { ...base, pictureIds: ["p1"], pictureBytes: 100 * 1024 });
    expect(small.carriesFiles).toBe(true);
    expect(small.sentByBackgroundMailer).toBe(false);
    const attachmentAndPicture = computeAnnouncementBroadcastPreview(candidates, {
      ...base,
      pictureIds: ["p1"],
      pictureBytes: BACKGROUND_MAILER_FILE_BYTES_THRESHOLD,
      attachments: [{ id: "f", filename: "a.pdf", sizeBytes: 1 }],
    });
    expect(attachmentAndPicture.sentByBackgroundMailer).toBe(true);
    expect(computeAnnouncementBroadcastPreview(candidates, { ...base, deliveryMode: "LOCAL_CAPTURE", pictureIds: ["p1"], pictureBytes: 3 * MB }).sentByBackgroundMailer).toBe(false);
    expect(small.workerBatchSize).toBe(EMAIL_DELIVERY_BATCH_SIZE);
    expect(small.workerSweepSeconds).toBe(outboxSweepIntervalSeconds());
    expect(outboxSweepIntervalSeconds({})).toBe(300);
    expect(outboxSweepIntervalSeconds({ OUTBOX_SWEEP_INTERVAL_SECONDS: "120" })).toBe(120);
    expect(outboxSweepIntervalSeconds({ OUTBOX_SWEEP_INTERVAL_SECONDS: "nope" })).toBe(300);
    const html = renderToStaticMarkup(createElement(AnnouncementBroadcastReviewFacts, { preview: small }));
    expect(html).toContain("Sends immediately by email");
  });

  it("turns a picture problem into the attachment problem that blocks Send, and changes the fingerprint", () => {
    const fine = computeAnnouncementBroadcastPreview(candidates, { ...base, pictureIds: ["p1"] });
    const broken = computeAnnouncementBroadcastPreview(candidates, { ...base, pictureIds: ["p1"], pictureProblem: "The pictures in a message may total 6.0 MB or less; these total 6.8 MB." });
    expect(fine.attachmentProblem).toBeNull();
    expect(broken.attachmentProblem).toMatch(/6\.8 MB/);
    expect(announcementBroadcastConfirmState({ loading: false, error: "", preview: broken })).toMatchObject({ canConfirm: false });
    expect(computeAnnouncementBroadcastPreview(candidates, { ...base, pictureIds: ["p1", "p2"] }).fingerprint).not.toBe(fine.fingerprint);
  });

  it("words the dialog by the same condition, with the time from the audience size", () => {
    const timing = { workerBatchSize: 50, workerSweepSeconds: 300 };
    expect(workerDeliveryLabel(1, timing)).toContain("about 5 minutes");
    expect(workerDeliveryLabel(50, timing)).toContain("about 5 minutes");
    expect(workerDeliveryLabel(51, timing)).toContain("about 10 minutes");
    expect(workerDeliveryLabel(300, timing)).toContain("about 30 minutes");
    expect(workerDeliveryLabel(300, { workerBatchSize: 100, workerSweepSeconds: 600 })).toContain("batches of 100");
    expect(workerDeliveryLabel(300, { workerBatchSize: 100, workerSweepSeconds: 600 })).toContain("about 30 minutes");
    const pictureOnly = computeAnnouncementBroadcastPreview(candidates, { ...base, pictureIds: ["p1"], pictureBytes: 3 * MB });
    const html = renderToStaticMarkup(createElement(AnnouncementBroadcastReviewFacts, { preview: pictureOnly }));
    expect(html).toContain("background mailer");
    expect(html).not.toContain("immediately");
    const plain = renderToStaticMarkup(createElement(AnnouncementBroadcastReviewFacts, { preview: computeAnnouncementBroadcastPreview(candidates, base) }));
    expect(plain).toContain("Sends immediately by email");
  });
});

describe("processQueuedMessageIdsAfterCommit leaves real email with files to the worker (#824)", () => {
  const file = (sizeBytes: number) => ({ file: { sizeBytes } });
  function prismaWith(messages: Array<{ id: string; mode: string; files: Array<{ file: { sizeBytes: number } }> }>) {
    const tx = {
      messageOutbox: {
        findMany: vi.fn(async () => messages.map((message) => ({
          id: message.id,
          eventId: "event-1",
          files: message.files,
        }))),
      },
      // The effective delivery of the event (#1043), which every message in these cases shares.
      eventMessageSettings: { findUnique: vi.fn(async () => ({ deliveryMode: messages[0]?.mode })) },
    };
    mocks.getPrisma.mockReturnValue(tx);
    return tx;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processExternalEmailQueue.mockResolvedValue({ sentIds: [], failedIds: [], rescheduledIds: [] });
  });

  it("sends small-file messages in the request and defers those whose files total over the threshold", async () => {
    prismaWith([
      { id: "plain", mode: "EXTERNAL_EMAIL", files: [] },
      { id: "logo", mode: "EXTERNAL_EMAIL", files: [file(40 * 1024)] },
      { id: "at-limit", mode: "EXTERNAL_EMAIL", files: [file(BACKGROUND_MAILER_FILE_BYTES_THRESHOLD)] },
      { id: "big", mode: "EXTERNAL_EMAIL", files: [file(BACKGROUND_MAILER_FILE_BYTES_THRESHOLD), file(1)] },
      { id: "two-medium", mode: "EXTERNAL_EMAIL", files: [file(MB * 1.5), file(MB * 1.5)] },
    ]);
    const result = await processQueuedMessageIdsAfterCommit(["plain", "logo", "at-limit", "big", "two-medium"]);
    expect(result.deferredIds).toEqual(["big", "two-medium"]);
    expect(mocks.processExternalEmailQueue).toHaveBeenCalledTimes(1);
    expect(mocks.processExternalEmailQueue).toHaveBeenCalledWith("event-1", expect.objectContaining({ messageIds: ["plain", "logo", "at-limit"] }));
  });

  it("calls the sender not at all when every message is over the threshold", async () => {
    prismaWith([{ id: "a", mode: "EXTERNAL_EMAIL", files: [file(3 * MB)] }]);
    const result = await processQueuedMessageIdsAfterCommit(["a"]);
    expect(result.deferredIds).toEqual(["a"]);
    expect(mocks.processExternalEmailQueue).not.toHaveBeenCalled();
  });
});

describe("assertAnnouncementFits (#824)", () => {
  const picture = "cm9abc123def456";
  const other = "cm9zzz987yxw654";

  function client(options: { pictureRows?: Array<{ sizeBytes: number }>; templateBody?: string; fileRows?: Array<{ id: string; sizeBytes: number }> }) {
    return {
      messageTemplateVersion: { findFirst: vi.fn(async () => (options.templateBody === undefined ? null : { bodyTemplate: options.templateBody, files: [] })) },
      messageFile: {
        findMany: vi.fn(async (args: { where: { isInlineImage?: boolean } }) => (args.where.isInlineImage ? options.pictureRows ?? [] : options.fileRows ?? [])),
      },
    };
  }

  it("does nothing, and asks the database nothing, for an announcement with no files and no pictures", async () => {
    const db = client({});
    await assertAnnouncementFits(db as never, "event-1", { body: "Plain text.", fileIds: [] });
    expect(db.messageFile.findMany).not.toHaveBeenCalled();
  });

  it("refuses a picture that is not this event's own inline image (another event's, or an attachment)", async () => {
    // The lookup is scoped to the event and to inline images, so a stranger comes back as a missing row.
    const db = client({ pictureRows: [] });
    await expect(assertAnnouncementFits(db as never, "event-1", { body: `![x](msgfile:${picture})`, fileIds: [] }))
      .rejects.toBeInstanceOf(MessageFileError);
    expect(db.messageFile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventId: "event-1", isInlineImage: true }) }));
  });

  it("counts the template's pictures with the announcement's, against 6 MB and 30", async () => {
    const big = { sizeBytes: 3.5 * MB };
    const db = client({ pictureRows: [big, big], templateBody: `![t](msgfile:${other})` });
    await expect(assertAnnouncementFits(db as never, "event-1", { body: `![x](msgfile:${picture})`, fileIds: [] }))
      .rejects.toMatchObject({ code: "FILE_SET_INVALID", message: expect.stringContaining("6.0 MB") });
    const fits = client({ pictureRows: [{ sizeBytes: MB }, { sizeBytes: MB }], templateBody: `![t](msgfile:${other})` });
    await expect(assertAnnouncementFits(fits as never, "event-1", { body: `![x](msgfile:${picture})`, fileIds: [] })).resolves.toBeUndefined();
  });
});

describe("announcementBodyForDisplay (#847)", () => {
  it("drops picture markers and the button marker, keeping a picture's description", () => {
    expect(announcementBodyForDisplay("Hello\n\n![Map of the grounds](msgfile:cm9abc123def456)\n\n[Register](https://example.test/r){.button}"))
      .toBe("Hello\n\n[Image: Map of the grounds]\n\n[Register](https://example.test/r)");
    expect(announcementBodyForDisplay("![](msgfile:cm9abc123def456)")).toBe("");
    expect(announcementBodyForDisplay("Before\n\n![](msgfile:cm9abc123def456)\n\n\n\nAfter")).toBe("Before\n\nAfter");
    expect(announcementBodyForDisplay("plain text")).toBe("plain text");
    expect(announcementBodyForDisplay("see msgfile:cm9abc123def456")).not.toContain("![");
  });
});
