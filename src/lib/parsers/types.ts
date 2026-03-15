/**
 * Supported source platforms for data import.
 */
export type SourcePlatform =
  | "square"
  | "chase"
  | "doordash"
  | "ubereats"
  | "grubhub"
  | "rocketmoney";

/**
 * Result of parsing a single row/record from a source file.
 * Each parser produces an array of these, categorized by destination table.
 */
export interface ParsedTransaction {
  date: Date;
  amount: number;
  type: "income" | "expense" | "fee" | "payout";
  sourcePlatform: SourcePlatform;
  category?: string;
  description?: string;
  rawSourceId?: string;
  rawData: string; // JSON string of the original row
}

export interface ParsedPlatformOrder {
  orderId: string;
  platform: SourcePlatform;
  orderDatetime: Date;
  subtotal: number;
  tax: number;
  deliveryFee: number;
  serviceFee: number;
  commissionFee: number;
  tip: number;
  netPayout: number;
  discounts?: number;
  rawData: string;
  // Rich metadata
  itemCategory?: string;
  diningOption?: string;
  channel?: string;
  cardBrand?: string;
  fulfillmentType?: string;
  customerFees?: number;
  marketingFees?: number;
  refunds?: number;
  adjustments?: number;
  // Platform's native payout ID linking this order to a specific payout
  platformPayoutId?: string;
}

export interface ParsedBankTransaction {
  date: Date;
  description: string;
  amount: number;
  category?: string;
  rawData: string;
  // Rocket Money account info
  accountType?: string;
  accountName?: string;
  institutionName?: string;
  taxDeductible?: boolean;
  tags?: string;
}

export interface ParsedExpense {
  vendorName: string;
  amount: number;
  date: Date;
  category?: string;
  paymentMethod?: string;
  notes?: string;
  rawData: string;
}

export interface ParsedPayout {
  platform: SourcePlatform;
  payoutDate: Date;
  grossAmount: number;
  fees: number;
  netAmount: number;
  rawData: string;
  // Platform's native payout identifier (e.g. DoorDash Payout ID)
  platformPayoutId?: string;
}

/**
 * The combined output of a parser. A parser may produce records for
 * multiple destination tables depending on the source.
 */
export interface ParseResult {
  transactions: ParsedTransaction[];
  platformOrders: ParsedPlatformOrder[];
  bankTransactions: ParsedBankTransaction[];
  expenses: ParsedExpense[];
  payouts: ParsedPayout[];
  errors: string[];
  rowsProcessed: number;
}

/**
 * Interface that all platform parsers must implement.
 */
export interface PlatformParser {
  /** Identifier for this parser's source platform. */
  source: SourcePlatform;

  /**
   * Detect whether a file (by its content and name) belongs to this parser.
   * Returns a confidence score from 0 to 1.
   */
  detect(fileName: string, headers: string[]): number;

  /**
   * Parse file content (as CSV rows represented by objects) into normalized records.
   */
  parse(rows: Record<string, string>[]): ParseResult;
}

/**
 * Create an empty ParseResult.
 */
export function emptyResult(): ParseResult {
  return {
    transactions: [],
    platformOrders: [],
    bankTransactions: [],
    expenses: [],
    payouts: [],
    errors: [],
    rowsProcessed: 0,
  };
}
