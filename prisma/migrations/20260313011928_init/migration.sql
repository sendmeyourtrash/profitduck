-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "source_platform" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "raw_source_id" TEXT,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "platform_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "order_datetime" DATETIME NOT NULL,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "delivery_fee" REAL NOT NULL DEFAULT 0,
    "service_fee" REAL NOT NULL DEFAULT 0,
    "commission_fee" REAL NOT NULL DEFAULT 0,
    "tip" REAL NOT NULL DEFAULT 0,
    "net_payout" REAL NOT NULL DEFAULT 0,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_orders_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "default_account" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendor_id" TEXT,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "category" TEXT,
    "payment_method" TEXT,
    "notes" TEXT,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "payout_date" DATETIME NOT NULL,
    "gross_amount" REAL NOT NULL,
    "fees" REAL NOT NULL DEFAULT 0,
    "net_amount" REAL NOT NULL,
    "bank_transaction_id" TEXT,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payouts_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payouts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "category" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "imported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_orders_order_id_platform_key" ON "platform_orders"("order_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_bank_transaction_id_key" ON "payouts"("bank_transaction_id");
