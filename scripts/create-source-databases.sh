#!/bin/bash
set -e

DB_DIR="databases"
DATA_DIR="Data Exports"

echo ""
echo "=================================================="
echo "  Creating Source Databases"
echo "=================================================="

# ============================================================
# 1. ROCKET MONEY
# ============================================================
echo ""
echo "🚀 ROCKET MONEY"
rm -f "$DB_DIR/rocketmoney.db"
sqlite3 "$DB_DIR/rocketmoney.db" <<'SQL'
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  original_date TEXT,
  account_type TEXT,
  account_name TEXT,
  account_number TEXT,
  institution_name TEXT,
  name TEXT,
  custom_name TEXT,
  amount REAL,
  description TEXT,
  category TEXT,
  note TEXT,
  ignored_from TEXT,
  tax_deductible TEXT,
  transaction_tags TEXT
);
SQL

sqlite3 "$DB_DIR/rocketmoney.db" <<SQL
.mode csv
.import '${DATA_DIR}/Rocket Money/Rocket Money 2026-03-13T01_00_34.116Z-transactions.csv' transactions_tmp
INSERT INTO transactions (date, original_date, account_type, account_name, account_number, institution_name, name, custom_name, amount, description, category, note, ignored_from, tax_deductible, transaction_tags)
SELECT "Date", "Original Date", "Account Type", "Account Name", "Account Number", "Institution Name", "Name", "Custom Name", CAST("Amount" AS REAL), "Description", "Category", "Note", "Ignored From", "Tax Deductible", "Transaction Tags"
FROM transactions_tmp WHERE "Date" != 'Date';
DROP TABLE transactions_tmp;
SQL

COUNT=$(sqlite3 "$DB_DIR/rocketmoney.db" "SELECT COUNT(*) FROM transactions;")
echo "  ✅ $COUNT rows → rocketmoney.db"

# ============================================================
# 2. SQUAREUP
# ============================================================
echo ""
echo "🟧 SQUAREUP"
rm -f "$DB_DIR/squareup.db"
sqlite3 "$DB_DIR/squareup.db" <<'SQL'
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  time TEXT,
  time_zone TEXT,
  category TEXT,
  item TEXT,
  qty REAL,
  price_point_name TEXT,
  sku TEXT,
  modifiers_applied TEXT,
  gross_sales REAL,
  discounts REAL,
  net_sales REAL,
  tax REAL,
  transaction_id TEXT,
  payment_id TEXT,
  device_name TEXT,
  notes TEXT,
  details TEXT,
  event_type TEXT,
  location TEXT,
  dining_option TEXT,
  customer_id TEXT,
  customer_name TEXT,
  customer_reference_id TEXT,
  unit TEXT,
  count REAL,
  itemization_type TEXT,
  fulfillment_note TEXT,
  channel TEXT,
  token TEXT,
  card_brand TEXT,
  pan_suffix TEXT
);
SQL

sqlite3 "$DB_DIR/squareup.db" <<SQL
.mode csv
.import '${DATA_DIR}/SquareUp/SquareUp items-2023-08-01-2026-03-13.csv' items_tmp
INSERT INTO items (date, time, time_zone, category, item, qty, price_point_name, sku, modifiers_applied, gross_sales, discounts, net_sales, tax, transaction_id, payment_id, device_name, notes, details, event_type, location, dining_option, customer_id, customer_name, customer_reference_id, unit, count, itemization_type, fulfillment_note, channel, token, card_brand, pan_suffix)
SELECT "Date", "Time", "Time Zone", "Category", "Item", CAST("Qty" AS REAL), "Price Point Name", "SKU", "Modifiers Applied", CAST("Gross Sales" AS REAL), CAST("Discounts" AS REAL), CAST("Net Sales" AS REAL), CAST("Tax" AS REAL), "Transaction ID", "Payment ID", "Device Name", "Notes", "Details", "Event Type", "Location", "Dining Option", "Customer ID", "Customer Name", "Customer Reference ID", "Unit", CAST("Count" AS REAL), "Itemization Type", "Fulfillment Note", "Channel", "Token", "Card Brand", "PAN Suffix"
FROM items_tmp WHERE "Date" != 'Date';
DROP TABLE items_tmp;
SQL

COUNT=$(sqlite3 "$DB_DIR/squareup.db" "SELECT COUNT(*) FROM items;")
echo "  ✅ $COUNT rows → squareup.db"

