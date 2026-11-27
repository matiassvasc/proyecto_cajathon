import { round2 } from "./formatters";
import type { CreditParams, StressComparisonResult, StressEvaluation, StressScenarioId } from "./types";

/**
 * Caso de negocio desde la óptica de Caja Trujillo (sostenibilidad financiera):
 * no basta con que el cliente pague menos intereses; se mide el resultado económico del crédito
 * para la Caja bajo cada escenario.
 *
 *   Resultado = Intereses cobrados + Reinversión del capital recuperado − Saldo impago al vencimiento
 *
 * - Reinversión: cada sol de capital recuperado en el día D se vuelve a colocar a la misma TEA
 *   hasta un horizonte común H (último vencimiento entre ambos planes). Premia la rotación de capital.
 * - Saldo impago al vencimiento: pérdida bruta conservadora (antes de garantías y cobranza).
 * - Provisión SBS: tasas referenciales de la categoría según días de atraso (Res. SBS N.° 11356-2008,
 *   créditos MYPE sin garantías preferidas): Normal 1%, CPP 5%, Deficiente 25%, Dudoso 60%, Pérdida 100%.
 * - Los seguros se cobran por cuenta de la aseguradora y no se cuentan como ingreso de la Caja.
 */

export interface PlanBusinessCase {
  interestCollected: number;
  insuranceCollected: number;
  principalRecovered: number;
  reinvestmentIncome: number;
  unpaidResidual: number;
  economicResult: number;
  capitalAvgLifeDays: number; // Vida media ponderada del capital recuperado
  peakProvision: number;
  peakProvisionCategory: SbsCategory;
  monthsOverdue30Plus: number;
}

export interface ScenarioBusinessCase {
  scenarioId: StressScenarioId;
  scenarioLabel: string;
  kipu: PlanBusinessCase;
  fixed: PlanBusinessCase;
  /** Resultado KipuAI − Cuota Fija (positivo = KipuAI es mejor para la Caja). */
  economicAdvantage: number;
}

export type SbsCategory = "Normal" | "CPP" | "Deficiente" | "Dudoso" | "Pérdida";

export function sbsCategoryForDays(overdueDays: number): { category: SbsCategory; rate: number } {
  if (overdueDays <= 8) return { category: "Normal", rate: 0.01 };
  if (overdueDays <= 30) return { category: "CPP", rate: 0.05 };
  if (overdueDays <= 60) return { category: "Deficiente", rate: 0.25 };
  if (overdueDays <= 120) return { category: "Dudoso", rate: 0.6 };
  return { category: "Pérdida", rate: 1.0 };
}

function lastDay(ev: StressEvaluation): number {
  return ev.schedule.rows.at(-1)?.daysFromStart ?? 0;
}

export function computePlanBusinessCase(
  ev: StressEvaluation,
  params: CreditParams,
  horizonDays: number
): PlanBusinessCase {
  let interestCollected = 0;
  let insuranceCollected = 0;
  let principalRecovered = 0;
  let reinvestmentIncome = 0;
  let weightedDays = 0;
  let peakProvision = 0;
  let peakRate = 0;

  for (const r of ev.schedule.rows) {
    interestCollected += r.paidPendingInterest + r.paidInterest;
    insuranceCollected += r.paidPendingInsurance + r.paidInsurance;
    principalRecovered += r.principalAmortized;
    weightedDays += r.principalAmortized * r.daysFromStart;
    const remaining = Math.max(0, horizonDays - r.daysFromStart);
    reinvestmentIncome += r.principalAmortized * (Math.pow(1 + params.tea, remaining / 360) - 1);

    const { rate } = sbsCategoryForDays(r.cumulativeOverdueDays);
    const provision = rate * r.totalExigibleDebt;
    if (provision > peakProvision) {
      peakProvision = provision;
      peakRate = rate;
    }
  }

  const unpaidResidual = ev.unpaidResidualDebt;
  const peakCategory =
    peakProvision > 0
      ? (["Normal", "CPP", "Deficiente", "Dudoso", "Pérdida"] as SbsCategory[])[
          [0.01, 0.05, 0.25, 0.6, 1.0].indexOf(peakRate)
        ] ?? "Normal"
      : "Normal";

  return {
    interestCollected: round2(interestCollected),
    insuranceCollected: round2(insuranceCollected),
    principalRecovered: round2(principalRecovered),
    reinvestmentIncome: round2(reinvestmentIncome),
    unpaidResidual: round2(unpaidResidual),
    economicResult: round2(interestCollected + reinvestmentIncome - unpaidResidual),
    capitalAvgLifeDays: principalRecovered > 0 ? round2(weightedDays / principalRecovered) : 0,
    peakProvision: round2(peakProvision),
    peakProvisionCategory: peakCategory,
    monthsOverdue30Plus: ev.monthsOverdue30Plus,
  };
}

export function computeScenarioBusinessCase(
  comparison: StressComparisonResult,
  params: CreditParams
): ScenarioBusinessCase {
  const horizon = Math.max(lastDay(comparison.kipu), lastDay(comparison.fixed));
  const kipu = computePlanBusinessCase(comparison.kipu, params, horizon);
  const fixed = computePlanBusinessCase(comparison.fixed, params, horizon);
  return {
    scenarioId: comparison.scenarioId,
    scenarioLabel: comparison.scenarioLabel,
    kipu,
    fixed,
    economicAdvantage: round2(kipu.economicResult - fixed.economicResult),
  };
}

export function computeAllBusinessCases(
  stressResults: Record<StressScenarioId, StressComparisonResult>,
  params: CreditParams
): ScenarioBusinessCase[] {
  return (Object.keys(stressResults) as StressScenarioId[]).map((id) =>
    computeScenarioBusinessCase(stressResults[id], params)
  );
}
