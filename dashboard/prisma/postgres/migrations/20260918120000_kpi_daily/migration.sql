-- CreateTable
CREATE TABLE "KpiDaily" (
    "date" TEXT NOT NULL,
    "salesRakuten" INTEGER NOT NULL DEFAULT 0,
    "salesAmazon" INTEGER NOT NULL DEFAULT 0,
    "salesOwn" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER,
    "adGoogle" INTEGER NOT NULL DEFAULT 0,
    "adRakuten" INTEGER NOT NULL DEFAULT 0,
    "adAmazon" INTEGER NOT NULL DEFAULT 0,
    "adMeta" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ingest',
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDaily_pkey" PRIMARY KEY ("date")
);

