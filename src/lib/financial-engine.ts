import { computeMonthlyNetProfit } from "./archetypes";
import {
  addDaysIso,
  addMonthsClampedIso,
  classifyCycleStage,
  exactDaysBetween,
  parseIsoYmd,
  round2,
} from "./formatters";
import {
  BCRP_MAX_TEA,
  PRODUCT_MAX_FACTORS,
  type BusinessProfile,
  type CreditParams,
  type CycleStage,
  type PeriodicityMode,
  type ScheduleResult,
  type ScheduleRiskMetrics,
  type ScheduleRow,
  type StressComparisonResult,
  type StressEvaluation,
  type StressScenarioId,
  type WaterfallInput,
  type WaterfallOutput,
} from "./types";

/** Colchón prudencial (8% del factor aplicado) reservado en cada etapa cuando el monto lo permite. */
export const PRUDENTIAL_HEADROOM = 0.08;

interface PeriodSlot {
  number: number;
  dueDate: string;
  days: number;
  daysFromStart: number;
  monthIndex: number;
  seasonalFactor: number;
  cycleStage: CycleStage;
  projectedNetProfit: number;
  paymentCap: number;
}

/**
 * Normaliza parámetros del crédito respetando el tope BCRP y los límites por producto.
 */
export function sanitizeCreditParams(raw: CreditParams): CreditParams {
  const maxFactor = PRODUCT_MAX_FACTORS[raw.productType];
  const tea = Math.min(BCRP_MAX_TEA, Math.max(0.01, raw.tea));
  const numInstallments = Math.min(24, Math.max(6, Math.round(raw.numInstallments)));
  const principal = Math.max(500, raw.principal);
  const fieldCriterionFactor = Math.min(maxFactor, Math.max(0.25, raw.fieldCriterionFactor));

  return {
    ...raw,
    principal,
    numInstallments,
    tea,
    fieldCriterionFactor,
    desgravamenRateAnnual: raw.desgravamenEnabled ? Math.max(0, raw.desgravamenRateAnnual) : 0,
    patrimonialRateAnnual:
      raw.patrimonialType === "none" ? 0 : Math.max(0, raw.patrimonialRateAnnual),
    insurableValue: raw.patrimonialType === "none" ? 0 : Math.max(0, raw.insurableValue),
  };
}

/**
 * 1. Conversión exacta de TEA a TED en Base 360: TED = (1 + TEA)^(1/360) - 1
 */
export function teaToTed360(tea: number): number {
  return Math.pow(1 + tea, 1 / 360) - 1;
}

/**
 * Interés del periodo t por días exactos d_t sobre saldo de capital anterior:
 * I_t = SaldoCapital_{t-1} * ((1 + TED)^{d_t} - 1)
 */
export function computePeriodInterest(
  prevPrincipalBalance: number,
  ted: number,
  days: number
): number {
  if (prevPrincipalBalance <= 0 || days <= 0) return 0;
  return prevPrincipalBalance * (Math.pow(1 + ted, days) - 1);
}

/**
 * 2. Seguros Base 360 (interés simple sobre días exactos d_t):
 * S_t = (SaldoCapital_{t-1} * r_desg + ValorAseg * r_pat) * (d_t / 360)
 */
export function computePeriodInsurance(
  prevPrincipalBalance: number,
  desgravamenRateAnnual: number,
  insurableValue: number,
  patrimonialRateAnnual: number,
  days: number
): number {
  if (prevPrincipalBalance <= 0 || days <= 0) return 0;
  const annualBase =
    prevPrincipalBalance * Math.max(0, desgravamenRateAnnual) +
    Math.max(0, insurableValue) * Math.max(0, patrimonialRateAnnual);
  return annualBase * (days / 360);
}

/**
 * 3. Prelación estricta (Q&A #7): primero conceptos pendientes y luego los del periodo,
 *    cada bloque en orden Seguros -> Interés -> Capital:
 *    1. Seguros pend. -> 2. Interés pend. -> 3. Capital vencido ->
 *    4. Seguros periodo -> 5. Interés periodo -> 6. Capital periodo.
 *    Lo impago queda en su mismo rubro exigible y JAMÁS se capitaliza al SaldoCapital.
 */
