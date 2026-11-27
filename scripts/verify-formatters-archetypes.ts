import assert from "node:assert/strict";
import {
  formatPEN,
  formatPct,
  exactDaysBetween,
  addDaysIso,
  addMonthsClampedIso,
  formatDateLima,
  getTodayLimaIso,
  classifyCycleStage,
} from "../src/lib/formatters";
import { PERUVIAN_ARCHETYPES, computeMonthlyNetProfit } from "../src/lib/archetypes";

function runTests() {
  // 1. Deterministic Peruvian currency formatting (Review Focus #1)
  assert.equal(formatPEN(12450), "S/ 12,450.00");
  assert.equal(formatPEN(0), "S/ 0.00");
  assert.equal(formatPEN(-320.5), "-S/ 320.50");
  assert.equal(formatPEN(1589432.789), "S/ 1,589,432.79");
  assert.equal(formatPct(0.425), "42.50%");

  // 2. Location-agnostic calendar arithmetic & America/Lima date formatting without UTC-5 drift
  assert.equal(exactDaysBetween("2026-02-15", "2026-03-15"), 28);
  assert.equal(exactDaysBetween("2024-02-15", "2024-03-15"), 29);
  assert.equal(addMonthsClampedIso("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClampedIso("2024-01-31", 1), "2024-02-29");
  assert.equal(addDaysIso("2026-12-20", 22), "2027-01-11");
  assert.throws(() => formatDateLima("2026-02-30"), /Out-of-range/);

  const formattedMay = formatDateLima("2026-05-15");
  assert.ok(formattedMay.includes("15"), `Expected day 15 in "${formattedMay}" (no UTC-5 drift)`);
  assert.ok(formattedMay.includes("2026"), `Expected year 2026 in "${formattedMay}"`);

  const todayLima = getTodayLimaIso();
  assert.match(todayLima, /^\d{4}-\d{2}-\d{2}$/);

  // 3. Seasonal cycle classification
  assert.equal(classifyCycleStage(1.35), "cima");
  assert.equal(classifyCycleStage(1.0), "normal");
  assert.equal(classifyCycleStage(0.72), "valle");

  // 4. All 4 calibrated Peruvian regional archetypes (La Libertad)
  assert.equal(PERUVIAN_ARCHETYPES.length, 4);
  const expectedIds = ["panaderia_trujillo", "textil_porvenir", "agro_viru_palta", "taller_esperanza"];
  assert.deepEqual(
    PERUVIAN_ARCHETYPES.map((a) => a.id),
    expectedIds
  );

  for (const arch of PERUVIAN_ARCHETYPES) {
    for (let m = 1; m <= 12; m++) {
      assert.equal(typeof arch.profile.seasonalFactors[m], "number", `Missing month ${m} in ${arch.id}`);
      assert.ok(arch.profile.seasonalFactors[m] > 0.3 && arch.profile.seasonalFactors[m] < 2.2);
    }
    const baseNet = computeMonthlyNetProfit(arch.profile, 1.0);
    assert.ok(baseNet > 1000, `Expected healthy base monthly net profit for ${arch.id}, got ${baseNet}`);
    assert.ok(arch.profile.sources.length >= 2);
    assert.ok(arch.sampleFieldNotes.length > 40);
    assert.ok(arch.sampleNotebookDataUrl.startsWith("data:image/svg+xml;base64,"));
  }

  console.log("PASS: verify-formatters-archetypes (all currency, Lima calendar, and 4 archetype checks green)");
}

runTests();
