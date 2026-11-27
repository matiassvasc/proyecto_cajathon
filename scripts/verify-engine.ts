import assert from "node:assert/strict";
import { PERUVIAN_ARCHETYPES } from "../src/lib/archetypes";
import {
  teaToTed360,
  computePeriodInterest,
  computePeriodInsurance,
  applyPaymentWaterfall,
  computeTCEA,
  buildComparisonSchedules,
  simulateAllStressScenarios,
} from "../src/lib/financial-engine";
import type { CreditParams } from "../src/lib/types";

function runEngineTests() {
  // 1. Base 360 TED, exact-day interest, and Base 360 insurance formulas
  const tea = 0.42;
  const ted = teaToTed360(tea);
  assert.ok(Math.abs(ted - (Math.pow(1 + tea, 1 / 360) - 1)) < 1e-12);

  const int360 = computePeriodInterest(10_000, ted, 360);
  assert.ok(Math.abs(int360 - 4_200) < 1e-6, `Expected 4200.00, got ${int360}`);

  const ins30 = computePeriodInsurance(10_000, 0.012, 50_000, 0.006, 30);
  assert.ok(Math.abs(ins30 - 35.0) < 1e-6, `Expected 35.00, got ${ins30}`);

  // 2. Strict 5-tier payment waterfall & ZERO capitalization of unpaid interest/insurance
  const wf1 = applyPaymentWaterfall(50, {
    prevPrincipalBalance: 10_000,
    pendingInsurance: 0,
    periodInsurance: 30,
    pendingInterest: 0,
    periodInterest: 120,
    scheduledPrincipal: 800,
    overduePrincipal: 0,
  });
  assert.equal(wf1.paidPeriodInsurance, 30);
  assert.equal(wf1.paidPeriodInterest, 20);
  assert.equal(wf1.principalAmortized, 0);
  assert.equal(wf1.endingPendingInsurance, 0);
  assert.equal(wf1.endingPendingInterest, 100);
  assert.equal(wf1.endingPrincipalBalance, 10_000, "Unpaid interest must NEVER capitalize into principal");
  assert.equal(wf1.totalExigibleDebt, 10_100);

  const wf2 = applyPaymentWaterfall(300, {
    prevPrincipalBalance: wf1.endingPrincipalBalance,
    pendingInsurance: 15,
    periodInsurance: 30,
    pendingInterest: wf1.endingPendingInterest,
    periodInterest: 120,
    scheduledPrincipal: 800,
    overduePrincipal: wf1.endingOverduePrincipal,
  });
  // Q&A #7: pending concepts first (ins 15 -> int 100 -> overdue capital 800), then period concepts
  assert.equal(wf2.paidPendingInsurance, 15);
  assert.equal(wf2.paidPendingInterest, 100);
  assert.equal(wf2.principalAmortized, 185);
  assert.equal(wf2.paidPeriodInsurance, 0);
  assert.equal(wf2.paidPeriodInterest, 0);
  assert.equal(wf2.endingPrincipalBalance, 9_815);
  assert.equal(wf2.endingPendingInsurance, 30);
  assert.equal(wf2.endingPendingInterest, 120);
  assert.equal(wf2.totalExigibleDebt, 9_965);

  // 3. TCEA exact Base 360 identity when insurances = 0 (both monthly and elastic)
  const bakery = PERUVIAN_ARCHETYPES[0];
  const zeroInsParams: CreditParams = {
    ...bakery.recommendedCredit,
    disbursementDate: "2026-01-15",
    desgravamenEnabled: false,
    patrimonialType: "none",
    periodicityMode: "monthly",
  };
  const noInsMonthly = buildComparisonSchedules(bakery.profile, zeroInsParams);
  assert.ok(
    Math.abs(noInsMonthly.kipu.tcea - zeroInsParams.tea) < 5e-4,
    `Expected Kipu TCEA ~ ${zeroInsParams.tea}, got ${noInsMonthly.kipu.tcea}`
  );
  assert.ok(
    Math.abs(noInsMonthly.fixed.tcea - zeroInsParams.tea) < 5e-4,
    `Expected Fixed TCEA ~ ${zeroInsParams.tea}, got ${noInsMonthly.fixed.tcea}`
  );

  // 4. All 4 archetypes satisfy Base 360 amortization, payment cap, and non-zero valley principal
  for (const arch of PERUVIAN_ARCHETYPES) {
    const params: CreditParams = {
      ...arch.recommendedCredit,
      disbursementDate: "2026-01-15",
    };
    const { kipu, fixed } = buildComparisonSchedules(arch.profile, params);
    assert.equal(kipu.isFeasible, true, `Expected ${arch.id} recommended credit to be feasible`);
    assert.equal(kipu.rows.at(-1)?.endingPrincipalBalance, 0);
    assert.equal(fixed.rows.at(-1)?.endingPrincipalBalance, 0);
    assert.ok(kipu.tcea > params.tea, "With insurances enabled, TCEA must exceed TEA");

    let maxPeakQuota = 0;
    let minValleyQuota = Infinity;
    for (const row of kipu.rows) {
      assert.ok(
        row.quotaToProfitRatio <= params.fieldCriterionFactor + 0.003,
        `${arch.id} row ${row.number} ratio ${row.quotaToProfitRatio} exceeded factor ${params.fieldCriterionFactor}`
      );
      assert.ok(row.principalAmortized > 0, `${arch.id} row ${row.number} must amortize positive principal`);
      if (row.cycleStage === "cima") maxPeakQuota = Math.max(maxPeakQuota, row.scheduledInstallment);
      if (row.cycleStage === "valle") minValleyQuota = Math.min(minValleyQuota, row.scheduledInstallment);
    }
    if (maxPeakQuota > 0 && Number.isFinite(minValleyQuota)) {
      assert.ok(maxPeakQuota > minValleyQuota, `Expected peak quota > valley quota for ${arch.id}`);
    }
  }

  // 5. Elastic periodicity intervals: 20..25 days in cima, 35..45 days in valle
  const agro = PERUVIAN_ARCHETYPES[2];
  const elasticParams: CreditParams = {
    ...agro.recommendedCredit,
    disbursementDate: "2026-01-10",
    periodicityMode: "elastic",
  };
  const elasticComp = buildComparisonSchedules(agro.profile, elasticParams);
  for (const row of elasticComp.kipu.rows) {
    if (row.cycleStage === "cima") {
      assert.ok(row.days >= 20 && row.days <= 25, `Expected cima days in 20..25, got ${row.days}`);
    } else if (row.cycleStage === "valle") {
      assert.ok(row.days >= 35 && row.days <= 45, `Expected valle days in 35..45, got ${row.days}`);
    } else {
      assert.equal(row.days, 30);
    }
  }

  // 6. Stress simulator, El Niño resilience, deficit guard (Review Focus #2), and infeasible loan guard (Review Focus #3)
  const stressAgro = simulateAllStressScenarios(agro.profile, elasticParams);
  assert.ok(stressAgro.el_nino_shock.kipu.breachedInstallmentsCount <= stressAgro.el_nino_shock.fixed.breachedInstallmentsCount);
  assert.ok(stressAgro.sales_drop_25.kipu.breachedInstallmentsCount < stressAgro.sales_drop_25.fixed.breachedInstallmentsCount);

  // Deficit guard when familyBurden forces negative net profit in El Niño rain months
  const extremeAgroProfile = { ...agro.profile, familyBurden: 9_500 };
  const extremeStress = simulateAllStressScenarios(extremeAgroProfile, elasticParams);
  const deficitRow = extremeStress.el_nino_shock.fixed.schedule.rows.find((r) => r.projectedNetProfit <= 0);
  assert.ok(deficitRow, "Expected at least one negative net profit row in extreme El Niño test");
  assert.equal(deficitRow.capacityBreached, true);
  assert.equal(deficitRow.quotaToProfitRatio, Infinity);

  // Infeasible principal guard
  const impossibleComp = buildComparisonSchedules(bakery.profile, {
    ...bakery.recommendedCredit,
    disbursementDate: "2026-01-15",
    principal: 500_000,
  });
  assert.equal(impossibleComp.kipu.isFeasible, false);
  assert.ok(impossibleComp.kipu.maxAffordablePrincipal > 8_000 && impossibleComp.kipu.maxAffordablePrincipal < 100_000);

  // Direct TCEA sanity check on single 360-day payment
  const singleTcea = computeTceaSanity();
  assert.ok(Math.abs(singleTcea - 0.45) < 1e-8);

  // 7. Official Q&A #7: Deep planting valley where paymentCap < periodInterest + periodInsurance at origination
  const deepValleyProfile = {
    ...agro.profile,
    seasonalFactors: {
      ...agro.profile.seasonalFactors,
      1: 0.43, // Deep planting month: small positive net profit whose cap < interest+insurance
      2: 0.43,
      5: 1.85,
      6: 1.85,
    },
  };
  const deepValleyComp = buildComparisonSchedules(deepValleyProfile, {
    ...agro.recommendedCredit,
    principal: 22_000,
    disbursementDate: "2025-12-15",
    periodicityMode: "monthly",
    fieldCriterionFactor: 0.55,
  });
  assert.equal(deepValleyComp.kipu.isFeasible, true, "Deep valley loan recoverable in harvest must be feasible per Q7");
  assert.ok(
    deepValleyComp.kipu.maxAffordablePrincipal >= 22_000,
    `Expected maxAffordablePrincipal >= 22000 even with deep-valley months, got ${deepValleyComp.kipu.maxAffordablePrincipal}`
  );
  // Zero-cap single month must not collapse maxAffordablePrincipal to 0
  const zeroCapMonthProfile = {
    ...deepValleyProfile,
    familyBurden: 5_000,
    seasonalFactors: { ...deepValleyProfile.seasonalFactors, 1: 0.35, 5: 2.0, 6: 2.0 },
  };
  const zeroCapComp = buildComparisonSchedules(zeroCapMonthProfile, {
    ...agro.recommendedCredit,
    principal: 15_000,
    disbursementDate: "2025-12-15",
    periodicityMode: "monthly",
    fieldCriterionFactor: 0.65,
  });
  assert.ok(zeroCapComp.kipu.maxAffordablePrincipal > 5_000);
  assert.equal(deepValleyComp.kipu.rows.at(-1)?.endingPrincipalBalance, 0);
  for (const r of deepValleyComp.kipu.rows) {
    assert.ok(
      r.quotaToProfitRatio <= 0.55 + 0.003,
      `Row ${r.number} ratio ${r.quotaToProfitRatio} must respect 0.55 cap even in deep valley`
    );
  }
  const partialRow = deepValleyComp.kipu.rows.find((r) => r.pendingInterestBalance > 0);
  assert.ok(partialRow, "Expected partial interest carry-forward without capitalization in deep valley");
  assert.equal(
    partialRow.endingPrincipalBalance,
    22_000,
    "Uncovered interest in deep valley must NEVER capitalize into SaldoCapital"
  );

  // 8. Q&A #7 literal: pending concepts (ins -> int -> overdue capital) BEFORE current-period concepts
  const wf3 = applyPaymentWaterfall(260, {
    prevPrincipalBalance: 5_000,
    pendingInsurance: 10,
    periodInsurance: 20,
    pendingInterest: 40,
    periodInterest: 100,
    scheduledPrincipal: 300,
    overduePrincipal: 200,
  });
  assert.equal(wf3.paidPendingInsurance, 10);
  assert.equal(wf3.paidPendingInterest, 40);
  assert.equal(wf3.principalAmortized, 200, "Overdue capital is collected before current-period charges");
  assert.equal(wf3.paidPeriodInsurance, 10);
  assert.equal(wf3.paidPeriodInterest, 0);
  assert.equal(wf3.endingPendingInsurance, 10);
  assert.equal(wf3.endingPendingInterest, 100);
  assert.equal(wf3.endingPrincipalBalance, 4_800);
  assert.equal(wf3.totalExigibleDebt, 4_910, "Unpaid charges add to total debt, not to principal balance");

  // 9. Risk metrics: concentration and interest-only periods are reported for every recommended plan
  for (const arch of PERUVIAN_ARCHETYPES) {
    const { kipu } = buildComparisonSchedules(arch.profile, {
      ...arch.recommendedCredit,
      disbursementDate: "2026-01-15",
    });
    const m = kipu.riskMetrics;
    assert.ok(m.maxSinglePrincipalShare < 0.5, `${arch.id} single-quota capital share ${m.maxSinglePrincipalShare}`);
    assert.ok(m.interestOnlyPeriods <= 2, `${arch.id} has ${m.interestOnlyPeriods} interest-only periods`);
    assert.equal(m.partialChargePeriods, 0, `${arch.id} base plan must cover charges every period`);
    assert.ok(m.minFactorHeadroom >= -0.003, `${arch.id} headroom ${m.minFactorHeadroom}`);
  }

  console.log("PASS: verify-engine (all Base 360, waterfall, Q7 deep-valley, TCEA, elastic, and stress checks green)");
}

function computeTceaSanity(): number {
  return computeTCEA(10_000, [{ daysFromStart: 360, amount: 14_500 }]);
}

runEngineTests();
