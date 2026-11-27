import { computeMonthlyNetProfit } from "./archetypes";
import { computeScenarioBusinessCase } from "./business-case";
import { buildComparisonSchedules, evaluateScheduleWithNetProfits } from "./financial-engine";
import { round2 } from "./formatters";
import type { BusinessProfile, CreditParams, ScheduleResult, StressEvaluation } from "./types";

/**
 * Simulación Monte Carlo del ciclo económico (incertidumbre del modelo predictivo).
 *
 * Cada trayectoria simula la Utilidad Neta de cada periodo del crédito como:
 *   Ventas_t = VentasBase × FactorEstacional_t(±retraso de campaña) × (1 + L) × (1 + e_t) × ShockNiño_t
 *   L   ~ N(0, σ_nivel)                 shock persistente de nivel de ventas (error de estimación del asesor)
 *   e_t = ρ·e_{t−1} + N(0, σ_mes)       ruido mensual autocorrelacionado AR(1)
 *   Retraso de campaña ~ Bernoulli(p_retraso) → el pico se desplaza un mes
 *   El Niño ~ Bernoulli(p_niño) → caída Ene–Abr de 45% × severidad U(0.5, 1) × sensibilidad zonal
 * y ejecuta AMBOS cronogramas (KipuAI y Cuota Fija) con la misma trayectoria, aplicando la prelación
 * Q&A #7 cuando el flujo no alcanza. El generador es determinista (semilla) para que el comité
 * pueda reproducir exactamente el resultado.
 */

export interface MonteCarloConfig {
  simulations: number;
  seed: number;
  levelSigma: number;
  monthlySigma: number;
  monthlyRho: number;
  campaignDelayProb: number;
  elNinoProb: number;
}

export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  simulations: 1000,
  seed: 20261126,
  levelSigma: 0.1,
  monthlySigma: 0.07,
  monthlyRho: 0.5,
  campaignDelayProb: 0.2,
  elNinoProb: 0.15,
};

export interface PlanMonteCarloStats {
  probAnyFactorBreach: number; // P(alguna cuota > Factor × UN)
  probAnyShortfall: number; // P(alguna cuota > 100% de la UN: impago real)
  probOverdue30: number; // P(algún tramo con atraso > 30 días)
  probResidualDebt: number; // P(saldo impago al vencimiento > S/ 1)
  expectedResidual: number; // Pérdida esperada (media del saldo impago)
  residualP95: number; // VaR 95% del saldo impago
  expectedEconomicResult: number; // Resultado económico esperado para la Caja
  economicResultP5: number; // Resultado económico en el 5% peor
  breachProbByPeriod: number[]; // P(Cuota_t > Factor × UN_t) por periodo
}

export interface MonteCarloResult {
  config: MonteCarloConfig;
  kipu: PlanMonteCarloStats;
  fixed: PlanMonteCarloStats;
  /** Bandas de Utilidad Neta simulada por periodo (calendario KipuAI). */
  netProfitBands: Array<{ period: number; p10: number; p50: number; p90: number }>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[pos];
}

interface PathDraw {
  level: number;
  noise: number[]; // indexado por mes calendario relativo
  delayed: boolean;
  nino: boolean;
  ninoSeverity: number;
}

function drawPath(rand: () => number, cfg: MonteCarloConfig, length: number): PathDraw {
  const noise: number[] = [];
  let prev = 0;
  for (let i = 0; i < length; i++) {
    prev = cfg.monthlyRho * prev + cfg.monthlySigma * gaussian(rand);
    noise.push(prev);
  }
  return {
    level: cfg.levelSigma * gaussian(rand),
    noise,
    delayed: rand() < cfg.campaignDelayProb,
    nino: rand() < cfg.elNinoProb,
    ninoSeverity: 0.5 + 0.5 * rand(),
  };
}

function netProfitsForSchedule(
  profile: BusinessProfile,
  schedule: ScheduleResult,
  path: PathDraw
): number[] {
  return schedule.rows.map((row) => {
    // El ruido se indexa por mes transcurrido desde el desembolso, común a ambos planes.
    const monthOffset = Math.min(path.noise.length - 1, Math.floor((row.daysFromStart - 1) / 30));
    const month = path.delayed ? ((row.monthIndex - 2 + 12) % 12) + 1 : row.monthIndex;
    const seasonal = profile.seasonalFactors[month] ?? 1;
    let mult = Math.max(0.05, (1 + path.level) * (1 + path.noise[monthOffset]));
    let extraCost = 0;
    if (path.nino && row.monthIndex >= 1 && row.monthIndex <= 4) {
      const drop = Math.min(0.9, 0.45 * path.ninoSeverity * profile.elNinoSensitivity);
      mult *= 1 - drop;
      extraCost = profile.fixedOperatingExpenses * 0.22 * path.ninoSeverity * profile.elNinoSensitivity;
    }
    const monthly = computeMonthlyNetProfit(profile, seasonal, {
      salesMultiplier: mult,
      extraOperatingCost: extraCost,
    });
    return round2(schedule.periodicityMode === "elastic" ? monthly * (row.days / 30) : monthly);
  });
}

