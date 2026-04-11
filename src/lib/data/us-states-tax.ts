/**
 * US state income tax data used by the mortgage/lifestyle calculator.
 *
 * Values are 2024 TOP MARGINAL rates from the Tax Foundation and state
 * revenue departments. These are approximations for calculator use —
 * actual liability depends on brackets, deductions, and local taxes.
 *
 * Source: https://taxfoundation.org/data/all/state/state-income-tax-rates/
 */

export interface StateTaxInfo {
  /** 2-letter code. */
  code: string;
  name: string;
  /** Top marginal state income tax rate as a percent. */
  topRate: number;
  /** Approximate statewide average property tax rate as percent of home value. */
  propertyTaxRate: number;
  /** Approximate statewide average combined state + local sales tax, percent. */
  salesTaxRate: number;
  /** Approximate overall cost-of-living index where 100 = national average. */
  costOfLivingIndex: number;
}

/**
 * 50 states + DC with rounded 2024 figures. Cost of living is an
 * aggregate statewide number — individual cities vary wildly (NYC != Buffalo).
 */
export const US_STATES: StateTaxInfo[] = [
  { code: "AL", name: "Alabama", topRate: 5.0, propertyTaxRate: 0.41, salesTaxRate: 9.25, costOfLivingIndex: 89 },
  { code: "AK", name: "Alaska", topRate: 0.0, propertyTaxRate: 1.19, salesTaxRate: 1.82, costOfLivingIndex: 126 },
  { code: "AZ", name: "Arizona", topRate: 2.5, propertyTaxRate: 0.62, salesTaxRate: 8.37, costOfLivingIndex: 103 },
  { code: "AR", name: "Arkansas", topRate: 4.4, propertyTaxRate: 0.61, salesTaxRate: 9.46, costOfLivingIndex: 89 },
  { code: "CA", name: "California", topRate: 13.3, propertyTaxRate: 0.75, salesTaxRate: 8.85, costOfLivingIndex: 142 },
  { code: "CO", name: "Colorado", topRate: 4.4, propertyTaxRate: 0.51, salesTaxRate: 7.78, costOfLivingIndex: 105 },
  { code: "CT", name: "Connecticut", topRate: 6.99, propertyTaxRate: 2.15, salesTaxRate: 6.35, costOfLivingIndex: 113 },
  { code: "DE", name: "Delaware", topRate: 6.6, propertyTaxRate: 0.58, salesTaxRate: 0.0, costOfLivingIndex: 101 },
  { code: "DC", name: "District of Columbia", topRate: 10.75, propertyTaxRate: 0.57, salesTaxRate: 6.0, costOfLivingIndex: 145 },
  { code: "FL", name: "Florida", topRate: 0.0, propertyTaxRate: 0.91, salesTaxRate: 7.02, costOfLivingIndex: 102 },
  { code: "GA", name: "Georgia", topRate: 5.49, propertyTaxRate: 0.92, salesTaxRate: 7.38, costOfLivingIndex: 91 },
  { code: "HI", name: "Hawaii", topRate: 11.0, propertyTaxRate: 0.32, salesTaxRate: 4.5, costOfLivingIndex: 179 },
  { code: "ID", name: "Idaho", topRate: 5.8, propertyTaxRate: 0.67, salesTaxRate: 6.03, costOfLivingIndex: 98 },
  { code: "IL", name: "Illinois", topRate: 4.95, propertyTaxRate: 2.23, salesTaxRate: 8.85, costOfLivingIndex: 94 },
  { code: "IN", name: "Indiana", topRate: 3.05, propertyTaxRate: 0.84, salesTaxRate: 7.0, costOfLivingIndex: 90 },
  { code: "IA", name: "Iowa", topRate: 5.7, propertyTaxRate: 1.52, salesTaxRate: 6.94, costOfLivingIndex: 90 },
  { code: "KS", name: "Kansas", topRate: 5.7, propertyTaxRate: 1.34, salesTaxRate: 8.66, costOfLivingIndex: 87 },
  { code: "KY", name: "Kentucky", topRate: 4.0, propertyTaxRate: 0.83, salesTaxRate: 6.0, costOfLivingIndex: 92 },
  { code: "LA", name: "Louisiana", topRate: 4.25, propertyTaxRate: 0.55, salesTaxRate: 9.56, costOfLivingIndex: 91 },
  { code: "ME", name: "Maine", topRate: 7.15, propertyTaxRate: 1.24, salesTaxRate: 5.5, costOfLivingIndex: 109 },
  { code: "MD", name: "Maryland", topRate: 5.75, propertyTaxRate: 1.05, salesTaxRate: 6.0, costOfLivingIndex: 120 },
  { code: "MA", name: "Massachusetts", topRate: 9.0, propertyTaxRate: 1.14, salesTaxRate: 6.25, costOfLivingIndex: 148 },
  { code: "MI", name: "Michigan", topRate: 4.25, propertyTaxRate: 1.38, salesTaxRate: 6.0, costOfLivingIndex: 91 },
  { code: "MN", name: "Minnesota", topRate: 9.85, propertyTaxRate: 1.05, salesTaxRate: 7.54, costOfLivingIndex: 97 },
  { code: "MS", name: "Mississippi", topRate: 4.7, propertyTaxRate: 0.75, salesTaxRate: 7.07, costOfLivingIndex: 86 },
  { code: "MO", name: "Missouri", topRate: 4.8, propertyTaxRate: 0.88, salesTaxRate: 8.39, costOfLivingIndex: 88 },
  { code: "MT", name: "Montana", topRate: 5.9, propertyTaxRate: 0.74, salesTaxRate: 0.0, costOfLivingIndex: 102 },
  { code: "NE", name: "Nebraska", topRate: 5.84, propertyTaxRate: 1.54, salesTaxRate: 6.97, costOfLivingIndex: 91 },
  { code: "NV", name: "Nevada", topRate: 0.0, propertyTaxRate: 0.55, salesTaxRate: 8.24, costOfLivingIndex: 102 },
  { code: "NH", name: "New Hampshire", topRate: 3.0, propertyTaxRate: 1.93, salesTaxRate: 0.0, costOfLivingIndex: 110 },
  { code: "NJ", name: "New Jersey", topRate: 10.75, propertyTaxRate: 2.23, salesTaxRate: 6.6, costOfLivingIndex: 114 },
  { code: "NM", name: "New Mexico", topRate: 5.9, propertyTaxRate: 0.67, salesTaxRate: 7.62, costOfLivingIndex: 94 },
  { code: "NY", name: "New York", topRate: 10.9, propertyTaxRate: 1.4, salesTaxRate: 8.53, costOfLivingIndex: 125 },
  { code: "NC", name: "North Carolina", topRate: 4.5, propertyTaxRate: 0.7, salesTaxRate: 6.98, costOfLivingIndex: 95 },
  { code: "ND", name: "North Dakota", topRate: 2.5, propertyTaxRate: 0.98, salesTaxRate: 6.97, costOfLivingIndex: 93 },
  { code: "OH", name: "Ohio", topRate: 3.75, propertyTaxRate: 1.52, salesTaxRate: 7.24, costOfLivingIndex: 91 },
  { code: "OK", name: "Oklahoma", topRate: 4.75, propertyTaxRate: 0.85, salesTaxRate: 8.99, costOfLivingIndex: 86 },
  { code: "OR", name: "Oregon", topRate: 9.9, propertyTaxRate: 0.87, salesTaxRate: 0.0, costOfLivingIndex: 113 },
  { code: "PA", name: "Pennsylvania", topRate: 3.07, propertyTaxRate: 1.49, salesTaxRate: 6.34, costOfLivingIndex: 95 },
  { code: "RI", name: "Rhode Island", topRate: 5.99, propertyTaxRate: 1.4, salesTaxRate: 7.0, costOfLivingIndex: 110 },
  { code: "SC", name: "South Carolina", topRate: 6.4, propertyTaxRate: 0.57, salesTaxRate: 7.5, costOfLivingIndex: 95 },
  { code: "SD", name: "South Dakota", topRate: 0.0, propertyTaxRate: 1.17, salesTaxRate: 6.4, costOfLivingIndex: 93 },
  { code: "TN", name: "Tennessee", topRate: 0.0, propertyTaxRate: 0.67, salesTaxRate: 9.55, costOfLivingIndex: 91 },
  { code: "TX", name: "Texas", topRate: 0.0, propertyTaxRate: 1.68, salesTaxRate: 8.2, costOfLivingIndex: 93 },
  { code: "UT", name: "Utah", topRate: 4.65, propertyTaxRate: 0.58, salesTaxRate: 7.19, costOfLivingIndex: 103 },
  { code: "VT", name: "Vermont", topRate: 8.75, propertyTaxRate: 1.83, salesTaxRate: 6.3, costOfLivingIndex: 115 },
  { code: "VA", name: "Virginia", topRate: 5.75, propertyTaxRate: 0.82, salesTaxRate: 5.77, costOfLivingIndex: 102 },
  { code: "WA", name: "Washington", topRate: 0.0, propertyTaxRate: 0.87, salesTaxRate: 8.86, costOfLivingIndex: 115 },
  { code: "WV", name: "West Virginia", topRate: 5.12, propertyTaxRate: 0.57, salesTaxRate: 6.52, costOfLivingIndex: 90 },
  { code: "WI", name: "Wisconsin", topRate: 7.65, propertyTaxRate: 1.61, salesTaxRate: 5.43, costOfLivingIndex: 95 },
  { code: "WY", name: "Wyoming", topRate: 0.0, propertyTaxRate: 0.56, salesTaxRate: 5.36, costOfLivingIndex: 94 },
];

/** Look up a state by 2-letter code. Returns undefined if not found. */
export function getStateByCode(code: string): StateTaxInfo | undefined {
  const upper = code.toUpperCase();
  return US_STATES.find((s) => s.code === upper);
}