export function applyPaymentWaterfall(
  rawPayment: number,
  input: WaterfallInput
): WaterfallOutput {
  let remaining = Math.max(0, round2(rawPayment));

  const pendIns = round2(Math.max(0, input.pendingInsurance));
  const perIns = round2(Math.max(0, input.periodInsurance));
  const pendInt = round2(Math.max(0, input.pendingInterest));
  const perInt = round2(Math.max(0, input.periodInterest));
  const prevPrin = round2(Math.max(0, input.prevPrincipalBalance));
  const targetPrin = round2(
    Math.min(prevPrin, Math.max(0, input.overduePrincipal) + Math.max(0, input.scheduledPrincipal))
  );

  const overduePrin = round2(Math.min(prevPrin, Math.max(0, input.overduePrincipal)));

  // Regla Q&A #7: primero se cobran los conceptos PENDIENTES (Seguros -> Interés -> Capital)
  // y luego los del PERIODO (Seguros -> Interés -> Capital).
  // Nivel 1: Seguros pendientes
  const paidPendingInsurance = round2(Math.min(remaining, pendIns));
  remaining = round2(remaining - paidPendingInsurance);
  const endingPendingInsuranceFromPrior = round2(pendIns - paidPendingInsurance);

  // Nivel 2: Intereses pendientes
  const paidPendingInterest = round2(Math.min(remaining, pendInt));
  remaining = round2(remaining - paidPendingInterest);
  const endingPendingInterestFromPrior = round2(pendInt - paidPendingInterest);

  // Nivel 3: Capital vencido pendiente
  const paidOverduePrincipal = round2(Math.min(remaining, overduePrin));
  remaining = round2(remaining - paidOverduePrincipal);

  // Nivel 4: Seguros del periodo
  const paidPeriodInsurance = round2(Math.min(remaining, perIns));
  remaining = round2(remaining - paidPeriodInsurance);
  const unpaidCurrentInsurance = round2(perIns - paidPeriodInsurance);
  const endingPendingInsurance = round2(endingPendingInsuranceFromPrior + unpaidCurrentInsurance);

  // Nivel 5: Intereses del periodo
  const paidPeriodInterest = round2(Math.min(remaining, perInt));
  remaining = round2(remaining - paidPeriodInterest);
  const unpaidCurrentInterest = round2(perInt - paidPeriodInterest);
  const endingPendingInterest = round2(endingPendingInterestFromPrior + unpaidCurrentInterest);

  // Nivel 6: Capital del periodo (hasta cubrir el saldo de capital disponible)
  const principalAmortized = round2(
    paidOverduePrincipal + Math.min(remaining, round2(prevPrin - paidOverduePrincipal))
  );
  const actualPaid = round2(
    paidPendingInsurance +
      paidPeriodInsurance +
      paidPendingInterest +
      paidPeriodInterest +
      principalAmortized
  );

  const endingPrincipalBalance = round2(Math.max(0, prevPrin - principalAmortized));
  const endingOverduePrincipal = round2(Math.max(0, targetPrin - principalAmortized));
  // Deuda total exigible = Saldo Capital + rubros impagos no capitalizados
  const totalExigibleDebt = round2(
    endingPrincipalBalance + endingPendingInsurance + endingPendingInterest
  );

  return {
    paidPendingInsurance,
    paidPeriodInsurance,
    paidPendingInterest,
    paidPeriodInterest,
    principalAmortized,
    actualPaid,
    endingPrincipalBalance,
    endingPendingInsurance,
    endingPendingInterest,
    endingOverduePrincipal,
    totalExigibleDebt,
  };
}

/**
 * Calcula la TCEA exacta resolviendo el VAN en días exactos Base 360:
 * P_0 - sum_{t=1}^N C_t / (1 + TCEA)^(D_t / 360) = 0
 */
