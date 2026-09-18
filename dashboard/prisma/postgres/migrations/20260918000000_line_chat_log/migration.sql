-- CreateTable
CREATE TABLE "LineChatLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "lineUserId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "topics" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineChatLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineChatLog_eventId_key" ON "LineChatLog"("eventId");

-- CreateIndex
CREATE INDEX "LineChatLog_lineUserId_createdAt_idx" ON "LineChatLog"("lineUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LineChatLog_needsHuman_createdAt_idx" ON "LineChatLog"("needsHuman", "createdAt");

