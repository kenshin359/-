-- CreateTable
CREATE TABLE "ProductSalesDaily" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "rawChannel" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ingest',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSalesDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSalesDaily_date_idx" ON "ProductSalesDaily"("date");

-- CreateIndex
CREATE INDEX "ProductSalesDaily_product_idx" ON "ProductSalesDaily"("product");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSalesDaily_date_channel_rawChannel_product_key" ON "ProductSalesDaily"("date", "channel", "rawChannel", "product");

