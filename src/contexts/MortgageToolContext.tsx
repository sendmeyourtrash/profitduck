"use client";

/**
 * MortgageToolContext — shared state for /tools/mortgage and its sub-pages.
 *
 * Every sub-page (income, location, transportation, rent-vs-buy, scenarios,
 * amortization) reads from and writes to this context. State is persisted to
 * localStorage so users can navigate away and come back without losing input.
 *
 * No backend, no API calls — this tool is fully client-side and isolated
 * from the rest of Profit Duck's financial data.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  MortgageInputs,
  TaxInputs,
  RentVsBuyInputs,
  FilingStatus,
} from "@/lib/utils/mortgage-math";
import type {
  TransportationInputs,
  LocationInputs,
} from "@/lib/utils/lifestyle-math";

// ─────────────────────────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────────────────────────

export interface MortgageToolState {
  mortgage: Required<
    Pick<
      MortgageInputs,
      | "homePrice"
      | "downPayment"
      | "loanTermYears"
      | "interestRate"
      | "propertyTaxRate"
      | "homeInsuranceAnnual"
      | "pmiRate"
      | "hoaMonthly"
      | "closingCostsPercent"
      | "extraMonthlyPrincipal"
      | "biweekly"
    >
  >;
  /** Whether the income section has been explicitly configured. */
  incomeConfigured: boolean;
  income: {
    annualIncome: number;
    filingStatus: FilingStatus;
    federalMarginalRate: number;
    stateCode: string;
    stateMarginalRate: number;
    otherItemizedDeductions: number;
    /** Self-employed toggle (unlocks mileage/home-office deductions). */
    selfEmployed: boolean;
    homeOfficeSqft: number;
    businessMiles: number;
  };
  locationConfigured: boolean;
  location: LocationInputs;
  transportationConfigured: boolean;
  transportation: TransportationInputs;
  rentVsBuyConfigured: boolean;
  rentVsBuy: Required<RentVsBuyInputs>;
  scenariosConfigured: boolean;
  /** Up to 3 scenario labels the user has filled out manually. */
  scenarios: SavedScenario[];
}