export function computeTCEA(
  principal: number,
  cashflows: Array<{ daysFromStart: number; amount: number }>
): number {
  const validFlows = cashflows.filter((cf) => cf.amount > 0 && cf.daysFromStart > 0);
  if (principal <= 0 || validFlows.length === 0) return 0;

  const npv = (rate: number): number => {
    let pv = 0;
    for (const cf of validFlows) {
      pv += cf.amount / Math.pow(1 + rate, cf.daysFromStart / 360);
    }
    return pv - principal;
  };

  let low = -0.99;
  let high = 5.0;
  while (npv(high) > 0 && high < 100) {
    high *= 2;
  }

  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (low + high);
    if (npv(mid) > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return 0.5 * (low + high);
}

function buildPeriodTimeline(
  profile: BusinessProfile,
  params: CreditParams,
  modeOverride?: PeriodicityMode
): PeriodSlot[] {
  const mode = modeOverride ?? params.periodicityMode;
  const slots: PeriodSlot[] = [];
  let prevDate = params.disbursementDate;
  let cumulativeDays = 0;

  for (let t = 1; t <= params.numInstallments; t++) {
    let dueDate: string;
    let days: number;
    let monthIndex: number;

    if (mode === "monthly") {
      dueDate = addMonthsClampedIso(params.disbursementDate, t);
      days = exactDaysBetween(prevDate, dueDate);
      const [, m] = parseIsoYmd(dueDate);
      monthIndex = m;
    } else {
      // Periodicidad elástica: evalúa la fase estacional dominante de la ventana venidera
      const probeDate = addDaysIso(prevDate, 15);
      const [, probeMonth] = parseIsoYmd(probeDate);
      const probeFactor = profile.seasonalFactors[probeMonth] ?? 1.0;
      const probeStage = classifyCycleStage(probeFactor);

      // Cima: 22 días (rango 20-25d); Valle: 40 días (rango 35-45d); Normal: 30 días
      days = probeStage === "cima" ? 22 : probeStage === "valle" ? 40 : 30;
      dueDate = addDaysIso(prevDate, days);
      monthIndex = probeMonth;
    }

    cumulativeDays += days;
    const seasonalFactor = profile.seasonalFactors[monthIndex] ?? 1.0;
    const cycleStage = classifyCycleStage(seasonalFactor);
    const baseMonthlyNet = computeMonthlyNetProfit(profile, seasonalFactor);
    const projectedNetProfit = round2(
      mode === "elastic" ? baseMonthlyNet * (days / 30) : baseMonthlyNet
    );
    const paymentCap = round2(Math.max(0, projectedNetProfit) * params.fieldCriterionFactor);

    slots.push({
      number: t,
      dueDate,
      days,
      daysFromStart: cumulativeDays,
      monthIndex,
      seasonalFactor,
      cycleStage,
      projectedNetProfit,
      paymentCap,
    });
    prevDate = dueDate;
  }

  return slots;
}

function computeQuotaRatio(installment: number, netProfit: number): {
  ratio: number;
  breached: boolean;
  factorLimit: number;
} {
  return {
    ratio: netProfit <= 0 ? (installment > 0 ? Infinity : 0) : installment / netProfit,
    breached: false,
    factorLimit: 0,
  };
}

function simulateKipuPass(
  principal: number,
  slots: PeriodSlot[],
  params: CreditParams,
  mu: number,
  enforceCap: boolean
): {
  endingBalance: number;
  minPrincipalAmortized: number;
  anyCapViolation: boolean;
  rawInstallments: number[];
} {
  const ted = teaToTed360(params.tea);
  const n = slots.length;
  const avgLinearPrincipal = principal / n;
  let balance = round2(principal);
  let pendIns = 0;
  let pendInt = 0;
  let minPrincipalAmortized = Infinity;
  let anyCapViolation = false;
  const rawInstallments: number[] = [];

  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const interest = round2(computePeriodInterest(balance, ted, slot.days));
    const insurance = round2(
      computePeriodInsurance(
        balance,
        params.desgravamenRateAnnual,
        params.insurableValue,
        params.patrimonialRateAnnual,
        slot.days
      )
    );
    const totalChargesDue = round2(pendIns + insurance + pendInt + interest);
    const minHealthyPrincipal = Math.max(1.0, 0.12 * avgLinearPrincipal);

    let installment: number;
    if (enforceCap) {
      if (slot.paymentCap <= totalChargesDue) {
        // Regla Q&A #7 Caja Trujillo: en valle profundo la cuota no supera el tope de capacidad;
        // cubre parcialmente seguros/intereses en orden y lo impago queda pendiente sin capitalizarse.
        installment = Math.max(0, slot.paymentCap);
      } else {
        const capHeadroom = slot.paymentCap - totalChargesDue;
        const floorPrincipal = Math.min(
          minHealthyPrincipal,
          Math.max(Math.min(1.0, capHeadroom), 0.45 * capHeadroom)
        );
        const floorInstallment = totalChargesDue + floorPrincipal;
        const surplusRoom = Math.max(0, slot.paymentCap - floorInstallment);

        const antiBalloon = 1 - 0.14 * (i / Math.max(1, n - 1));
        const baseWeight =
          slot.cycleStage === "cima"
            ? 1.0
            : slot.cycleStage === "normal"
              ? 0.68 * antiBalloon
              : 0.22;

        const weight =
          mu <= 1 ? mu * baseWeight : baseWeight + (mu - 1) * (1 - baseWeight);

        installment = Math.min(slot.paymentCap, floorInstallment + weight * surplusRoom);
      }

      const maxNeeded = round2(totalChargesDue + balance);
      installment = Math.min(maxNeeded, Math.max(0, installment));

      if (
        (slot.projectedNetProfit <= 0 && installment > 0.01) ||
        installment > slot.paymentCap + 0.02
      ) {
        anyCapViolation = true;
      }
    } else {
      const seasonalLift = Math.pow(Math.max(0.45, slot.seasonalFactor), 1.35);
      const target = totalChargesDue + mu * avgLinearPrincipal * seasonalLift;
      installment = Math.min(round2(totalChargesDue + balance), Math.max(totalChargesDue + 0.5, target));
    }

    const wf = applyPaymentWaterfall(installment, {
      prevPrincipalBalance: balance,
      pendingInsurance: pendIns,
      periodInsurance: insurance,
      pendingInterest: pendInt,
      periodInterest: interest,
      scheduledPrincipal: Math.max(0, installment - totalChargesDue),
      overduePrincipal: 0,
    });

    if (balance > 0.01 && slot.paymentCap > totalChargesDue + 1) {
      minPrincipalAmortized = Math.min(minPrincipalAmortized, wf.principalAmortized);
    }

    balance = wf.endingPrincipalBalance;
    pendIns = wf.endingPendingInsurance;
    pendInt = wf.endingPendingInterest;
    rawInstallments.push(wf.actualPaid);
  }

  return {
    endingBalance: round2(balance + pendIns + pendInt),
    minPrincipalAmortized,
    anyCapViolation,
    rawInstallments,
  };
}

