-- CreateTable
CREATE TABLE "LoginFailure" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "until" DATETIME NOT NULL
);
