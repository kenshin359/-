-- CreateTable
CREATE TABLE "CpaDaily" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "suitcaseSales" INTEGER,
    "meta" INTEGER NOT NULL DEFAULT 0,
    "amazonAds" INTEGER NOT NULL DEFAULT 0,
    "rpp" INTEGER NOT NULL DEFAULT 0,
    "google" INTEGER NOT NULL DEFAULT 0,
    "other" INTEGER NOT NULL DEFAULT 0,
    "unitsAmazon" INTEGER NOT NULL DEFAULT 0,
    "unitsRakuten" INTEGER NOT NULL DEFAULT 0,
    "unitsOwn" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