function finalizeScheduleFromInstallments(
  mode: "kipu" | "fixed",
  periodicityMode: PeriodicityMode,
  principal: number,
  slots: PeriodSlot[],
  params: CreditParams,
  rawInstallments: number[],
  isFeasible: boolean,
  maxAffordablePrincipal: number
): ScheduleResult {
  const ted = teaToTed360(params.tea);
  const rows: ScheduleRow[] = [];
  let balance = round2(principal);
  let pendIns = 0;
  let pendInt = 0;
  let totalInterest = 0;
  let totalInsurance = 0;
  let totalPaid = 0;
  let maxQuotaToProfitRatio = 0;

  const planned = rawInstallments.map((v) => round2(v));

  for (let pass = 0; pass < 2; pass++) {
    let simBalance = round2(principal);
    let simPendIns = 0;
    let simPendInt = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const perInt = round2(computePeriodInterest(simBalance, ted, slot.days));
      const perIns = round2(
        computePeriodInsurance(
          simBalance,
          params.desgravamenRateAnnual,
          params.insurableValue,
          params.patrimonialRateAnnual,
          slot.days
        )
      );
      const chargesDue = round2(simPendIns + perIns + simPendInt + perInt);
      if (i === slots.length - 1) {
        const neededLast = round2(chargesDue + simBalance);
        if (
          mode === "kipu" &&
          pass === 0 &&
          isFeasible &&
          neededLast > slot.paymentCap &&
          slots.length > 1
        ) {
          const excess = round2(neededLast - slot.paymentCap + 0.05);
          let bestIdx = 0;
          let bestSlack = -Infinity;
          for (let j = 0; j < slots.length - 1; j++) {
            const slack = slots[j].paymentCap - planned[j];
            if (slack > bestSlack) {
              bestSlack = slack;
              bestIdx = j;
            }
          }
          if (bestSlack >= excess) {
            planned[bestIdx] = round2(planned[bestIdx] + excess);
          }
        }
        planned[i] = neededLast;
      }
      const wfSim = applyPaymentWaterfall(planned[i], {
        prevPrincipalBalance: simBalance,
        pendingInsurance: simPendIns,
        periodInsurance: perIns,
        pendingInterest: simPendInt,
        periodInterest: perInt,
        scheduledPrincipal: Math.max(0, planned[i] - chargesDue),
        overduePrincipal: 0,
      });
      simBalance = wfSim.endingPrincipalBalance;
      simPendIns = wfSim.endingPendingInsurance;
      simPendInt = wfSim.endingPendingInterest;
    }
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const perInt = round2(computePeriodInterest(balance, ted, slot.days));
    const perIns = round2(
      computePeriodInsurance(
        balance,
        params.desgravamenRateAnnual,
        params.insurableValue,
        params.patrimonialRateAnnual,
        slot.days
      )
    );
    const totalChargesDue = round2(pendIns + perIns + pendInt + perInt);

    const scheduledInstallment =
      i === slots.length - 1
        ? round2(totalChargesDue + balance)
        : round2(Math.min(totalChargesDue + balance, planned[i]));

    const scheduledPrincipal = round2(Math.max(0, scheduledInstallment - totalChargesDue));

    const wf = applyPaymentWaterfall(scheduledInstallment, {
      prevPrincipalBalance: balance,
      pendingInsurance: pendIns,
      periodInsurance: perIns,
      pendingInterest: pendInt,
      periodInterest: perInt,
      scheduledPrincipal,
      overduePrincipal: 0,
    });

    balance = wf.endingPrincipalBalance;
    pendIns = wf.endingPendingInsurance;
    pendInt = wf.endingPendingInterest;
    totalInterest = round2(totalInterest + wf.paidPendingInterest + wf.paidPeriodInterest);
    totalInsurance = round2(totalInsurance + wf.paidPendingInsurance + wf.paidPeriodInsurance);
    totalPaid = round2(totalPaid + wf.actualPaid);

    const { ratio } = computeQuotaRatio(scheduledInstallment, slot.projectedNetProfit);
    const capacityBreached =
      slot.projectedNetProfit <= 0
        ? scheduledInstallment > 0
        : scheduledInstallment > slot.paymentCap + 0.05;

    if (Number.isFinite(ratio)) {
      maxQuotaToProfitRatio = Math.max(maxQuotaToProfitRatio, ratio);
    } else if (scheduledInstallment > 0) {
      maxQuotaToProfitRatio = Infinity;
    }

    rows.push({
      number: slot.number,
      dueDate: slot.dueDate,
      days: slot.days,
      daysFromStart: slot.daysFromStart,
      monthIndex: slot.monthIndex,
      cycleStage: slot.cycleStage,
      seasonalFactor: slot.seasonalFactor,
      projectedNetProfit: slot.projectedNetProfit,
      paymentCap: slot.paymentCap,
      periodInsurance: perIns,
      periodInterest: perInt,
      paidPendingInsurance: wf.paidPendingInsurance,
      paidInsurance: wf.paidPeriodInsurance,
      paidPendingInterest: wf.paidPendingInterest,
      paidInterest: wf.paidPeriodInterest,
      principalAmortized: wf.principalAmortized,
      scheduledInstallment,
      actualPaid: wf.actualPaid,
      endingPrincipalBalance: wf.endingPrincipalBalance,
      pendingInsuranceBalance: wf.endingPendingInsurance,
      pendingInterestBalance: wf.endingPendingInterest,
      overduePrincipalBalance: wf.endingOverduePrincipal,
      totalExigibleDebt: wf.totalExigibleDebt,
      freeCashFlow: round2(slot.projectedNetProfit - wf.actualPaid),
      quotaToProfitRatio: ratio,
      capacityBreached,
      cumulativeOverdueDays: 0,
    });
  }

  const tcea = computeTCEA(
    principal,
    rows.map((r) => ({ daysFromStart: r.daysFromStart, amount: r.actualPaid }))
  );

  // En KipuAI el plan sólo es viable si, tras el cierre exacto de la última cuota,
  // ninguna etapa supera el tope Cuota/Utilidad Neta (regla Q&A #5).
  const finalFeasible =
    mode === "kipu" ? isFeasible && !rows.some((r) => r.capacityBreached) : isFeasible;

  return {
    mode,
    periodicityMode,
    rows,
    totalInterest,
    totalInsurance,
    totalPaid,
    tcea,
    maxQuotaToProfitRatio,
    isFeasible: finalFeasible,
    maxAffordablePrincipal,
    riskMetrics: computeScheduleRiskMetrics(rows, principal, params.fieldCriterionFactor),
  };
}

