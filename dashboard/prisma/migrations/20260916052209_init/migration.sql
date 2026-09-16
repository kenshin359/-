-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ProductSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Sku_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ProductSeries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkuCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skuId" TEXT NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validTo" DATETIME,
    CONSTRAINT "SkuCost_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "channelId" TEXT NOT NULL,
    "storeCode" TEXT NOT NULL DEFAULT 'main',
    "orderNo" TEXT NOT NULL,
    "orderDate" DATETIME NOT NULL,
    "shipDate" DATETIME,
    "status" TEXT NOT NULL,
    "shippingRevenue" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "taxMode" TEXT NOT NULL DEFAULT 'exclusive',
    CONSTRAINT "Order_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "costAtSale" INTEGER,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "refundDate" DATETIME NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "date" DATETIME NOT NULL,
    "mediaId" TEXT NOT NULL,
    "account" TEXT NOT NULL DEFAULT 'main',
    "campaign" TEXT NOT NULL DEFAULT '-',
    "spend" INTEGER NOT NULL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "mediaCv" INTEGER,
    "attributedRevenue" INTEGER,
    "attributionWindow" TEXT,
    CONSTRAINT "AdDaily_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccessDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "date" DATETIME NOT NULL,
    "channelId" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "users" INTEGER,
    "pv" INTEGER,
    CONSTRAINT "AccessDaily_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Cost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "date" DATETIME NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeCode" TEXT NOT NULL DEFAULT 'all',
    "costType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "InventoryMove" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "date" DATETIME NOT NULL,
    "skuId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "moveType" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "operator" TEXT,
    "poLineId" TEXT,
    CONSTRAINT "InventoryMove_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryMove_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "poNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignee" TEXT,
    "etaDate" DATETIME,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PoLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "fxRate" REAL,
    "received" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PoLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PoLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeCode" TEXT NOT NULL DEFAULT 'all',
    "metric" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT,
    "dueDate" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'mid',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "relation" TEXT,
    "proposalId" TEXT,
    "doneMemo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'rule',
    "ruleCode" TEXT,
    "title" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "targetLabel" TEXT,
    "facts" TEXT NOT NULL,
    "period" TEXT,
    "dataAsOf" DATETIME,
    "hypothesis" TEXT,
    "action" TEXT,
    "effectNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "statusNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "executedById" TEXT,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "rawPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_code_key" ON "Channel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Media_code_key" ON "Media"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSeries_code_key" ON "ProductSeries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_code_key" ON "Sku"("code");

-- CreateIndex
CREATE INDEX "SkuCost_skuId_validFrom_idx" ON "SkuCost"("skuId", "validFrom");

-- CreateIndex
CREATE INDEX "Order_shipDate_idx" ON "Order"("shipDate");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channelId_storeCode_orderNo_key" ON "Order"("channelId", "storeCode", "orderNo");

-- CreateIndex
CREATE INDEX "OrderItem_skuId_idx" ON "OrderItem"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_lineNo_key" ON "OrderItem"("orderId", "lineNo");

-- CreateIndex
CREATE INDEX "Refund_refundDate_idx" ON "Refund"("refundDate");

-- CreateIndex
CREATE UNIQUE INDEX "AdDaily_date_mediaId_account_campaign_key" ON "AdDaily"("date", "mediaId", "account", "campaign");

-- CreateIndex
CREATE UNIQUE INDEX "AccessDaily_date_channelId_key" ON "AccessDaily"("date", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Cost_date_scope_scopeCode_costType_key" ON "Cost"("date", "scope", "scopeCode", "costType");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMove_poLineId_key" ON "InventoryMove"("poLineId");

-- CreateIndex
CREATE INDEX "InventoryMove_skuId_date_idx" ON "InventoryMove"("skuId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNo_key" ON "PurchaseOrder"("poNo");

-- CreateIndex
CREATE UNIQUE INDEX "PoLine_poId_skuId_key" ON "PoLine"("poId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "Target_month_scope_scopeCode_metric_key" ON "Target"("month", "scope", "scopeCode", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "Task_proposalId_key" ON "Task"("proposalId");
