import assert from "node:assert/strict";
import { PERUVIAN_ARCHETYPES } from "../src/lib/archetypes";
import {
  computeAllBusinessCases,
  computeScenarioBusinessCase,
  sbsCategoryForDays,
} from "../src/lib/business-case";
import { simulateAllStressScenarios } from "../src/lib/financial-engine";
import { runMonteCarlo } from "../src/lib/monte-carlo";
import type { CreditParams } from "../src/lib/types";

function run() {
  // 1. SBS categories (Res. SBS 11356-2008, créditos MYPE)
  assert.deepEqual(sbsCategoryForDays(0), { category: "Normal", rate: 0.01 });
  assert.deepEqual(sbsCategoryForDays(30), { category: "CPP", rate: 0.05 });
  assert.deepEqual(sbsCategoryForDays(31), { category: "Deficiente", rate: 0.25 });
  assert.deepEqual(sbsCategoryForDays(120), { category: "Dudoso", rate: 0.6 });
  assert.deepEqual(sbsCategoryForDays(121), { category: "Pérdida", rate: 1.0 });

  const agro = PERUVIAN_ARCHETYPES.find((a) => a.id === "agro_viru_palta")!;
  const params: CreditParams = {
    ...agro.recommendedCredit,
    disbursementDate: "2026-01-15",
    periodicityMode: "elastic",
  };
  const stress = simulateAllStressScenarios(agro.profile, params);

  // 2. Business case: identity and economic advantage for the Caja under adverse scenarios
  const cases = computeAllBusinessCases(stress, params);
  assert.equal(cases.length, 4);
  for (const bc of cases) {
    for (const plan of [bc.kipu, bc.fixed]) {
      assert.ok(
        Math.abs(plan.economicResult - (plan.interestCollected + plan.reinvestmentIncome - plan.unpaidResidual)) < 0.02
      );
      assert.ok(plan.principalRecovered <= params.principal + 0.01);
    }
  }
  const byId = Object.fromEntries(cases.map((c) => [c.scenarioId, c]));
  assert.equal(byId.base.kipu.unpaidResidual, 0);
  assert.ok(byId.base.kipu.capitalAvgLifeDays < byId.base.fixed.capitalAvgLifeDays, "KipuAI recovers capital earlier");
  assert.ok(byId.el_nino_shock.economicAdvantage > 0, "KipuAI must be better for the Caja under El Niño");
  assert.ok(byId.sales_drop_25.economicAdvantage > 0, "KipuAI must be better for the Caja under -25% sales");

  // 3. Monte Carlo is reproducible with a fixed seed
  const mcA = runMonteCarlo(agro.profile, params, { simulations: 300 });
  const mcB = runMonteCarlo(agro.profile, params, { simulations: 300 });
  assert.deepEqual(mcA, mcB, "Same seed must reproduce identical results");
  for (const s of [mcA.kipu, mcA.fixed]) {
    for (const p of [s.probAnyFactorBreach, s.probAnyShortfall, s.probOverdue30, s.probResidualDebt]) {
      assert.ok(p >= 0 && p <= 1);
    }
    assert.ok(s.residualP95 >= 0 && s.expectedResidual >= 0);
  }
  assert.equal(mcA.netProfitBands.length, params.numInstallments);
  for (const b of mcA.netProfitBands) assert.ok(b.p10 <= b.p50 && b.p50 <= b.p90);

  // 4. Zero-volatility Monte Carlo must collapse exactly onto the deterministic base scenario
  const mcZero = runMonteCarlo(agro.profile, params, {
    simulations: 50,
    levelSigma: 0,
    monthlySigma: 0,
    campaignDelayProb: 0,
    elNinoProb: 0,
  });
  const baseCase = computeScenarioBusinessCase(stress.base, params);
  assert.equal(mcZero.kipu.probAnyFactorBreach, 0);
  assert.equal(mcZero.kipu.probResidualDebt, 0);
  assert.ok(Math.abs(mcZero.kipu.expectedEconomicResult - baseCase.kipu.economicResult) < 0.02);
  assert.ok(Math.abs(mcZero.fixed.expectedEconomicResult - baseCase.fixed.economicResult) < 0.02);
  assert.ok(Math.abs(mcZero.fixed.expectedResidual - stress.base.fixed.unpaidResidualDebt) < 0.02);

  // 5. Probabilistic dominance in the agricultural demo case
  const mc = runMonteCarlo(agro.profile, params);
  assert.ok(mc.kipu.probAnyShortfall < mc.fixed.probAnyShortfall);
  assert.ok(mc.kipu.probResidualDebt < mc.fixed.probResidualDebt);
  assert.ok(mc.kipu.expectedResidual < mc.fixed.expectedResidual);
  assert.ok(mc.kipu.expectedEconomicResult > mc.fixed.expectedEconomicResult);

  // 6. Every archetype runs end-to-end
  for (const arch of PERUVIAN_ARCHETYPES) {
    const r = runMonteCarlo(arch.profile, { ...arch.recommendedCredit, disbursementDate: "2026-03-01" }, { simulations: 100 });
    assert.ok(Number.isFinite(r.kipu.expectedEconomicResult));
  }

  console.log("PASS: verify-risk-analytics (SBS buckets, business case identity, seeded Monte Carlo, zero-vol consistency)");
}

run();