export function computeScheduleRiskMetrics(
  rows: ScheduleRow[],
  principal: number,
  appliedFactor: number
): ScheduleRiskMetrics {
  const base = Math.max(1, principal);
  const principals = rows.map((r) => r.principalAmortized);
  const sortedDesc = [...principals].sort((a, b) => b - a);
  const lastQuarterStart = Math.floor(rows.length * 0.75);
  let minFactorHeadroom = Infinity;
  for (const r of rows) {
    if (r.projectedNetProfit > 0) {
      minFactorHeadroom = Math.min(minFactorHeadroom, appliedFactor - r.scheduledInstallment / r.projectedNetProfit);
    } else if (r.scheduledInstallment > 0) {
      minFactorHeadroom = -Infinity;
    }
  }
  return {
    maxSinglePrincipalShare: (sortedDesc[0] ?? 0) / base,
    top3PrincipalShare: sortedDesc.slice(0, 3).reduce((s, v) => s + v, 0) / base,
    lastQuarterPrincipalShare:
      principals.slice(lastQuarterStart).reduce((s, v) => s + v, 0) / base,
    interestOnlyPeriods: rows.filter((r) => r.principalAmortized < 0.01 * base).length,
    partialChargePeriods: rows.filter(
      (r) => r.pendingInsuranceBalance + r.pendingInterestBalance > 0.01
    ).length,
    minFactorHeadroom: Number.isFinite(minFactorHeadroom) || minFactorHeadroom < 0 ? minFactorHeadroom : 0,
  };
}

