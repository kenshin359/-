-- CreateTable
CREATE TABLE "LineCase" (
    "no" SERIAL NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastUserText" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LineCase_pkey" PRIMARY KEY ("no")
);

-- CreateIndex
CREATE INDEX "LineCase_lineUserId_status_idx" ON "LineCase"("lineUserId", "status");

-- CreateIndex
CREATE INDEX "LineCase_status_updatedAt_idx" ON "LineCase"("status", "updatedAt");

