-- Area Coordinator invites (#1276). Additive: one new table, nothing existing is changed. Applying it in production is
-- a human step (back up first).

-- CreateTable
CREATE TABLE "AreaCoordinatorInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" "ClubInviteStatus" NOT NULL DEFAULT 'SENT',
    "createdByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedAccountId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaCoordinatorInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AreaCoordinatorInvite_email_status_idx" ON "AreaCoordinatorInvite"("email", "status");

-- AddForeignKey
ALTER TABLE "AreaCoordinatorInvite" ADD CONSTRAINT "AreaCoordinatorInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaCoordinatorInvite" ADD CONSTRAINT "AreaCoordinatorInvite_acceptedAccountId_fkey" FOREIGN KEY ("acceptedAccountId") REFERENCES "AttendeeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One open (pending or sent) invite per email. A partial unique index, which Prisma's schema cannot express; it is the
-- backstop for two invites for the same email racing each other.
CREATE UNIQUE INDEX "AreaCoordinatorInvite_email_open_key" ON "AreaCoordinatorInvite"("email") WHERE "status" IN ('PENDING', 'SENT');