function computeMaxAffordablePrincipal(slots: PeriodSlot[], params: CreditParams): number {
  if (slots.every((s) => s.paymentCap <= 5)) return 0;

  let low = 0;
  let high = 1_000_000;

  // Acotar cota superior rápida usando suma de topes de pago
  const sumCaps = slots.reduce((acc, s) => acc + s.paymentCap, 0);
  high = Math.max(500, sumCaps);

  for (let iter = 0; iter < 50; iter++) {
    const mid = 0.5 * (low + high);
    const test = simulateKipuPass(mid, slots, params, 2.0, true);
    if (test.endingBalance <= 1e-4 && !test.anyCapViolation) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.floor(low / 100) * 100;
}

export function generateKipuSchedule(
  profile: BusinessProfile,
  rawParams: CreditParams
): ScheduleResult {
  const params = sanitizeCreditParams(rawParams);
  const slots = buildPeriodTimeline(profile, params, params.periodicityMode);
  const maxAffordablePrincipal = computeMaxAffordablePrincipal(slots, params);

  const maxCapPass = simulateKipuPass(params.principal, slots, params, 2.0, true);
  const isFeasible = maxCapPass.endingBalance <= 1e-3 && !maxCapPass.anyCapViolation;

  const optimizeUnderCaps = (capSlots: PeriodSlot[]): number[] => {
    let low = 0;
    let high = 2.0;
    for (let iter = 0; iter < 70; iter++) {
      const mid = 0.5 * (low + high);
      const res = simulateKipuPass(params.principal, capSlots, params, mid, true);
      if (res.endingBalance > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return simulateKipuPass(params.principal, capSlots, params, high, true).rawInstallments;
  };

  let chosenInstallments: number[];
  if (isFeasible) {
    // Riesgo 1 (estimación optimista): primero se intenta construir el plan dejando un colchón
    // prudencial del PRUDENTIAL_HEADROOM del factor en cada etapa; sólo si no cabe se usa el tope pleno.
    // El colchón nunca baja el tope por debajo de seguros + interés del periodo (cota superior con
    // saldo inicial), para no generar pendientes ni encarecer el crédito (Riesgo 3).
    const tedForBuffer = teaToTed360(params.tea);
    const bufferedSlots = slots.map((s) => {
      const chargesUpperBound =
        computePeriodInterest(params.principal, tedForBuffer, s.days) +
        computePeriodInsurance(
          params.principal,
          params.desgravamenRateAnnual,
          params.insurableValue,
          params.patrimonialRateAnnual,
          s.days
        );
      return {
        ...s,
        paymentCap: round2(
          Math.max(s.paymentCap * (1 - PRUDENTIAL_HEADROOM), Math.min(s.paymentCap, chargesUpperBound + 1))
        ),
      };
    });
    const bufferedPass = simulateKipuPass(params.principal, bufferedSlots, params, 2.0, true);
    const bufferedFeasible = bufferedPass.endingBalance <= 1e-3 && !bufferedPass.anyCapViolation;
    chosenInstallments = optimizeUnderCaps(bufferedFeasible ? bufferedSlots : slots);
  } else {
    let low = 0.1;
    let high = 5.0;
    while (simulateKipuPass(params.principal, slots, params, high, false).endingBalance > 0) {
      high *= 2;
    }
    for (let iter = 0; iter < 70; iter++) {
      const mid = 0.5 * (low + high);
      const res = simulateKipuPass(params.principal, slots, params, mid, false);
      if (res.endingBalance > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
    chosenInstallments = simulateKipuPass(params.principal, slots, params, high, false).rawInstallments;
  }

  return finalizeScheduleFromInstallments(
    "kipu",
    params.periodicityMode,
    params.principal,
    slots,
    params,
    chosenInstallments,
    isFeasible,
    maxAffordablePrincipal
  );
}

/**
 * Genera el Cronograma de Cuota Fija Tradicional bajo las mismas tasas Base 360 y seguros
 * (periodicidad mensual estándar con días exactos entre fechas).
 */
export function generateFixedSchedule(
  profile: BusinessProfile,
  rawParams: CreditParams
): ScheduleResult {
  const params = sanitizeCreditParams(rawParams);
  const slots = buildPeriodTimeline(profile, params, "monthly");
  const ted = teaToTed360(params.tea);

  const residualAtQuota = (quota: number): number => {
    let bal = params.principal;
    for (const slot of slots) {
      const intAmt = computePeriodInterest(bal, ted, slot.days);
      const insAmt = computePeriodInsurance(
        bal,
        params.desgravamenRateAnnual,
        params.insurableValue,
        params.patrimonialRateAnnual,
        slot.days
      );
      bal = bal + intAmt + insAmt - quota;
    }
    return bal;
  };

  let low = params.principal / slots.length;
  let high = params.principal * 1.5;
  while (residualAtQuota(high) > 0) {
    high *= 2;
  }

  for (let iter = 0; iter < 75; iter++) {
    const mid = 0.5 * (low + high);
    if (residualAtQuota(mid) > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const fixedQuota = 0.5 * (low + high);
  const rawInstallments = slots.map(() => fixedQuota);
  const maxAffordable = computeMaxAffordablePrincipal(slots, params);
  const fixedSchedule = finalizeScheduleFromInstallments(
    "fixed",
    "monthly",
    params.principal,
    slots,
    params,
    rawInstallments,
    true,
    maxAffordable
  );

  const anyBreach = fixedSchedule.rows.some((r) => r.capacityBreached);
  return {
    ...fixedSchedule,
    isFeasible: !anyBreach,
  };
}

export function buildComparisonSchedules(
  profile: BusinessProfile,
  rawParams: CreditParams
): { kipu: ScheduleResult; fixed: ScheduleResult } {
  return {
    kipu: generateKipuSchedule(profile, rawParams),
    fixed: generateFixedSchedule(profile, rawParams),
  };
}

function computeStressedSlotNetProfit(
  profile: BusinessProfile,
  slot: PeriodSlot,
  periodicityMode: PeriodicityMode,
  scenarioId: StressScenarioId
): number {
  let effectiveFactor = slot.seasonalFactor;
  let salesMultiplier = 1.0;
  let extraOperatingCost = 0;

  if (scenarioId === "sales_drop_25") {
    salesMultiplier = 0.75;
  } else if (scenarioId === "campaign_delay_30d") {
    // Desplaza el pico de campaña 30 días (recibe el factor del mes previo)
    const delayedMonth = ((slot.monthIndex - 2 + 12) % 12) + 1;
    effectiveFactor = profile.seasonalFactors[delayedMonth] ?? 1.0;
  } else if (scenarioId === "el_nino_shock") {
    // Shock Climático Fenómeno El Niño (La Libertad): Ene-Abr caída severa de 45% + sobrecosto operativo
    if (slot.monthIndex >= 1 && slot.monthIndex <= 4) {
      salesMultiplier = 0.55; // -45% caída severa en meses de lluvias y quebradas
      extraOperatingCost =
        profile.fixedOperatingExpenses * 0.22 * Math.max(0.75, profile.elNinoSensitivity);
    } else if (slot.monthIndex === 5) {
      salesMultiplier = 0.86; // Resaca logística en mayo
      extraOperatingCost = profile.fixedOperatingExpenses * 0.08 * profile.elNinoSensitivity;
    }
  }

  const monthlyNet = computeMonthlyNetProfit(profile, effectiveFactor, {
    salesMultiplier,
    extraOperatingCost,
  });

  return round2(periodicityMode === "elastic" ? monthlyNet * (slot.days / 30) : monthlyNet);
}

function evaluateScheduleUnderStress(
  contractual: ScheduleResult,
  profile: BusinessProfile,
  rawParams: CreditParams,
  scenarioId: StressScenarioId
): StressEvaluation {
  const netProfits = contractual.rows.map((origRow) =>
    computeStressedSlotNetProfit(
      profile,
      {
        number: origRow.number,
        dueDate: origRow.dueDate,
        days: origRow.days,
        daysFromStart: origRow.daysFromStart,
        monthIndex: origRow.monthIndex,
        seasonalFactor: origRow.seasonalFactor,
        cycleStage: origRow.cycleStage,
        projectedNetProfit: origRow.projectedNetProfit,
        paymentCap: origRow.paymentCap,
      },
      contractual.periodicityMode,
      scenarioId
    )
  );
  return evaluateScheduleWithNetProfits(contractual, rawParams, netProfits);
}

/**
 * Ejecuta un cronograma contractual fijo contra una trayectoria arbitraria de Utilidad Neta por periodo
 * (escenario determinista o trayectoria Monte Carlo). El cliente paga lo exigible si su utilidad alcanza;
 * si no, destina como máximo el 100% de su utilidad neta positiva y lo impago sigue la prelación Q&A #7.
 */
export function evaluateScheduleWithNetProfits(
  contractual: ScheduleResult,
  rawParams: CreditParams,
  netProfits: number[]
): StressEvaluation {
  const params = sanitizeCreditParams(rawParams);
  const ted = teaToTed360(params.tea);

  let principalBalance = round2(params.principal);
  let pendingInsurance = 0;
  let pendingInterest = 0;
  let overduePrincipal = 0;
  let cumulativeOverdueDays = 0;

  let breachedInstallmentsCount = 0;
  let monthsOverdue30Plus = 0;
  let cumulativeFreeCash = 0;
  let totalInterestAccrued = 0;
  let totalInsuranceAccrued = 0;
  let totalPaid = 0;
  let maxQuotaToProfitRatio = 0;

  const stressedRows: ScheduleRow[] = [];

  for (let rowIdx = 0; rowIdx < contractual.rows.length; rowIdx++) {
    const origRow = contractual.rows[rowIdx];
    const stressedNetProfit = round2(netProfits[rowIdx] ?? origRow.projectedNetProfit);

    const stressedCap = round2(Math.max(0, stressedNetProfit) * params.fieldCriterionFactor);
    const perInt = round2(computePeriodInterest(principalBalance, ted, origRow.days));
    const perIns = round2(
      computePeriodInsurance(
        principalBalance,
        params.desgravamenRateAnnual,
        params.insurableValue,
        params.patrimonialRateAnnual,
        origRow.days
      )
    );

    const scheduledPrincipal = origRow.principalAmortized;
    const targetPrinThisPeriod = round2(
      Math.min(principalBalance, overduePrincipal + scheduledPrincipal)
    );
    const exigibleInstallment = round2(
      pendingInsurance + perIns + pendingInterest + perInt + targetPrinThisPeriod
    );

    // En escenario base paga lo exigible si el flujo total alcanza; en estrés el microempresario
    // sólo puede destinar hasta el 100% de su utilidad neta positiva disponible sin descapitalizarse.
    const maxCashAvailable = Math.max(0, stressedNetProfit);

    const cashAttempt = round2(Math.min(exigibleInstallment, maxCashAvailable));

    const wf = applyPaymentWaterfall(cashAttempt, {
      prevPrincipalBalance: principalBalance,
      pendingInsurance,
      periodInsurance: perIns,
      pendingInterest,
      periodInterest: perInt,
      scheduledPrincipal,
      overduePrincipal,
    });

    principalBalance = wf.endingPrincipalBalance;
    pendingInsurance = wf.endingPendingInsurance;
    pendingInterest = wf.endingPendingInterest;
    overduePrincipal = wf.endingOverduePrincipal;

    const hasArrears =
      pendingInsurance + pendingInterest + overduePrincipal > 0.5;
    if (hasArrears) {
      cumulativeOverdueDays += origRow.days;
    } else {
      cumulativeOverdueDays = 0;
    }
    if (cumulativeOverdueDays > 30) {
      monthsOverdue30Plus += 1;
    }

    const quotaToProfitRatio =
      stressedNetProfit <= 0
        ? exigibleInstallment > 0
          ? Infinity
          : 0
        : exigibleInstallment / stressedNetProfit;

    const capacityBreached =
      stressedNetProfit <= 0
        ? exigibleInstallment > 0
        : exigibleInstallment > stressedCap + 0.05;

    if (capacityBreached) {
      breachedInstallmentsCount += 1;
    }
    if (Number.isFinite(quotaToProfitRatio)) {
      maxQuotaToProfitRatio = Math.max(maxQuotaToProfitRatio, quotaToProfitRatio);
    } else if (exigibleInstallment > 0) {
      maxQuotaToProfitRatio = Infinity;
    }

    const periodFreeCash = round2(stressedNetProfit - wf.actualPaid);
    cumulativeFreeCash = round2(cumulativeFreeCash + periodFreeCash);
    totalInterestAccrued = round2(totalInterestAccrued + perInt);
    totalInsuranceAccrued = round2(totalInsuranceAccrued + perIns);
    totalPaid = round2(totalPaid + wf.actualPaid);

    stressedRows.push({
      ...origRow,
      projectedNetProfit: stressedNetProfit,
      paymentCap: stressedCap,
      periodInsurance: perIns,
      periodInterest: perInt,
      paidPendingInsurance: wf.paidPendingInsurance,
      paidInsurance: wf.paidPeriodInsurance,
      paidPendingInterest: wf.paidPendingInterest,
      paidInterest: wf.paidPeriodInterest,
      principalAmortized: wf.principalAmortized,
      scheduledInstallment: exigibleInstallment,
      actualPaid: wf.actualPaid,
      endingPrincipalBalance: wf.endingPrincipalBalance,
      pendingInsuranceBalance: wf.endingPendingInsurance,
      pendingInterestBalance: wf.endingPendingInterest,
      overduePrincipalBalance: wf.endingOverduePrincipal,
      totalExigibleDebt: wf.totalExigibleDebt,
      freeCashFlow: periodFreeCash,
      quotaToProfitRatio,
      capacityBreached,
      cumulativeOverdueDays,
    });
  }

  const lastRow = stressedRows.at(-1);
  const unpaidResidualDebt = lastRow ? lastRow.totalExigibleDebt : 0;

  // Para la TCEA comparativa bajo estrés incluimos el saldo residual al vencimiento final si quedara deuda exigible
  const tceaFlows = stressedRows.map((r, idx) => ({
    daysFromStart: r.daysFromStart,
    amount:
      idx === stressedRows.length - 1 ? round2(r.actualPaid + unpaidResidualDebt) : r.actualPaid,
  }));
  const tcea = computeTCEA(params.principal, tceaFlows);

  const survivalStatus: StressEvaluation["survivalStatus"] =
    monthsOverdue30Plus > 0 || unpaidResidualDebt > 1
      ? "deterioro"
      : breachedInstallmentsCount > 0
        ? "alerta"
        : "resiliente";

  return {
    schedule: {
      ...contractual,
      rows: stressedRows,
      totalInterest: totalInterestAccrued,
      totalInsurance: totalInsuranceAccrued,
      totalPaid,
      tcea,
      maxQuotaToProfitRatio,
      riskMetrics: computeScheduleRiskMetrics(stressedRows, params.principal, params.fieldCriterionFactor),
    },
    breachedInstallmentsCount,
    monthsOverdue30Plus,
    cumulativeFreeCash,
    totalInterestAccrued,
    unpaidResidualDebt,
    tcea,
    survivalStatus,
  };
}

export const STRESS_SCENARIO_META: Record<
  StressScenarioId,
  { label: string; shortLabel: string; description: string }
> = {
  base: {
    label: "Escenario Base (Proyección Esperada)",
    shortLabel: "Escenario Base",
    description:
      "Flujo estacional esperado según histórico sectorial INEI/MIDAGRI/BCRP y verificación de campo.",
  },
  sales_drop_25: {
    label: "Caída de Ventas (-25%)",
    shortLabel: "Caída Ventas -25%",
    description:
      "Contracción comercial sostenida de 25% en ventas brutas durante todo el horizonte del crédito.",
  },
  campaign_delay_30d: {
    label: "Retraso de Campaña (+30 días)",
    shortLabel: "Retraso +30 días",
    description:
      "Desplaza la materialización de picos comerciales o cosechas un mes hacia adelante por cuellos logísticos.",
  },
  el_nino_shock: {
    label: "Shock Climático: Fenómeno El Niño (La Libertad)",
    shortLabel: "Shock El Niño (-45%)",
    description:
      "Caída severa de 45% en ventas entre enero y abril por lluvias/quebradas SENAMHI más sobrecosto operativo de emergencia.",
  },
};

export function simulateAllStressScenarios(
  profile: BusinessProfile,
  rawParams: CreditParams
): Record<StressScenarioId, StressComparisonResult> {
  const { kipu, fixed } = buildComparisonSchedules(profile, rawParams);
  const scenarioIds: StressScenarioId[] = [
    "base",
    "sales_drop_25",
    "campaign_delay_30d",
    "el_nino_shock",
  ];

  const out = {} as Record<StressScenarioId, StressComparisonResult>;
  for (const id of scenarioIds) {
    const meta = STRESS_SCENARIO_META[id];
    out[id] = {
      scenarioId: id,
      scenarioLabel: meta.label,
      scenarioDescription: meta.description,
      kipu: evaluateScheduleUnderStress(kipu, profile, rawParams, id),
      fixed: evaluateScheduleUnderStress(fixed, profile, rawParams, id),
    };
  }
  return out;
}
