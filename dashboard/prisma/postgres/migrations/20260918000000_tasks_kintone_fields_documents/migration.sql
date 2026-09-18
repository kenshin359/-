-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "assigneeName" TEXT,
ADD COLUMN     "doneDef" TEXT,
ADD COLUMN     "impact" TEXT,
ADD COLUMN     "kPriority" TEXT,
ADD COLUMN     "kintoneId" TEXT,
ADD COLUMN     "memo" TEXT,
ADD COLUMN     "team" TEXT,
ADD COLUMN     "yanai" TEXT;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "department" TEXT,
    "url" TEXT NOT NULL,
    "note" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_kintoneId_key" ON "Task"("kintoneId");

