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
    "account_type" TEXT,
    "account_name" TEXT,
    "institution_name" TEXT,
    "tax_deductible" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    CONSTRAINT "bank_transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_bank_transactions" ("amount", "category", "created_at", "date", "description", "id", "import_id", "raw_data", "reconciled", "reconciliation_status") SELECT "amount", "category", "created_at", "date", "description", "id", "import_id", "raw_data", "reconciled", "reconciliation_status" FROM "bank_transactions";
DROP TABLE "bank_transactions";
ALTER TABLE "new_bank_transactions" RENAME TO "bank_transactions";
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
    "discounts" REAL NOT NULL DEFAULT 0,
    "raw_data" TEXT,
    "import_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "item_category" TEXT,
    "dining_option" TEXT,
    "channel" TEXT,
    "card_brand" TEXT,
    "fulfillment_type" TEXT,
    "customer_fees" REAL NOT NULL DEFAULT 0,
    "marketing_fees" REAL NOT NULL DEFAULT 0,
    "refunds" REAL NOT NULL DEFAULT 0,
    "adjustments" REAL NOT NULL DEFAULT 0,
    "linked_payout_id" TEXT,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    CONSTRAINT "platform_orders_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "platform_orders_linked_payout_id_fkey" FOREIGN KEY ("linked_payout_id") REFERENCES "payouts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_platform_orders" ("commission_fee", "created_at", "delivery_fee", "id", "import_id", "linked_payout_id", "net_payout", "order_datetime", "order_id", "platform", "raw_data", "reconciliation_status", "service_fee", "subtotal", "tax", "tip") SELECT "commission_fee", "created_at", "delivery_fee", "id", "import_id", "linked_payout_id", "net_payout", "order_datetime", "order_id", "platform", "raw_data", "reconciliation_status", "service_fee", "subtotal", "tax", "tip" FROM "platform_orders";
DROP TABLE "platform_orders";
ALTER TABLE "new_platform_orders" RENAME TO "platform_orders";
CREATE UNIQUE INDEX "platform_orders_order_id_platform_key" ON "platform_orders"("order_id", "platform");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
