import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { getArchetypeById } from "@/lib/archetypes";
import { buildDeterministicCommitteeAudit } from "@/lib/deterministic-ai";
import { simulateAllStressScenarios } from "@/lib/financial-engine";
import { runMonteCarlo } from "@/lib/monte-carlo";
import { formatPEN, formatPct, getNowLimaTimestamp, getTodayLimaIso } from "@/lib/formatters";
import type {
  BusinessProfile,
  CommitteeAuditResponse,
  CreditParams,
  StressComparisonResult,
  StressScenarioId,
} from "@/lib/types";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
const GEMINI_TIMEOUT_MS = 15_000;
const VALID_SCENARIOS: StressScenarioId[] = [
  "base",
  "sales_drop_25",
  "campaign_delay_30d",
  "el_nino_shock",
];
const VALID_VERDICTS: CommitteeAuditResponse["verdict"][] = [
  "APROBADO_CON_MITIGANTES",
  "OBSERVADO_AJUSTAR_MONTO",
  "RECHAZADO",
];

const COMMITTEE_AUDIT_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: VALID_VERDICTS,
    },
    executiveSummary: { type: "string" },
    quotaDynamicsExplanation: { type: "string" },
    sectorClimateAssumptions: {
      type: "array",
      items: { type: "string" },
    },
    fiveRisksMitigation: {
      type: "object",
      properties: {
        optimisticEstimation: { type: "string" },
        capitalConcentration: { type: "string" },
        creditCostIncrease: { type: "string" },
        overIndebtedness: { type: "string" },
        humanFieldCriterion: { type: "string" },
      },
      required: [
        "optimisticEstimation",
        "capitalConcentration",
        "creditCostIncrease",
        "overIndebtedness",
        "humanFieldCriterion",
      ],
    },
    devilAdvocateObjections: {
      type: "array",
      items: { type: "string" },
    },
    committeeConditions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "verdict",
    "executiveSummary",
    "quotaDynamicsExplanation",
    "sectorClimateAssumptions",
    "fiveRisksMitigation",
    "devilAdvocateObjections",
    "committeeConditions",
  ],
};

function isCompleteStressMap(
  raw: unknown
): raw is Record<StressScenarioId, StressComparisonResult> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const map = raw as Record<string, unknown>;
  return VALID_SCENARIOS.every((key) => {
    const item = map[key] as Partial<StressComparisonResult> | undefined;
    return Boolean(item && item.kipu?.schedule?.rows && item.fixed?.schedule?.rows);
  });
}

