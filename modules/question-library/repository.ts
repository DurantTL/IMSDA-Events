import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import {
  prepareLibraryFragment,
  QuestionLibraryError,
  readLibraryFragment,
  type QuestionLibraryAdminRow,
  type QuestionLibraryItemView,
} from "@/modules/question-library/domain";

/**
 * The question library (#1070). Authorization is the caller's job (see access.ts): saving and listing for anyone who can
 * build forms, editing and deleting for system administrators only. Nothing here reads or writes an event, a form, a form
 * version, an answer or a registration, and the audit entries carry ids and counts only: never question wording or answers.
 * Delete archives the row, so the audit trail keeps pointing at something.
 */

async function authorNames(userIds: readonly (string | null)[]) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await getPrisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

/** The items the palette offers: readable, not archived, by name. Author names are left out: only the administrator's list shows who saved what. */
export async function listLibraryItems(): Promise<QuestionLibraryItemView[]> {
  const rows = await getPrisma().questionLibraryItem.findMany({ where: { archivedAt: null }, orderBy: [{ name: "asc" }, { createdAt: "asc" }] });
  const items: QuestionLibraryItemView[] = [];
  for (const row of rows) {
    const fragment = readLibraryFragment(row.definition);
    if (!fragment) continue;
    items.push({
      id: row.id, name: row.name, description: row.description, fields: fragment.fields,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    });
  }
  return items;
}

/** Every non-archived item for the administrator's management list, unreadable ones included and flagged. */
export async function listLibraryItemsForAdmin(): Promise<QuestionLibraryAdminRow[]> {
  const rows = await getPrisma().questionLibraryItem.findMany({ where: { archivedAt: null }, orderBy: [{ name: "asc" }, { createdAt: "asc" }] });
  const names = await authorNames(rows.map((row) => row.createdByUserId));
  return rows.map((row) => {
    const fragment = readLibraryFragment(row.definition);
    return {
      id: row.id, name: row.name, description: row.description, unreadable: fragment === null,
      fieldCount: fragment?.fields.length ?? 0, fieldLabels: fragment?.fields.map((field) => field.label) ?? [],
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdByUserId ? names.get(row.createdByUserId) ?? null : null,
    };
  });
}

type Actor = { userId: string; eventId?: string | null };

/** Saves a question (or a small group of questions that belong together) as a library item. Configuration only. */
export async function createLibraryItem(input: { name: string; description: string; fields: unknown }, actor: Actor) {
  const { fragment, replacedAcknowledgments } = prepareLibraryFragment(input.fields);
  const prisma = getPrisma();
  const item = await prisma.$transaction(async (tx) => {
    const row = await tx.questionLibraryItem.create({
      data: { name: input.name, description: input.description, definition: fragment as unknown as Prisma.InputJsonValue, createdByUserId: actor.userId },
    });
    await tx.auditLog.create({ data: {
      actorUserId: actor.userId, ...(actor.eventId ? { eventId: actor.eventId } : {}), action: "QUESTION_LIBRARY_ITEM_CREATED", entityType: "QuestionLibraryItem", entityId: row.id, correlationId: randomUUID(),
      summary: "Saved a question to the question library.",
      metadata: { itemId: row.id, fieldCount: fragment.fields.length, replacedAcknowledgmentCount: replacedAcknowledgments.length, productionWrite: false },
    } });
    return row;
  });
  return { id: item.id, replacedAcknowledgments };
}

/** Renames and/or re-describes an item, and/or replaces its questions. System administrators only (the caller checks). Inserted copies and published versions are never touched. */
export async function updateLibraryItem(id: string, input: { name?: string; description?: string; fields?: unknown }, actor: Actor) {
  const prepared = input.fields === undefined ? null : prepareLibraryFragment(input.fields);
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const current = await tx.questionLibraryItem.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
    if (!current) throw new QuestionLibraryError("ITEM_NOT_FOUND", "That saved question was not found.");
    await tx.questionLibraryItem.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(prepared ? { definition: prepared.fragment as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await tx.auditLog.create({ data: {
      actorUserId: actor.userId, action: "QUESTION_LIBRARY_ITEM_EDITED", entityType: "QuestionLibraryItem", entityId: id, correlationId: randomUUID(),
      summary: "Edited a saved question in the question library.",
      metadata: { itemId: id, changed: [input.name !== undefined ? "name" : null, input.description !== undefined ? "description" : null, prepared ? "questions" : null].filter(Boolean) as string[], ...(prepared ? { fieldCount: prepared.fragment.fields.length } : {}), productionWrite: false },
    } });
  });
}

/** Removes an item from the library (archives it). System administrators only (the caller checks). Questions already added to forms are independent copies and stay. */
export async function archiveLibraryItem(id: string, actor: Actor) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const current = await tx.questionLibraryItem.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
    if (!current) throw new QuestionLibraryError("ITEM_NOT_FOUND", "That saved question was not found.");
    await tx.questionLibraryItem.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.auditLog.create({ data: {
      actorUserId: actor.userId, action: "QUESTION_LIBRARY_ITEM_DELETED", entityType: "QuestionLibraryItem", entityId: id, correlationId: randomUUID(),
      summary: "Deleted a saved question from the question library.",
      metadata: { itemId: id, productionWrite: false },
    } });
  });
}