interface Accumulator {
  factorBreach: number;
  shortfall: number;
  overdue30: number;
  residualCount: number;
  residuals: number[];
  economic: number[];
  breachByPeriod: number[];
}

function newAcc(n: number): Accumulator {
  return {
    factorBreach: 0,
    shortfall: 0,
    overdue30: 0,
    residualCount: 0,
    residuals: [],
    economic: [],
    breachByPeriod: new Array(n).fill(0),
  };
}

function accumulate(acc: Accumulator, ev: StressEvaluation, economicResult: number) {
  let anyBreach = false;
  let anyShortfall = false;
  ev.schedule.rows.forEach((r, i) => {
    if (r.capacityBreached) {
      anyBreach = true;
      acc.breachByPeriod[i] += 1;
    }
    if (r.actualPaid + 0.5 < r.scheduledInstallment) anyShortfall = true;
  });
  if (anyBreach) acc.factorBreach += 1;
  if (anyShortfall) acc.shortfall += 1;
  if (ev.monthsOverdue30Plus > 0) acc.overdue30 += 1;
  if (ev.unpaidResidualDebt > 1) acc.residualCount += 1;
  acc.residuals.push(ev.unpaidResidualDebt);
  acc.economic.push(economicResult);
}

function finalize(acc: Accumulator, n: number): PlanMonteCarloStats {
  const residSorted = [...acc.residuals].sort((a, b) => a - b);
  const econSorted = [...acc.economic].sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  return {
    probAnyFactorBreach: acc.factorBreach / n,
    probAnyShortfall: acc.shortfall / n,
    probOverdue30: acc.overdue30 / n,
    probResidualDebt: acc.residualCount / n,
    expectedResidual: round2(mean(acc.residuals)),
    residualP95: round2(quantile(residSorted, 0.95)),
    expectedEconomicResult: round2(mean(acc.economic)),
    economicResultP5: round2(quantile(econSorted, 0.05)),
    breachProbByPeriod: acc.breachByPeriod.map((c) => c / n),
  };
}

export function runMonteCarlo(
  profile: BusinessProfile,
  params: CreditParams,
  partialConfig: Partial<MonteCarloConfig> = {}
): MonteCarloResult {
  const cfg: MonteCarloConfig = { ...DEFAULT_MONTE_CARLO_CONFIG, ...partialConfig };
  const n = Math.max(50, Math.min(20_000, Math.round(cfg.simulations)));
  const rand = mulberry32(cfg.seed);
  const { kipu, fixed } = buildComparisonSchedules(profile, params);
  const horizonMonths = Math.ceil(
    Math.max(kipu.rows.at(-1)?.daysFromStart ?? 0, fixed.rows.at(-1)?.daysFromStart ?? 0) / 30
  ) + 1;

  const kipuAcc = newAcc(kipu.rows.length);
  const fixedAcc = newAcc(fixed.rows.length);
  const bandSamples: number[][] = kipu.rows.map(() => []);

  for (let s = 0; s < n; s++) {
    const path = drawPath(rand, cfg, horizonMonths);
    const kipuNp = netProfitsForSchedule(profile, kipu, path);
    const fixedNp = netProfitsForSchedule(profile, fixed, path);
    kipuNp.forEach((v, i) => bandSamples[i].push(v));

    const kipuEv = evaluateScheduleWithNetProfits(kipu, params, kipuNp);
    const fixedEv = evaluateScheduleWithNetProfits(fixed, params, fixedNp);
    const bc = computeScenarioBusinessCase(
      {
        scenarioId: "base",
        scenarioLabel: "Monte Carlo",
        scenarioDescription: "",
        kipu: kipuEv,
        fixed: fixedEv,
      },
      params
    );
    accumulate(kipuAcc, kipuEv, bc.kipu.economicResult);
    accumulate(fixedAcc, fixedEv, bc.fixed.economicResult);
  }

  return {
    config: { ...cfg, simulations: n },
    kipu: finalize(kipuAcc, n),
    fixed: finalize(fixedAcc, n),
    netProfitBands: bandSamples.map((samples, i) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        period: i + 1,
        p10: round2(quantile(sorted, 0.1)),
        p50: round2(quantile(sorted, 0.5)),
        p90: round2(quantile(sorted, 0.9)),
      };
    }),
  };
}
