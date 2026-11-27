export type CycleStage = "cima" | "normal" | "valle";

export type PatrimonialInsuranceType = "none" | "multirriesgo" | "vivienda";

export type CreditProductType = "inclusion" | "pequena_empresa";

export type PeriodicityMode = "monthly" | "elastic";

export type StressScenarioId =
  | "base"
  | "sales_drop_25"
  | "campaign_delay_30d"
  | "el_nino_shock";

export const BCRP_MAX_TEA = 0.75; // 75.00% tope referencial BCRP

export const PRODUCT_MAX_FACTORS: Record<CreditProductType, number> = {
  inclusion: 0.65,
  pequena_empresa: 0.85,
};

export interface BusinessProfile {
  id: string;
  name: string;
  ownerName: string;
  sector: string;
  location: string;
  baseMonthlySales: number;
  cogsRatio: number; // Costo de ventas sobre ingresos (0..1)
  fixedOperatingExpenses: number; // Alquiler, servicios, personal fijo
  taxExpenseMonthly: number; // Nuevo RUS / RER / MYPE Tributario
  familyBurden: number; // Canasta básica familiar
  seasonalFactors: Record<number, number>; // Meses 1 (Ene) .. 12 (Dic)
  insurableAssetValue: number; // Valor asegurable de local/activos/vivienda
  elNinoSensitivity: number; // Multiplicador de vulnerabilidad climática regional (0.6..1.5)
  sources: string[];
  notes?: string;
}

export interface CreditParams {
  principal: number;
  numInstallments: number; // 6..24
  disbursementDate: string; // YYYY-MM-DD en America/Lima
  tea: number; // Tasa Efectiva Anual en decimal (ej. 0.385 = 38.50%)
  desgravamenEnabled: boolean;
  desgravamenRateAnnual: number; // % anual sobre saldo capital (ej. 0.012 = 1.20% anual)
  patrimonialType: PatrimonialInsuranceType;
  patrimonialRateAnnual: number; // % anual sobre valor asegurable (ej. 0.006 = 0.60% anual)
  insurableValue: number;
  productType: CreditProductType;
  fieldCriterionFactor: number; // Factor efectivo reducido por criterio de campo <= maxFactor
  periodicityMode: PeriodicityMode;
}

export interface BusinessArchetype {
  id: string;
  shortTitle: string;
  subtitle: string;
  badge: string;
  peakSummary: string;
  valleySummary: string;
  profile: BusinessProfile;
  recommendedCredit: Omit<CreditParams, "disbursementDate">;
  sampleFieldNotes: string;
  sampleNotebookDataUrl: string;
}

export interface WaterfallInput {
  prevPrincipalBalance: number;
  pendingInsurance: number;
  periodInsurance: number;
  pendingInterest: number;
  periodInterest: number;
  scheduledPrincipal: number;
  overduePrincipal: number;
}

export interface WaterfallOutput {
  paidPendingInsurance: number;
  paidPeriodInsurance: number;
  paidPendingInterest: number;
  paidPeriodInterest: number;
  principalAmortized: number;
  actualPaid: number;
  endingPrincipalBalance: number;
  endingPendingInsurance: number;
  endingPendingInterest: number;
  endingOverduePrincipal: number;
  totalExigibleDebt: number;
}

export interface ScheduleRow {
  number: number;
  dueDate: string; // YYYY-MM-DD
  days: number; // d_t exactos
  daysFromStart: number; // D_t acumulados desde desembolso
  monthIndex: number; // 1..12
  cycleStage: CycleStage;
  seasonalFactor: number;
  projectedNetProfit: number;
  paymentCap: number; // UtilidadNeta_t * Factor_aplicado
  periodInsurance: number;
  periodInterest: number;
  paidPendingInsurance: number;
  paidInsurance: number;
  paidPendingInterest: number;
  paidInterest: number;
  principalAmortized: number;
  scheduledInstallment: number; // Cuota exigible del periodo
  actualPaid: number; // Efectivamente cubierto (igual a cuota en base, menor si hay déficit en estrés)
  endingPrincipalBalance: number; // Saldo de capital (jamás capitaliza interés ni seguros)
  pendingInsuranceBalance: number;
  pendingInterestBalance: number;
  overduePrincipalBalance: number;
  totalExigibleDebt: number; // Saldo Capital + seguros/intereses pendientes
  freeCashFlow: number; // UtilidadNeta_t - actualPaid
  quotaToProfitRatio: number; // Infinity si UtilidadNeta_t <= 0 y cuota > 0
  capacityBreached: boolean;
  cumulativeOverdueDays: number;
}

export interface ScheduleResult {
  mode: "kipu" | "fixed";
  periodicityMode: PeriodicityMode;
  rows: ScheduleRow[];
  totalInterest: number;
  totalInsurance: number;
  totalPaid: number;
  tcea: number;
  maxQuotaToProfitRatio: number;
  isFeasible: boolean;
  maxAffordablePrincipal: number;
  riskMetrics: ScheduleRiskMetrics;
}

/** Métricas explícitas para los riesgos 2 (concentración), 3 (encarecimiento) y 1/4 (holgura). */
export interface ScheduleRiskMetrics {
  maxSinglePrincipalShare: number; // % del capital amortizado en la cuota más alta
  top3PrincipalShare: number; // % del capital amortizado en las 3 cuotas con más capital
  lastQuarterPrincipalShare: number; // % del capital amortizado en el último cuarto del plazo
  interestOnlyPeriods: number; // Cuotas que amortizan < 1% del capital (gracia de facto / solo interés)
  partialChargePeriods: number; // Cuotas que no cubren íntegro seguros + interés (quedan pendientes)
  minFactorHeadroom: number; // min_t (Factor aplicado - Cuota_t / UtilidadNeta_t)
}

export interface StressEvaluation {
  schedule: ScheduleResult;
  breachedInstallmentsCount: number;
  monthsOverdue30Plus: number;
  cumulativeFreeCash: number;
  totalInterestAccrued: number;
  unpaidResidualDebt: number;
  tcea: number;
  survivalStatus: "resiliente" | "alerta" | "deterioro";
}

export interface StressComparisonResult {
  scenarioId: StressScenarioId;
  scenarioLabel: string;
  scenarioDescription: string;
  kipu: StressEvaluation;
  fixed: StressEvaluation;
}

export interface ExtractionResponse {
  profilePatch: {
    name?: string;
    sector?: string;
    location?: string;
    baseMonthlySales: number;
    cogsRatio: number;
    fixedOperatingExpenses: number;
    taxExpenseMonthly: number;
    familyBurden: number;
    insurableAssetValue: number;
    seasonalFactors: Record<number, number>;
  };
  recommendedFieldFactor: number;
  confidence: number;
  extractedAssumptions: string[];
  detectedAnomalies: string[];
  source: "gemini-live" | "fallback-deterministic";
  modelUsed: string;
}

export interface CommitteeAuditResponse {
  verdict: "APROBADO_CON_MITIGANTES" | "OBSERVADO_AJUSTAR_MONTO" | "RECHAZADO";
  executiveSummary: string;
  quotaDynamicsExplanation: string;
  sectorClimateAssumptions: string[];
  fiveRisksMitigation: {
    optimisticEstimation: string;
    capitalConcentration: string;
    creditCostIncrease: string;
    overIndebtedness: string;
    humanFieldCriterion: string;
  };
  devilAdvocateObjections: string[];
  committeeConditions: string[];
  source: "gemini-live" | "fallback-deterministic";
  modelUsed: string;
  generatedAtLima: string;
}
