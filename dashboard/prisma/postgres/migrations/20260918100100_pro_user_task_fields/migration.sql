-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kintoneName" TEXT,
ADD COLUMN     "level" TEXT NOT NULL DEFAULT 'staff',
ADD COLUMN     "lineUserId" TEXT,
ADD COLUMN     "skills" TEXT,
ADD COLUMN     "teamCode" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "kpiCode" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "projectCode" TEXT,
ADD COLUMN     "requestedByUserId" TEXT;

