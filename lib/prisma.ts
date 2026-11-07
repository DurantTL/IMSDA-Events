import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { withClubsAdministratorMarker } from "@/modules/audit/clubs-administrator-marker";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The app's database client. Every audit row written through it, in a transaction or not, gets the Clubs Administrator
 * marker when it applies (#1643, `modules/audit/clubs-administrator-marker.ts`). The marker makes no database query: it
 * reads what the permission lookup recorded for the request, so it never needs a second pool connection inside a
 * caller's transaction. The extended client is typed as `PrismaClient` for the rest of the app: the extension changes what
 * two writes store and nothing else, but `$on` and `$use` are not available on an extended client, so code must not call them.
 */
function createClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return base.$extends({
    query: {
      auditLog: {
        async create({ args, query }) {
          return query({ ...args, data: withClubsAdministratorMarker(args.data) });
        },
        async createMany({ args, query }) {
          return query({ ...args, data: Array.isArray(args.data) ? args.data.map((row) => withClubsAdministratorMarker(row)) : withClubsAdministratorMarker(args.data) });
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
