import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const tx = {
    questionLibraryItem: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { tx, prisma: { ...tx, $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => db.prisma }));

import { archiveLibraryItem, createLibraryItem, updateLibraryItem } from "@/modules/question-library/repository";
import { QuestionLibraryError } from "@/modules/question-library/domain";

/** Library writes are validated, audited with ids and counts only, and delete archives. Synthetic data only. */

const field = { id: "field_1", key: "shirt_size", label: "Shirt size", helpText: "", type: "TEXT", scope: "REGISTRATION", required: false, options: [] };
const actor = { userId: "user-1", eventId: "event-1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.tx.questionLibraryItem.create.mockResolvedValue({ id: "item-1" });
  db.tx.questionLibraryItem.findFirst.mockResolvedValue({ id: "item-1" });
});

describe("question library writes", () => {
  it("validates before any write", async () => {
    await expect(createLibraryItem({ name: "Bad", description: "", fields: [{ ...field, key: "promo_code" }] }, actor)).rejects.toBeInstanceOf(QuestionLibraryError);
    expect(db.tx.questionLibraryItem.create).not.toHaveBeenCalled();
  });

  it("stores the fragment and the author, and audits ids and counts without question wording", async () => {
    await createLibraryItem({ name: "Shirt size", description: "note", fields: [field] }, actor);
    const data = db.tx.questionLibraryItem.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ name: "Shirt size", createdByUserId: "user-1" });
    expect(data.definition.fields).toHaveLength(1);
    const audit = db.tx.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: "QUESTION_LIBRARY_ITEM_CREATED", entityId: "item-1", eventId: "event-1", actorUserId: "user-1" });
    expect(JSON.stringify(audit)).not.toContain("Shirt size");
  });

  it("edits and audits which parts changed", async () => {
    await updateLibraryItem("item-1", { name: "Renamed" }, { userId: "admin-1" });
    expect(db.tx.questionLibraryItem.update).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { name: "Renamed" } });
    expect(db.tx.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "QUESTION_LIBRARY_ITEM_EDITED", metadata: { changed: ["name"] } });
  });

  it("refuses to edit or delete an item that is gone", async () => {
    db.tx.questionLibraryItem.findFirst.mockResolvedValue(null);
    await expect(updateLibraryItem("missing", { name: "x" }, { userId: "admin-1" })).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    await expect(archiveLibraryItem("missing", { userId: "admin-1" })).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
    expect(db.tx.questionLibraryItem.update).not.toHaveBeenCalled();
  });

  it("delete archives the row, keeps it, and audits", async () => {
    await archiveLibraryItem("item-1", { userId: "admin-1" });
    const update = db.tx.questionLibraryItem.update.mock.calls[0]![0];
    expect(update.where).toEqual({ id: "item-1" });
    expect(update.data.archivedAt).toBeInstanceOf(Date);
    expect(db.tx.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "QUESTION_LIBRARY_ITEM_DELETED" });
  });
});