export interface SavedScenario {
  id: string;
  label: string;
  housing: number;
  transportation: number;
  taxes: number;
  livingCosts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_STATE: MortgageToolState = {
  mortgage: {
    homePrice: 400_000,
    downPayment: 80_000,
    loanTermYears: 30,
    interestRate: 6.5,
    propertyTaxRate: 1.1,
    homeInsuranceAnnual: 1_400,
    pmiRate: 0.6,
    hoaMonthly: 0,
    closingCostsPercent: 3,
    extraMonthlyPrincipal: 0,
    biweekly: false,
  },
  incomeConfigured: false,
  income: {
    annualIncome: 100_000,
    filingStatus: "single",
    federalMarginalRate: 24,
    stateCode: "",
    stateMarginalRate: 0,
    otherItemizedDeductions: 0,
    selfEmployed: false,
    homeOfficeSqft: 0,
    businessMiles: 0,
  },
  locationConfigured: false,
  location: {
    label: "My location",
    propertyTaxRate: 1.1,
    stateIncomeTaxRate: 0,
    salesTaxRate: 7,
    costOfLivingIndex: 100,
    walkability: 50,
    baselineAnnualSpending: 25_000,
  },
  transportationConfigured: false,
  transportation: {
    mode: "car",
    commuteMilesRoundTrip: 20,
    commuteDaysPerWeek: 5,
    commuteMinutesOneWay: 30,
    car: {
      price: 30_000,
      downPayment: 3_000,
      loanTermMonths: 60,
      interestRate: 7,
      insuranceAnnual: 1_500,
      gasPrice: 3.5,
      mpg: 28,
      milesPerYear: 12_000,
      maintenanceAnnual: 800,
      parkingMonthly: 100,
      registrationAnnual: 150,
      depreciationRate: 15,
    },
    transit: {
      monthlyPass: 130,
      rideshareMonthly: 40,
      preTaxBenefit: false,
    },
    rideshare: {
      ridesPerWeek: 5,
      costPerRide: 15,
    },
  },
  rentVsBuyConfigured: false,
  rentVsBuy: {
    monthlyRent: 2_500,
    rentInflation: 3,
    homeAppreciation: 3,
    investmentReturn: 7,
    maintenancePercent: 1,
    sellingCostsPercent: 6,
    rentersInsuranceAnnual: 180,
    yearsToCompare: 30,
  },
  scenariosConfigured: false,
  scenarios: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

interface MortgageToolContextValue {
  state: MortgageToolState;
  /** Shallow-merge a patch into state. For nested updates, use updateSection. */
  patch: (partial: Partial<MortgageToolState>) => void;
  /** Update a specific section (typed). Automatically marks it as configured. */
  updateMortgage: (partial: Partial<MortgageToolState["mortgage"]>) => void;
  updateIncome: (partial: Partial<MortgageToolState["income"]>) => void;
  updateLocation: (partial: Partial<MortgageToolState["location"]>) => void;
  updateTransportation: (
    partial: Partial<MortgageToolState["transportation"]>
  ) => void;
  updateRentVsBuy: (
    partial: Partial<MortgageToolState["rentVsBuy"]>
  ) => void;
  setScenarios: (scenarios: SavedScenario[]) => void;
  reset: () => void;
  hydrated: boolean;
}

const MortgageToolContext = createContext<MortgageToolContextValue | null>(
  null
);

const STORAGE_KEY = "profitduck:mortgage-tool:v1";

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function MortgageToolProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MortgageToolState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount. Fall back to defaults on any error.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge defensively — ignore unknown keys, keep defaults for missing ones.
        setState({
          ...DEFAULT_STATE,
          ...parsed,
          mortgage: { ...DEFAULT_STATE.mortgage, ...(parsed.mortgage || {}) },
          income: { ...DEFAULT_STATE.income, ...(parsed.income || {}) },
          location: {
            ...DEFAULT_STATE.location,
            ...(parsed.location || {}),
          },
          transportation: {
            ...DEFAULT_STATE.transportation,
            ...(parsed.transportation || {}),
            car: {
              ...DEFAULT_STATE.transportation.car!,
              ...(parsed.transportation?.car || {}),
            },
            transit: {
              ...DEFAULT_STATE.transportation.transit!,
              ...(parsed.transportation?.transit || {}),
            },
            rideshare: {
              ...DEFAULT_STATE.transportation.rideshare!,
              ...(parsed.transportation?.rideshare || {}),
            },
          },
          rentVsBuy: {
            ...DEFAULT_STATE.rentVsBuy,
            ...(parsed.rentVsBuy || {}),
          },
          scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
        });
      }
    } catch {
      // Bad data — ignore and keep defaults.
    }
    setHydrated(true);
  }, []);

  // Persist state to localStorage on every change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable (private mode, full disk) — silently ignore.
    }
  }, [state, hydrated]);

  const patch = useCallback((partial: Partial<MortgageToolState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const updateMortgage = useCallback(
    (partial: Partial<MortgageToolState["mortgage"]>) => {
      setState((s) => ({ ...s, mortgage: { ...s.mortgage, ...partial } }));
    },
    []
  );

  const updateIncome = useCallback(
    (partial: Partial<MortgageToolState["income"]>) => {
      setState((s) => ({
        ...s,
        incomeConfigured: true,
        income: { ...s.income, ...partial },
      }));
    },
    []
  );

  const updateLocation = useCallback(
    (partial: Partial<MortgageToolState["location"]>) => {
      setState((s) => ({
        ...s,
        locationConfigured: true,
        location: { ...s.location, ...partial },
      }));
    },
    []
  );

  const updateTransportation = useCallback(
    (partial: Partial<MortgageToolState["transportation"]>) => {
      setState((s) => ({
        ...s,
        transportationConfigured: true,
        transportation: { ...s.transportation, ...partial },
      }));
    },
    []
  );

  const updateRentVsBuy = useCallback(
    (partial: Partial<MortgageToolState["rentVsBuy"]>) => {
      setState((s) => ({
        ...s,
        rentVsBuyConfigured: true,
        rentVsBuy: { ...s.rentVsBuy, ...partial },
      }));
    },
    []
  );

  const setScenarios = useCallback((scenarios: SavedScenario[]) => {
    setState((s) => ({
      ...s,
      scenariosConfigured: scenarios.length > 0,
      scenarios,
    }));
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_STATE);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<MortgageToolContextValue>(
    () => ({
      state,
      patch,
      updateMortgage,
      updateIncome,
      updateLocation,
      updateTransportation,
      updateRentVsBuy,
      setScenarios,
      reset,
      hydrated,
    }),
    [
      state,
      patch,
      updateMortgage,
      updateIncome,
      updateLocation,
      updateTransportation,
      updateRentVsBuy,
      setScenarios,
      reset,
      hydrated,
    ]
  );

  return (
    <MortgageToolContext.Provider value={value}>
      {children}
    </MortgageToolContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useMortgageTool(): MortgageToolContextValue {
  const ctx = useContext(MortgageToolContext);
  if (!ctx) {
    throw new Error(
      "useMortgageTool must be used inside a MortgageToolProvider"
    );
  }
  return ctx;
}

/**
 * Build the TaxInputs object expected by mortgage-math functions from the
 * income section of the state. Returns null if income isn't configured.
 */
export function toTaxInputs(state: MortgageToolState): TaxInputs | null {
  if (!state.incomeConfigured) return null;
  return {
    annualIncome: state.income.annualIncome,
    filingStatus: state.income.filingStatus,
    marginalTaxRate: state.income.federalMarginalRate,
    stateMarginalRate: state.income.stateMarginalRate,
    otherItemizedDeductions: state.income.otherItemizedDeductions,
  };
}

/** Build the MortgageInputs object from state. */
export function toMortgageInputs(
  state: MortgageToolState
): MortgageInputs {
  return { ...state.mortgage };
}
