-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "expense_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "categorization_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_from" TEXT NOT NULL DEFAULT 'manual',
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categorization_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'user',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transaction_id" TEXT,
    CONSTRAINT "audit_logs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_expenses" (
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
    "expense_category_id" TEXT,
    CONSTRAINT "expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_expenses" ("amount", "category", "created_at", "date", "id", "import_id", "notes", "payment_method", "raw_data", "vendor_id") SELECT "amount", "category", "created_at", "date", "id", "import_id", "notes", "payment_method", "raw_data", "vendor_id" FROM "expenses";
DROP TABLE "expenses";
ALTER TABLE "new_expenses" RENAME TO "expenses";
CREATE TABLE "new_imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "imported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "file_hash" TEXT,
    "date_range_start" DATETIME,
    "date_range_end" DATETIME,
    "duplicate_of" TEXT,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_imports" ("error_message", "file_name", "id", "imported_at", "rows_failed", "rows_processed", "source", "status") SELECT "error_message", "file_name", "id", "imported_at", "rows_failed", "rows_processed", "source", "status" FROM "imports";
DROP TABLE "imports";
ALTER TABLE "new_imports" RENAME TO "imports";
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
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "linked_payout_id" TEXT,
    "linked_bank_transaction_id" TEXT,
    "reconciliation_status" TEXT NOT NULL DEFAULT 'unreconciled',
    CONSTRAINT "transactions_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_linked_payout_id_fkey" FOREIGN KEY ("linked_payout_id") REFERENCES "payouts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transactions_linked_bank_transaction_id_fkey" FOREIGN KEY ("linked_bank_transaction_id") REFERENCES "bank_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_transactions" ("amount", "category", "created_at", "date", "description", "id", "import_id", "linked_bank_transaction_id", "linked_payout_id", "raw_data", "raw_source_id", "reconciliation_status", "source_platform", "type") SELECT "amount", "category", "created_at", "date", "description", "id", "import_id", "linked_bank_transaction_id", "linked_payout_id", "raw_data", "raw_source_id", "reconciliation_status", "source_platform", "type" FROM "transactions";
DROP TABLE "transactions";
ALTER TABLE "new_transactions" RENAME TO "transactions";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");
