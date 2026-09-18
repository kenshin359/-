-- AlterTable
ALTER TABLE "Task" ADD COLUMN "assigneeName" TEXT;
ALTER TABLE "Task" ADD COLUMN "doneDef" TEXT;
ALTER TABLE "Task" ADD COLUMN "impact" TEXT;
ALTER TABLE "Task" ADD COLUMN "kPriority" TEXT;
ALTER TABLE "Task" ADD COLUMN "kintoneId" TEXT;
ALTER TABLE "Task" ADD COLUMN "memo" TEXT;
ALTER TABLE "Task" ADD COLUMN "team" TEXT;
ALTER TABLE "Task" ADD COLUMN "yanai" TEXT;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "department" TEXT,
    "url" TEXT NOT NULL,
    "note" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_kintoneId_key" ON "Task"("kintoneId");

