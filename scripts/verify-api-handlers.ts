import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PERUVIAN_ARCHETYPES } from "../src/lib/archetypes";
import { simulateAllStressScenarios } from "../src/lib/financial-engine";
import { POST as extractPost } from "../src/app/api/extract-business/route";
import { POST as auditPost } from "../src/app/api/audit-committee/route";
import type { CommitteeAuditResponse, CreditParams, ExtractionResponse } from "../src/lib/types";

async function runApiTests() {
  // Force empty API key to validate 100% deterministic offline resilience
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevGoogleKey = process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = "";
  process.env.GOOGLE_API_KEY = "";

  try {
    // 1. Multimodal field note + Data URL extraction (Review Focus #5)
    const extractReq = new NextRequest("http://localhost:3000/api/extract-business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currentArchetypeId: "panaderia_trujillo",
        notes:
          "Visita técnica Trujillo: Panadería artesanal con ventas promedio S/ 20,500 al mes, insumos 55%, gastos fijos S/ 2,800, RUS S/ 50 y carga familiar S/ 2,200. Baja fuerte en febrero por calor, sube en mayo y diciembre.",
        imageBase64:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        mimeType: "image/png",
      }),
    });

    const extractRes = await extractPost(extractReq);
    assert.equal(extractRes.status, 200);
    const extractData = (await extractRes.json()) as ExtractionResponse;
    assert.equal(extractData.source, "fallback-deterministic");
    assert.equal(extractData.profilePatch.baseMonthlySales, 20_500);
    assert.ok(Math.abs(extractData.profilePatch.cogsRatio - 0.55) < 1e-4);
    assert.equal(Object.keys(extractData.profilePatch.seasonalFactors).length, 12);
    assert.ok(extractData.extractedAssumptions.length >= 2);

    // 2. Resilient fallback on minimal, null, non-string notes, and empty Data URL payloads (no HTTP 500)
    const minimalReq = new NextRequest("http://localhost:3000/api/extract-business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "" }),
    });
    const minimalRes = await extractPost(minimalReq);
    assert.equal(minimalRes.status, 200);

    const malformedExtractReq = new NextRequest("http://localhost:3000/api/extract-business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: 123, imageBase64: "data:image/png;base64," }),
    });
    const malformedExtractRes = await extractPost(malformedExtractReq);
    assert.equal(malformedExtractRes.status, 200);

    const nullExtractReq = new NextRequest("http://localhost:3000/api/extract-business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const nullExtractRes = await extractPost(nullExtractReq);
    assert.equal(nullExtractRes.status, 200);

    const nullAuditReq = new NextRequest("http://localhost:3000/api/audit-committee", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const nullAuditRes = await auditPost(nullAuditReq);
    assert.equal(nullAuditRes.status, 200);

    // 3. Committee Devil's Advocate Audit endpoint with all 5 risk mitigations
    const agro = PERUVIAN_ARCHETYPES[2];
    const params: CreditParams = {
      ...agro.recommendedCredit,
      disbursementDate: "2026-01-10",
    };
    const stressResults = simulateAllStressScenarios(agro.profile, params);

    const auditReq = new NextRequest("http://localhost:3000/api/audit-committee", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: agro.profile,
        params,
        stressResults,
        activeScenario: "el_nino_shock",
      }),
    });

    const auditRes = await auditPost(auditReq);
    assert.equal(auditRes.status, 200);
    const auditData = (await auditRes.json()) as CommitteeAuditResponse;
    assert.equal(auditData.source, "fallback-deterministic");
    assert.ok(
      ["APROBADO_CON_MITIGANTES", "OBSERVADO_AJUSTAR_MONTO", "RECHAZADO"].includes(auditData.verdict)
    );
    assert.ok(auditData.executiveSummary.includes("S/"));
    assert.ok(auditData.fiveRisksMitigation.optimisticEstimation.length > 20);
    assert.ok(auditData.fiveRisksMitigation.capitalConcentration.length > 20);
    assert.ok(auditData.fiveRisksMitigation.creditCostIncrease.length > 20);
    assert.ok(auditData.fiveRisksMitigation.overIndebtedness.length > 20);
    assert.ok(auditData.fiveRisksMitigation.humanFieldCriterion.length > 20);
    assert.ok(auditData.devilAdvocateObjections.length >= 3);
    assert.ok(auditData.generatedAtLima.length > 5);

    console.log("PASS: verify-api-handlers (extract-business and audit-committee contracts & fallbacks green)");
  } finally {
    process.env.GEMINI_API_KEY = prevGeminiKey;
    process.env.GOOGLE_API_KEY = prevGoogleKey;
  }
}

runApiTests();
