-- Staff Home layout (#1705). Additive: one table holding each person's own module order and shown/hidden choices. Moves no data.

-- CreateTable
CREATE TABLE "StaffHomeLayout" (
    "userId" TEXT NOT NULL,
    "modules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffHomeLayout_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "StaffHomeLayout" ADD CONSTRAINT "StaffHomeLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
