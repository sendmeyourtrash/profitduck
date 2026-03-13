-- CreateTable
CREATE TABLE "reconciliation_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "platform" TEXT,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "payout_id" TEXT,
    "bank_transaction_id" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" DATETIME,
    "resolved_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bank_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "category" TEXT,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    CONSTRAINT "bank_transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_bank_transactions" ("amount", "category", "created_at", "date", "description", "id", "import_id", "raw_data", "reconciled") SELECT "amount", "category", "created_at", "date", "description", "id", "import_id", "raw_data", "reconciled" FROM "bank_transactions";
DROP TABLE "bank_transactions";
ALTER TABLE "new_bank_transactions" RENAME TO "bank_transactions";
CREATE TABLE "new_payouts" (
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
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    "expected_amount" REAL,
    "amount_variance" REAL,
    CONSTRAINT "payouts_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payouts_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_payouts" ("bank_transaction_id", "created_at", "fees", "gross_amount", "id", "import_id", "net_amount", "payout_date", "platform", "raw_data") SELECT "bank_transaction_id", "created_at", "fees", "gross_amount", "id", "import_id", "net_amount", "payout_date", "platform", "raw_data" FROM "payouts";
DROP TABLE "payouts";
ALTER TABLE "new_payouts" RENAME TO "payouts";
CREATE UNIQUE INDEX "payouts_bank_transaction_id_key" ON "payouts"("bank_transaction_id");
CREATE TABLE "new_platform_orders" (
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
    "linked_payout_id" TEXT,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    CONSTRAINT "platform_orders_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "platform_orders_linked_payout_id_fkey" FOREIGN KEY ("linked_payout_id") REFERENCES "payouts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_platform_orders" ("commission_fee", "created_at", "delivery_fee", "id", "import_id", "net_payout", "order_datetime", "order_id", "platform", "raw_data", "service_fee", "subtotal", "tax", "tip") SELECT "commission_fee", "created_at", "delivery_fee", "id", "import_id", "net_payout", "order_datetime", "order_id", "platform", "raw_data", "service_fee", "subtotal", "tax", "tip" FROM "platform_orders";
DROP TABLE "platform_orders";
ALTER TABLE "new_platform_orders" RENAME TO "platform_orders";
CREATE UNIQUE INDEX "platform_orders_order_id_platform_key" ON "platform_orders"("order_id", "platform");
CREATE TABLE "new_transactions" (
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
    "linked_payout_id" TEXT,
    "linked_bank_transaction_id" TEXT,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    CONSTRAINT "transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_linked_payout_id_fkey" FOREIGN KEY ("linked_payout_id") REFERENCES "payouts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_linked_bank_transaction_id_fkey" FOREIGN KEY ("linked_bank_transaction_id") REFERENCES "bank_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("amount", "category", "created_at", "date", "description", "id", "import_id", "raw_data", "raw_source_id", "source_platform", "type") SELECT "amount", "category", "created_at", "date", "description", "id", "import_id", "raw_data", "raw_source_id", "source_platform", "type" FROM "transactions";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
