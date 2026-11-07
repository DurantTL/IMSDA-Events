import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The app's database client. Every audit row written through it, in a transaction or not, gets the Clubs Administrator
 * marker when it applies (#1643, `modules/audit/clubs-administrator-marker.ts`). The marker's lookups run on the plain
 * client below, outside the caller's transaction. The extended client is typed as `PrismaClient`: the extension changes
 * what two writes store and nothing else.
 */
function createClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return base.$extends({
    query: {
      auditLog: {
        async create({ args, query }) {
          const { withClubsAdministratorMarker } = await import("@/modules/audit/clubs-administrator-marker");
          return query({ ...args, data: await withClubsAdministratorMarker(args.data, base) });
        },
        async createMany({ args, query }) {
          const { withClubsAdministratorMarker } = await import("@/modules/audit/clubs-administrator-marker");
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          const marked = await Promise.all(rows.map((row) => withClubsAdministratorMarker(row, base)));
          return query({ ...args, data: Array.isArray(args.data) ? marked : marked[0] });
        },
      },
    },
  }) as unknown as PrismaClient;
}

export function getPrisma(): PrismaClient {
  getServerEnv();

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }

  return globalForPrisma.prisma;
}
