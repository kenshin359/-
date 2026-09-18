-- CreateTable
CREATE TABLE "Team" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentCode" TEXT,
    "leaderUserId" TEXT,
    "kintoneLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamCode" TEXT,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "goal" TEXT,
    "kpiCode" TEXT,
    "startDate" DATETIME,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Kpi" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'up',
    "targetValue" REAL,
    "warnThreshold" REAL,
    "dangerThreshold" REAL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "teamCode" TEXT,
    "ownerUserId" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "KpiValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiCode" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "note" TEXT,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "KpiValue_kpiCode_fkey" FOREIGN KEY ("kpiCode") REFERENCES "Kpi" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "teamCode" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "reviewedByUserId" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "teamCode" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "mutedUntil" DATETIME
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LineGroup" (
    "groupId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "teamCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LineMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "lineMessageId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "ts" DATETIME NOT NULL,
    "extractedJson" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LineGroup" ("groupId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceMessageId" TEXT,
    "groupId" TEXT,
    "title" TEXT NOT NULL,
    "assigneeName" TEXT,
    "due" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "taskId" TEXT,
    "remindAt" DATETIME,
    "remindedCount" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUp_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "LineMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "KpiValue_kpiCode_date_key" ON "KpiValue"("kpiCode", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_code_entityType_entityId_key" ON "Alert"("code", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "LineMessage_lineMessageId_key" ON "LineMessage"("lineMessageId");

