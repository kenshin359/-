-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'staff',
    "teamCode" TEXT,
    "title" TEXT,
    "kintoneName" TEXT,
    "lineUserId" TEXT,
    "skills" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "passwordHash", "role") SELECT "createdAt", "email", "id", "name", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueDate" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'mid',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "relation" TEXT,
    "proposalId" TEXT,
    "doneMemo" TEXT,
    "team" TEXT,
    "assigneeName" TEXT,
    "doneDef" TEXT,
    "kPriority" TEXT,
    "impact" TEXT,
    "yanai" TEXT,
    "memo" TEXT,
    "kintoneId" TEXT,
    "projectCode" TEXT,
    "kpiCode" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "requestedByUserId" TEXT,
    "holdReason" TEXT,
    "lastActivityAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "assigneeName", "createdAt", "doneDef", "doneMemo", "dueDate", "id", "impact", "kPriority", "kintoneId", "memo", "priority", "proposalId", "relation", "status", "team", "title", "updatedAt", "yanai") SELECT "assigneeId", "assigneeName", "createdAt", "doneDef", "doneMemo", "dueDate", "id", "impact", "kPriority", "kintoneId", "memo", "priority", "proposalId", "relation", "status", "team", "title", "updatedAt", "yanai" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_proposalId_key" ON "Task"("proposalId");
CREATE UNIQUE INDEX "Task_kintoneId_key" ON "Task"("kintoneId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

