/**
 * Child of scripts/verify-clubs-admin-club-events.ts (#1643): runs against the app's own client (`getPrisma()`, so its audit
 * extension) with DATABASE_URL set to a one-connection pool. Inside a request context it checks event access through the
 * Clubs Administrator role, then runs three concurrent audited transactions that are rolled back after reading their own
 * audit row. Prints one JSON line: how long it took and whether each row carried the marker.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getPrisma } = await import("../../lib/prisma");
  const { runWithRequestContext } = await import("../../lib/request-context");
  const { requirePermission } = await import("../../modules/access/authorization");
  const { findActiveMembership } = await import("../../modules/events/repository");
  const userId = process.env.CACE_USER_ID!;
  const eventId = process.env.CACE_EVENT_ID!;
  const prisma = getPrisma();
  const started = Date.now();
  const marked = await runWithRequestContext({ correlationId: "cace-pool-child" }, async () => {
    await requirePermission({ user: { id: userId, email: `${userId}@example.test`, displayName: userId, globalRole: null } }, eventId, "CONFIGURE_EVENT", findActiveMembership);
    return Promise.all([1, 2, 3].map(async (n) => {
      const rollback = new Error("rollback");
      let result = false;
      try {
        await prisma.$transaction(async (tx) => {
          const row = await tx.auditLog.create({ data: { eventId, actorUserId: userId, action: `CACE_POOLCHILD_${n}`, entityType: "Tag", entityId: `${eventId}_tag`, correlationId: `${eventId}_pc${n}`, summary: "Check entry." } });
          result = (row.metadata as Record<string, unknown> | null)?.actorRole === "CLUBS_ADMINISTRATOR";
          throw rollback;
        }, { timeout: 5000 });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      return result;
    }));
  });
  console.log(JSON.stringify({ ms: Date.now() - started, marked }));
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