# ============================================================
# 3. GRUBHUB
# ============================================================
echo ""
echo "🟢 GRUBHUB"
rm -f "$DB_DIR/grubhub.db"
sqlite3 "$DB_DIR/grubhub.db" <<'SQL'
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_channel TEXT,
  order_number TEXT,
  order_date TEXT,
  order_time_local TEXT,
  order_day_of_week TEXT,
  order_hour_of_day TEXT,
  order_time_zone TEXT,
  transaction_date TEXT,
  transaction_time_local TEXT,
  grubhub_store_id TEXT,
  store_number TEXT,
  store_name TEXT,
  street_address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  transaction_type TEXT,
  fulfillment_type TEXT,
  gh_plus_customer TEXT,
  subtotal REAL,
  subtotal_sales_tax REAL,
  subtotal_sales_tax_exemption REAL,
  self_delivery_charge REAL,
  self_delivery_charge_tax REAL,
  self_delivery_charge_tax_exemption REAL,
  merchant_service_fee REAL,
  merchant_service_fee_tax REAL,
  merchant_service_fee_tax_exemption REAL,
  merchant_flexible_fee_bag_fee REAL,
  merchant_flexible_fee_bag_fee_tax REAL,
  merchant_flexible_fee_bag_fee_tax_exemption REAL,
  merchant_flexible_fee_pif_fee REAL,
  merchant_flexible_fee_pif_fee_tax REAL,
  merchant_flexible_fee_pif_fee_tax_exemption REAL,
  tip REAL,
  merchant_total REAL,
  commission REAL,
  delivery_commission REAL,
  gh_plus_commission REAL,
  processing_fee REAL,
  withheld_tax REAL,
  withheld_tax_exemption REAL,
  merchant_funded_promotion REAL,
  merchant_funded_loyalty REAL,
  merchant_net_total REAL,
  transaction_note TEXT,
  transaction_id TEXT
);
SQL

for FILE in "Aug_23_-_July_24.csv" "Aug_24_-_July_25.csv" "Aug_25_-_Mar_12_26.csv"; do
  sqlite3 "$DB_DIR/grubhub.db" <<SQL
.mode csv
.import '${DATA_DIR}/GrubHub/${FILE}' orders_tmp
INSERT INTO orders (order_channel, order_number, order_date, order_time_local, order_day_of_week, order_hour_of_day, order_time_zone, transaction_date, transaction_time_local, grubhub_store_id, store_number, store_name, street_address, city, state, postal_code, transaction_type, fulfillment_type, gh_plus_customer, subtotal, subtotal_sales_tax, subtotal_sales_tax_exemption, self_delivery_charge, self_delivery_charge_tax, self_delivery_charge_tax_exemption, merchant_service_fee, merchant_service_fee_tax, merchant_service_fee_tax_exemption, merchant_flexible_fee_bag_fee, merchant_flexible_fee_bag_fee_tax, merchant_flexible_fee_bag_fee_tax_exemption, merchant_flexible_fee_pif_fee, merchant_flexible_fee_pif_fee_tax, merchant_flexible_fee_pif_fee_tax_exemption, tip, merchant_total, commission, delivery_commission, gh_plus_commission, processing_fee, withheld_tax, withheld_tax_exemption, merchant_funded_promotion, merchant_funded_loyalty, merchant_net_total, transaction_note, transaction_id)
SELECT "order_channel", "order_number", "order_date", "order_time_local", "order_day_of_week", "order_hour_of_day", "order_time_zone", "transaction_date", "transaction_time_local", "grubhub_store_id", "store_number", "store_name", "street_address", "city", "state", "postal_code", "transaction_type", "fulfillment_type", "gh_plus_customer", CAST("subtotal" AS REAL), CAST("subtotal_sales_tax" AS REAL), CAST("subtotal_sales_tax_exemption" AS REAL), CAST("self_delivery_charge" AS REAL), CAST("self_delivery_charge_tax" AS REAL), CAST("self_delivery_charge_tax_exemption" AS REAL), CAST("merchant_service_fee" AS REAL), CAST("merchant_service_fee_tax" AS REAL), CAST("merchant_service_fee_tax_exemption" AS REAL), CAST("merchant_flexible_fee_bag_fee" AS REAL), CAST("merchant_flexible_fee_bag_fee_tax" AS REAL), CAST("merchant_flexible_fee_bag_fee_tax_exemption" AS REAL), CAST("merchant_flexible_fee_pif_fee" AS REAL), CAST("merchant_flexible_fee_pif_fee_tax" AS REAL), CAST("merchant_flexible_fee_pif_fee_tax_exemption" AS REAL), CAST("tip" AS REAL), CAST("merchant_total" AS REAL), CAST("commission" AS REAL), CAST("delivery_commission" AS REAL), CAST("gh_plus_commission" AS REAL), CAST("processing_fee" AS REAL), CAST("withheld_tax" AS REAL), CAST("withheld_tax_exemption" AS REAL), CAST("merchant_funded_promotion" AS REAL), CAST("merchant_funded_loyalty" AS REAL), CAST("merchant_net_total" AS REAL), "transaction_note", "transaction_id"
FROM orders_tmp WHERE "order_channel" != 'order_channel';
DROP TABLE orders_tmp;
SQL
  CURR=$(sqlite3 "$DB_DIR/grubhub.db" "SELECT COUNT(*) FROM orders;")
  echo "  ✅ $FILE → running total: $CURR"
