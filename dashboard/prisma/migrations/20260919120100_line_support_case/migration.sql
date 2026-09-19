-- CreateTable
CREATE TABLE "LineCase" (
    "no" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lineUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastUserText" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "LineCase_lineUserId_status_idx" ON "LineCase"("lineUserId", "status");

-- CreateIndex
CREATE INDEX "LineCase_status_updatedAt_idx" ON "LineCase"("status", "updatedAt");
