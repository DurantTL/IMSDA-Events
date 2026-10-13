import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";

/** A transaction PostgreSQL rolled back so it can run again against what the winner committed. */
export function retryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2034" || error.code === "P2002")
  )
    // The registration row lock is a raw query, and a raw query reports PostgreSQL's own failure as P2010 with the
    // SQLSTATE in `meta.code`: "could not serialize access due to concurrent update" (40001) when another
    // transaction committed since this one's snapshot, or a deadlock (40P01).
    || (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2010"
      && /^(40001|40P01)$/.test(String((error.meta as { code?: unknown } | undefined)?.code ?? ""))
    )
    // Two payment paths settling one balance can lock the same rows in opposite orders; the
    // loser is rolled back by PostgreSQL (deadlock 40P01, serialization failure 40001) and runs
    // again against what the winner committed.
    || (
      error instanceof Prisma.PrismaClientUnknownRequestError
      && /40P01|40001|deadlock detected/.test(error.message)
    );
}

/**
 * Runs `operation` in a SERIALIZABLE transaction, again from the top when PostgreSQL rolls it back. Every check and
 * every write belongs inside `operation`: a retry re-reads and re-decides everything, and anything written before the
 * rollback is gone with it, so a retried operation writes its records (audit included) exactly once.
 *
 * Both the card payment path and staff payment recording run through here. That is what makes the registration row
 * lock enough: a transaction that read a registration's payments before another committed a deposit cannot commit
 * on its stale read, it is rolled back and retried.
 */
export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  exhausted: () => Error,
) {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!retryableTransactionError(error)) throw error;
    }
  }
  throw exhausted();
}