done

COUNT=$(sqlite3 "$DB_DIR/grubhub.db" "SELECT COUNT(*) FROM orders;")
echo "  📊 Total: $COUNT rows → grubhub.db"

# ============================================================
# 4. UBER EATS
# ============================================================
echo ""
echo "🟩 UBER EATS"
rm -f "$DB_DIR/ubereats.db"
sqlite3 "$DB_DIR/ubereats.db" <<'SQL'
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  date TEXT,
  customer TEXT,
  order_status TEXT,
  sales_excl_tax REAL,
  tax REAL,
  marketplace_fee REAL,
  customer_refunds REAL,
  order_charges REAL,
  estimated_payout REAL
);
SQL

sqlite3 "$DB_DIR/ubereats.db" <<SQL
.mode csv
.import '${DATA_DIR}/Uber Eats/Uber Eats.csv' orders_tmp
INSERT INTO orders (order_id, date, customer, order_status, sales_excl_tax, tax, marketplace_fee, customer_refunds, order_charges, estimated_payout)
SELECT "Order ID", "Date", "Customer", "Order status", CAST("Sales (excl. tax)" AS REAL), CAST("Tax" AS REAL), CAST("Marketplace fee" AS REAL), CAST("Customer refunds" AS REAL), CAST("Order charges" AS REAL), CAST("Estimated payout" AS REAL)
FROM orders_tmp WHERE "Order ID" != 'Order ID';
DROP TABLE orders_tmp;
SQL

COUNT=$(sqlite3 "$DB_DIR/ubereats.db" "SELECT COUNT(*) FROM orders;")
echo "  ✅ $COUNT rows → ubereats.db"

# ============================================================
# 5. DOORDASH
# ============================================================
echo ""
echo "🔴 DOORDASH"
rm -f "$DB_DIR/doordash.db"

DD_DIR="${DATA_DIR}/DoorDash financial_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z"

# Detailed transactions
sqlite3 "$DB_DIR/doordash.db" <<'SQL'
CREATE TABLE detailed_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_utc_time TEXT,
  timestamp_utc_date TEXT,
  timestamp_local_time TEXT,
  timestamp_local_date TEXT,
  order_received_local_time TEXT,
  order_pickup_local_time TEXT,
  payout_time TEXT,
  payout_date TEXT,
  business_id TEXT,
  business_name TEXT,
  store_id TEXT,
  store_name TEXT,
  merchant_store_id TEXT,
  transaction_type TEXT,
  delivery_uuid TEXT,
  doordash_transaction_id TEXT,
  doordash_order_id TEXT,
  merchant_delivery_id TEXT,
  pos_order_id TEXT,
  channel TEXT,
  description TEXT,
  final_order_status TEXT,
  currency TEXT,
  subtotal REAL,
  subtotal_tax_passed_to_merchant REAL,
  commission REAL,
  payment_processing_fee REAL,
  tablet_fee REAL,
  marketing_fees REAL,
  customer_discounts_funded_by_you REAL,
  customer_discounts_funded_by_doordash REAL,
  customer_discounts_funded_by_third_party REAL,
  doordash_marketing_credit REAL,
  third_party_contribution REAL,
  error_charges REAL,
  adjustments REAL,
  net_total REAL,
  pre_adjusted_subtotal REAL,
  pre_adjusted_tax_subtotal REAL,
  subtotal_for_tax REAL,
  subtotal_tax_remitted_by_doordash REAL,
  payout_id TEXT
);