function cleanStringArray(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const filtered = raw.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  return filtered.length > 0 ? filtered : fallback;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};

  try {
    const rawBody = await req.json();
    if (typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)) {
      body = rawBody as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  const defaultArch = getArchetypeById("panaderia_trujillo");
  const profile: BusinessProfile =
    typeof body.profile === "object" && body.profile !== null && !Array.isArray(body.profile)
      ? (body.profile as BusinessProfile)
      : defaultArch.profile;
  const params: CreditParams =
    typeof body.params === "object" && body.params !== null && !Array.isArray(body.params)
      ? (body.params as CreditParams)
      : {
          ...defaultArch.recommendedCredit,
          disbursementDate: getTodayLimaIso(),
        };

  let stressResults: Record<StressScenarioId, StressComparisonResult>;
  if (isCompleteStressMap(body.stressResults)) {
    stressResults = body.stressResults;
  } else {
    try {
      stressResults = simulateAllStressScenarios(profile, params);
    } catch (err) {
      // Payload malformado (fecha inválida, perfil incompleto): se audita el arquetipo por defecto
      // en lugar de responder 500 durante la demo.
      console.warn("[audit-committee] Invalid profile/params, using default archetype:", err);
      return NextResponse.json(
        buildDeterministicCommitteeAudit({
          profile: defaultArch.profile,
          params: { ...defaultArch.recommendedCredit, disbursementDate: getTodayLimaIso() },
          stressResults: simulateAllStressScenarios(defaultArch.profile, {
            ...defaultArch.recommendedCredit,
            disbursementDate: getTodayLimaIso(),
          }),
          activeScenario: "el_nino_shock",
          modelName: DEFAULT_MODEL,
        }),
        { status: 200 }
      );
    }
  }

  const rawScenario = body.activeScenario;
  const activeScenario: StressScenarioId =
    typeof rawScenario === "string" && VALID_SCENARIOS.includes(rawScenario as StressScenarioId)
      ? (rawScenario as StressScenarioId)
      : "el_nino_shock";

  const fallback = buildDeterministicCommitteeAudit({
    profile,
    params,
    stressResults,
    activeScenario,
    modelName: DEFAULT_MODEL,
  });

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(fallback, { status: 200 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const baseKipu = stressResults.base.kipu;
    const baseFixed = stressResults.base.fixed;
    const nino = stressResults.el_nino_shock;
    const mc = runMonteCarlo(profile, params, { simulations: 500 });

    const prompt = `Actúa como "Abogado del Diablo" y Auditor Senior del Comité de Riesgos de Caja Trujillo (Perú).
Redacta un dictamen ejecutivo riguroso y explicable en español para la operación:
- Cliente / Giro: ${profile.name} (${profile.sector} — ${profile.location})
- Monto: ${formatPEN(params.principal)} | Plazo: ${params.numInstallments} cuotas (${params.periodicityMode}) | TEA: ${formatPct(params.tea)}
- Producto: ${params.productType} | Factor Criterio de Campo: ${formatPct(params.fieldCriterionFactor)}
- Viabilidad Base 360 KipuAI: ${baseKipu.schedule.isFeasible ? "VIABLE" : `INVIABLE (máx. viable ${formatPEN(baseKipu.schedule.maxAffordablePrincipal)})`}
- TCEA KipuAI: ${formatPct(baseKipu.tcea)} (Interés total ${formatPEN(baseKipu.totalInterestAccrued)}) vs. TCEA Cuota Fija: ${formatPct(baseFixed.tcea)} (Interés total ${formatPEN(baseFixed.totalInterestAccrued)})
- Escenario activo evaluado: ${stressResults[activeScenario].scenarioLabel}
- Bajo Shock Fenómeno El Niño (-45% Ene-Abr):
  * KipuAI: ${nino.kipu.breachedInstallmentsCount} rupturas de capacidad, ${nino.kipu.monthsOverdue30Plus} meses >30d deterioro, liquidez libre acumulada ${formatPEN(nino.kipu.cumulativeFreeCash)}.
  * Cuota Fija: ${nino.fixed.breachedInstallmentsCount} rupturas de capacidad, ${nino.fixed.monthsOverdue30Plus} meses >30d deterioro, liquidez libre acumulada ${formatPEN(nino.fixed.cumulativeFreeCash)}.

- Monte Carlo (${mc.config.simulations} trayectorias, semilla ${mc.config.seed}): P(cuota > 100% utilidad) KipuAI ${formatPct(mc.kipu.probAnyShortfall, 1)} vs. Cuota Fija ${formatPct(mc.fixed.probAnyShortfall, 1)}; P(deuda al vencimiento) ${formatPct(mc.kipu.probResidualDebt, 1)} vs. ${formatPct(mc.fixed.probResidualDebt, 1)}; pérdida esperada ${formatPEN(mc.kipu.expectedResidual)} vs. ${formatPEN(mc.fixed.expectedResidual)}; resultado económico esperado para la Caja ${formatPEN(mc.kipu.expectedEconomicResult)} vs. ${formatPEN(mc.fixed.expectedEconomicResult)}.

Explica con cifras exactas por qué sube y baja la cuota, cuál es el resultado económico para Caja Trujillo (no sólo el ahorro del cliente), qué supuestos sectoriales/climáticos (INEI, MIDAGRI, SENAMHI, BCRP) respaldan el modelo y cómo se mitigan los 5 riesgos regulatorios: (1) estimación optimista, (2) concentración de capital al final, (3) encarecimiento del crédito, (4) sobreendeudamiento y (5) trazabilidad del criterio humano de campo.`;

    const interaction = await Promise.race([
      ai.interactions.create({
        model: DEFAULT_MODEL,
        system_instruction:
          "Eres miembro independiente del Comité de Riesgos Microfinancieros de Caja Trujillo. Sé preciso, cuantitativo, crítico y constructivo. Responde sólo en JSON según el esquema.",
        input: prompt,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: COMMITTEE_AUDIT_SCHEMA,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini audit timeout")), GEMINI_TIMEOUT_MS)
      ),
    ]);

    const rawText = interaction.output_text;
    if (!rawText) {
      return NextResponse.json(fallback, { status: 200 });
    }

    const parsed = JSON.parse(rawText);
    // Guardarraíl anti-dependencia del modelo (Riesgo 5): el LLM puede endurecer el dictamen,
    // pero nunca aprobar algo que el motor determinista Base 360 observa o rechaza.
    const severity: Record<CommitteeAuditResponse["verdict"], number> = {
      APROBADO_CON_MITIGANTES: 0,
      OBSERVADO_AJUSTAR_MONTO: 1,
      RECHAZADO: 2,
    };
    const llmVerdict = VALID_VERDICTS.includes(parsed?.verdict)
      ? (parsed.verdict as CommitteeAuditResponse["verdict"])
      : fallback.verdict;
    const parsedVerdict =
      severity[llmVerdict] >= severity[fallback.verdict] ? llmVerdict : fallback.verdict;

    const liveAudit: CommitteeAuditResponse = {
      verdict: parsedVerdict,
      executiveSummary:
        typeof parsed?.executiveSummary === "string" && parsed.executiveSummary.trim()
          ? parsed.executiveSummary
          : fallback.executiveSummary,
      quotaDynamicsExplanation:
        typeof parsed?.quotaDynamicsExplanation === "string" &&
        parsed.quotaDynamicsExplanation.trim()
          ? parsed.quotaDynamicsExplanation
          : fallback.quotaDynamicsExplanation,
      sectorClimateAssumptions: cleanStringArray(
        parsed?.sectorClimateAssumptions,
        fallback.sectorClimateAssumptions
      ),
      fiveRisksMitigation: {
        optimisticEstimation:
          parsed?.fiveRisksMitigation?.optimisticEstimation ||
          fallback.fiveRisksMitigation.optimisticEstimation,
        capitalConcentration:
          parsed?.fiveRisksMitigation?.capitalConcentration ||
          fallback.fiveRisksMitigation.capitalConcentration,
        creditCostIncrease:
          parsed?.fiveRisksMitigation?.creditCostIncrease ||
          fallback.fiveRisksMitigation.creditCostIncrease,
        overIndebtedness:
          parsed?.fiveRisksMitigation?.overIndebtedness ||
          fallback.fiveRisksMitigation.overIndebtedness,
        humanFieldCriterion:
          parsed?.fiveRisksMitigation?.humanFieldCriterion ||
          fallback.fiveRisksMitigation.humanFieldCriterion,
      },
      devilAdvocateObjections: cleanStringArray(
        parsed?.devilAdvocateObjections,
        fallback.devilAdvocateObjections
      ),
      committeeConditions: cleanStringArray(
        parsed?.committeeConditions,
        fallback.committeeConditions
      ),
      source: "gemini-live",
      modelUsed: DEFAULT_MODEL,
      generatedAtLima: getNowLimaTimestamp(),
    };

    return NextResponse.json(liveAudit, { status: 200 });
  } catch (err) {
    console.warn("[audit-committee] Falling back to deterministic auditor:", err);
    return NextResponse.json(fallback, { status: 200 });
  }
}