CREATE TABLE payout_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT,
  business_name TEXT,
  store_id TEXT,
  store_name TEXT,
  merchant_store_id TEXT,
  payout_date TEXT,
  currency TEXT,
  channel TEXT,
  subtotal REAL,
  subtotal_tax_passed_to_merchant REAL,
  commission REAL,
  payment_processing_fee REAL,
  tablet_fee REAL,
  marketing_fees REAL,
  customer_discounts_funded_by_you REAL,
  customer_discounts_funded_by_doordash REAL,
  customer_discounts_funded_by_third_party REAL,
  doordash_marketing_credit REAL,
  third_party_contribution REAL,
  error_charges REAL,
  adjustments REAL,
  net_total REAL,
  subtotal_for_tax REAL,
  subtotal_tax_remitted_by_doordash REAL,
  payout_id TEXT,
  payout_status TEXT
);
SQL

# Import detailed - use csv-parse approach since headers have pipes
python3 -c "
import csv, sqlite3, os

db = sqlite3.connect('databases/doordash.db')
cur = db.cursor()

# Detailed transactions
dd_dir = 'Data Exports/DoorDash financial_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z'

with open(f'{dd_dir}/FINANCIAL_DETAILED_TRANSACTIONS_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        vals = list(row.values())
        # 42 columns, our table has 42 columns (excluding id)
        placeholders = ','.join(['?'] * len(vals))
        cur.execute(f'INSERT INTO detailed_transactions (timestamp_utc_time, timestamp_utc_date, timestamp_local_time, timestamp_local_date, order_received_local_time, order_pickup_local_time, payout_time, payout_date, business_id, business_name, store_id, store_name, merchant_store_id, transaction_type, delivery_uuid, doordash_transaction_id, doordash_order_id, merchant_delivery_id, pos_order_id, channel, description, final_order_status, currency, subtotal, subtotal_tax_passed_to_merchant, commission, payment_processing_fee, tablet_fee, marketing_fees, customer_discounts_funded_by_you, customer_discounts_funded_by_doordash, customer_discounts_funded_by_third_party, doordash_marketing_credit, third_party_contribution, error_charges, adjustments, net_total, pre_adjusted_subtotal, pre_adjusted_tax_subtotal, subtotal_for_tax, subtotal_tax_remitted_by_doordash, payout_id) VALUES ({placeholders})', vals)

with open(f'{dd_dir}/FINANCIAL_PAYOUT_SUMMARY_2025-12-12_2026-03-11_HQVnr_2026-03-13T01-08-35Z.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        vals = list(row.values())
        placeholders = ','.join(['?'] * len(vals))
        cur.execute(f'INSERT INTO payout_summary (business_id, business_name, store_id, store_name, merchant_store_id, payout_date, currency, channel, subtotal, subtotal_tax_passed_to_merchant, commission, payment_processing_fee, tablet_fee, marketing_fees, customer_discounts_funded_by_you, customer_discounts_funded_by_doordash, customer_discounts_funded_by_third_party, doordash_marketing_credit, third_party_contribution, error_charges, adjustments, net_total, subtotal_for_tax, subtotal_tax_remitted_by_doordash, payout_id, payout_status) VALUES ({placeholders})', vals)

db.commit()
print(f'detailed: {cur.execute(\"SELECT COUNT(*) FROM detailed_transactions\").fetchone()[0]}')
print(f'payouts: {cur.execute(\"SELECT COUNT(*) FROM payout_summary\").fetchone()[0]}')
db.close()
"

echo "  ✅ DoorDash tables created → doordash.db"

# ============================================================
# SUMMARY
# ============================================================
echo ""
echo "=================================================="
echo "📁 SOURCE DATABASE SUMMARY"
echo "=================================================="
echo ""

for DB_FILE in rocketmoney.db squareup.db grubhub.db doordash.db ubereats.db; do
  SIZE=$(du -h "$DB_DIR/$DB_FILE" | cut -f1)
  echo "  $DB_FILE ($SIZE)"
  sqlite3 "$DB_DIR/$DB_FILE" "SELECT '    ' || name || ': ' || (SELECT COUNT(*) FROM ' || name || ') rows' FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence';" 2>/dev/null || true
  # Get table counts properly
  TABLES=$(sqlite3 "$DB_DIR/$DB_FILE" "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence';")
  for T in $TABLES; do
    CNT=$(sqlite3 "$DB_DIR/$DB_FILE" "SELECT COUNT(*) FROM \"$T\";")
    echo "    └── $T: $CNT rows"
  done
done

echo ""
echo "✅ All source databases created in /databases/"
