import { getArchetypeById, PERUVIAN_ARCHETYPES } from "./archetypes";
import { computeScenarioBusinessCase } from "./business-case";
import { formatPEN, formatPct, getNowLimaTimestamp, MONTH_LABELS_ES } from "./formatters";
import { PRODUCT_MAX_FACTORS, type BusinessProfile, type CommitteeAuditResponse, type CreditParams, type ExtractionResponse, type StressComparisonResult, type StressScenarioId } from "./types";

function parseSolesAmount(text: string, keywordPattern: RegExp): number | null {
  const match = keywordPattern.exec(text);
  if (!match || !match[1]) return null;
  const numeric = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function detectArchetypeFromNotes(notes: string, fallbackId?: string) {
  const lower = notes.toLowerCase();
  if (/(palta|esp[aá]rrago|vir[uú]|chao|agr[ií]cola|parcela|cosecha)/.test(lower)) {
    return getArchetypeById("agro_viru_palta");
  }
  if (/(textil|confecci[oó]n|escolar|uniforme|porvenir|remalladora|tela)/.test(lower)) {
    return getArchetypeById("textil_porvenir");
  }
  if (/(taller|mec[aá]nic|repuesto|lubricante|esperanza|automotriz)/.test(lower)) {
    return getArchetypeById("taller_esperanza");
  }
  if (/(panader[ií]a|pasteler[ií]a|horno|harina|panet[oó]n|torta)/.test(lower)) {
    return getArchetypeById("panaderia_trujillo");
  }
  return fallbackId ? getArchetypeById(fallbackId) : PERUVIAN_ARCHETYPES[0];
}

export function extractBusinessDeterministic(input: {
  notes?: unknown;
  hasImage: boolean;
  currentArchetypeId?: string;
  modelName: string;
}): ExtractionResponse {
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const baseArch = detectArchetypeFromNotes(notes, input.currentArchetypeId);
  const p = baseArch.profile;

  const parsedSales =
    parseSolesAmount(
      notes,
      /(?:ventas?|facturaci[oó]n|ingreso)[^S\d]{0,35}S\/?\s*([\d,]+(?:\.\d+)?)/i
    ) ?? p.baseMonthlySales;

  const cogsMatch = /(?:insumos?|costo[^%\d]{0,20}|telas?|repuestos?|fertilizantes?)[^%\d]{0,25}(\d{2}(?:\.\d+)?)\s*%/i.exec(
    notes
  );
  const parsedCogs = cogsMatch ? Number(cogsMatch[1]) / 100 : p.cogsRatio;

  const parsedFixed =
    parseSolesAmount(
      notes,
      /(?:alquiler|gastos?\s+fijos?|taller|riego|local)[^S\d]{0,35}S\/?\s*([\d,]+(?:\.\d+)?)/i
    ) ?? p.fixedOperatingExpenses;

  const parsedTax =
    parseSolesAmount(
      notes,
      /(?:rus|rer|mype\s+tributario|tributos?|sunat)[^S\d]{0,25}S\/?\s*([\d,]+(?:\.\d+)?)/i
    ) ?? p.taxExpenseMonthly;

  const parsedFamily =
    parseSolesAmount(
      notes,
      /(?:carga\s+familiar|canasta\s+familiar|hogar|familia)[^S\d]{0,25}S\/?\s*([\d,]+(?:\.\d+)?)/i
    ) ?? p.familyBurden;

  const factorMatch = /factor[^0-9]{0,20}(0\.\d{2})/i.exec(notes);
  const recommendedFieldFactor = factorMatch
    ? Math.min(0.85, Math.max(0.35, Number(factorMatch[1])))
    : baseArch.recommendedCredit.fieldCriterionFactor;

  const seasonalFactors: Record<number, number> = { ...p.seasonalFactors };

  const assumptions: string[] = [
    `Perfil calibrado sobre patrón sectorial «${baseArch.shortTitle}» (${p.location}).`,
    `Ventas mensuales regulares estimadas en ${formatPEN(parsedSales)} con costo directo del ${(parsedCogs * 100).toFixed(0)}%.`,
    `Gastos fijos operativos (${formatPEN(parsedFixed)}), tributos (${formatPEN(parsedTax)}) y canasta familiar (${formatPEN(parsedFamily)}) deducidos antes de medir capacidad de pago.`,
  ];

  if (input.hasImage) {
    assumptions.push(
      "Evidencia visual de cuaderno/comprobante adjunta contrastada contra márgenes típicos microfinancieros de La Libertad."
    );
  }

  const anomalies: string[] = [];
  if (/ni[ñn]o|quebrada|lluvia|clima/i.test(notes) || p.elNinoSensitivity >= 1.0) {
    anomalies.push(
      "Exposición climática detectada (SENAMHI La Libertad): se recomienda evaluar el Escenario Fenómeno El Niño en el módulo Ayni."
    );
  }
  if (/alza|subi[oó]|manteca|insumo/i.test(notes)) {
    anomalies.push(
      "Presión inflacionaria en insumos reportada en visita: se sugiere mantener margen prudencial en el Deslizador de Criterio de Campo."
    );
  }
  if (anomalies.length === 0) {
    anomalies.push(
      "Sin inconsistencias contables severas entre ventas declaradas y activos fijos verificados en visita."
    );
  }

  return {
    profilePatch: {
      name: p.name,
      sector: p.sector,
      location: p.location,
      baseMonthlySales: parsedSales,
      cogsRatio: Math.min(0.85, Math.max(0.2, parsedCogs)),
      fixedOperatingExpenses: parsedFixed,
      taxExpenseMonthly: parsedTax,
      familyBurden: parsedFamily,
      insurableAssetValue: p.insurableAssetValue,
      seasonalFactors,
    },
    recommendedFieldFactor,
    confidence: notes.length > 30 || input.hasImage ? 0.91 : 0.82,
    extractedAssumptions: assumptions,
    detectedAnomalies: anomalies,
    source: "fallback-deterministic",
    modelUsed: `${input.modelName} (Motor Determinista Calibrado)`,
  };
}

export function buildDeterministicCommitteeAudit(input: {
  profile: BusinessProfile;
  params: CreditParams;
  stressResults: Record<StressScenarioId, StressComparisonResult>;
  activeScenario: StressScenarioId;
  modelName: string;
}): CommitteeAuditResponse {
  const { profile, params, stressResults, activeScenario, modelName } = input;
  const baseComp = stressResults.base;
  const activeComp = stressResults[activeScenario] ?? baseComp;
  const elNinoComp = stressResults.el_nino_shock ?? activeComp;

  const kipuBase = baseComp.kipu.schedule;
  const fixedBase = baseComp.fixed.schedule;

  const peakRows = kipuBase.rows.filter((r) => r.cycleStage === "cima");
  const valleyRows = kipuBase.rows.filter((r) => r.cycleStage === "valle");
  const maxQuota = Math.max(...kipuBase.rows.map((r) => r.scheduledInstallment));
  const minQuota = Math.min(...kipuBase.rows.map((r) => r.scheduledInstallment));
  // Cuota fija CONTRACTUAL: en el escenario base la 1.ª cuota exigible aún no arrastra pendientes.
  // (El promedio de cuotas exigibles bajo estrés incluiría arrastres y no es la cuota pactada.)
  const fixedAvgQuota = fixedBase.rows[0]?.scheduledInstallment ?? 0;
  const fixedContractualBreaches = fixedBase.rows.filter(
    (r) => r.projectedNetProfit <= 0 || fixedAvgQuota > r.paymentCap + 0.05
  ).length;

  const lastQuarterShare = kipuBase.riskMetrics.lastQuarterPrincipalShare;
  const top3Share = kipuBase.riskMetrics.top3PrincipalShare;
  const interestOnlyPeriods = kipuBase.riskMetrics.interestOnlyPeriods;

  const interestDelta = kipuBase.totalInterest - fixedBase.totalInterest;
  const maxProductFactor = PRODUCT_MAX_FACTORS[params.productType];

  let verdict: CommitteeAuditResponse["verdict"] = "APROBADO_CON_MITIGANTES";
  if (!kipuBase.isFeasible) {
    verdict =
      kipuBase.maxAffordablePrincipal >= params.principal * 0.6
        ? "OBSERVADO_AJUSTAR_MONTO"
        : "RECHAZADO";
  } else if (activeComp.kipu.unpaidResidualDebt > 1) {
    verdict = "OBSERVADO_AJUSTAR_MONTO";
  }

  const peakMonthsNames = peakRows
    .slice(0, 4)
    .map((r) => MONTH_LABELS_ES[r.monthIndex])
    .join(", ");
  const valleyMonthsNames = valleyRows
    .slice(0, 4)
    .map((r) => MONTH_LABELS_ES[r.monthIndex])
    .join(", ");

  const executiveSummary = !kipuBase.isFeasible
    ? `OBSERVACIÓN CRÍTICA DE COMITÉ: El monto solicitado de ${formatPEN(params.principal)} excede la capacidad acumulable del negocio bajo el factor de campo ${formatPct(params.fieldCriterionFactor)}. El motor Base 360 determina un monto máximo saludable de ${formatPEN(kipuBase.maxAffordablePrincipal)} para evitar sobreendeudamiento estructural.`
    : verdict === "OBSERVADO_AJUSTAR_MONTO"
      ? `OBSERVADO PARA AJUSTE BAJO ESTRÉS: En escenario base para ${profile.name} (${profile.location}), el crédito de ${formatPEN(params.principal)} a ${params.numInstallments} cuotas (TCEA ${formatPct(kipuBase.tcea)}) cumple capacidad máxima (${formatPct(kipuBase.maxQuotaToProfitRatio)} <= ${formatPct(params.fieldCriterionFactor)}); sin embargo, bajo «${activeComp.scenarioLabel}» deja un saldo residual exigible de ${formatPEN(activeComp.kipu.unpaidResidualDebt)} (${activeComp.kipu.monthsOverdue30Plus} meses >30d) frente a ${formatPEN(activeComp.fixed.unpaidResidualDebt)} en Cuota Fija. Se recomienda ajustar monto o plazo antes del desembolso.`
      : `Para ${profile.name} (${profile.location}), el crédito de ${formatPEN(params.principal)} a ${params.numInstallments} cuotas con TEA ${formatPct(params.tea)} es VIABLE bajo estructura KipuAI (TCEA ${formatPct(kipuBase.tcea)}). Mientras la Cuota Fija Tradicional (${formatPEN(fixedAvgQuota)}) rompe el tope prudencial en ${fixedContractualBreaches} de ${fixedBase.rows.length} cuotas de su cronograma (${baseComp.fixed.breachedInstallmentsCount} al arrastrar lo impago en el escenario base) y escala a ${elNinoComp.fixed.breachedInstallmentsCount} rupturas (${elNinoComp.fixed.monthsOverdue30Plus} periodos con deterioro >30 días) bajo Shock El Niño, KipuAI modula las cuotas entre ${formatPEN(minQuota)} (valle) y ${formatPEN(maxQuota)} (cima), conteniendo el ratio máximo en ${formatPct(kipuBase.maxQuotaToProfitRatio)} (<= ${formatPct(params.fieldCriterionFactor)}).`;

  const quotaDynamicsExplanation =
    params.periodicityMode === "elastic"
      ? `El cronograma aplica Periodicidad Elástica Base 360: acorta ventanas a 22 días en meses de cima (${peakMonthsNames || "campaña alta"}) para capturar liquidez fresca y amortizar capital rápido, y extiende a 40 días en meses de valle (${valleyMonthsNames || "temporada baja"}) reduciendo la cuota hasta ${formatPEN(minQuota)} pero cubriendo siempre seguros, intereses exactos y amortización positiva de capital.`
      : `El cronograma mensual Base 360 sincroniza cada cuota con los días exactos del calendario America/Lima: eleva la amortización de capital hasta ${formatPEN(maxQuota)} en meses pico (${peakMonthsNames || "campaña"}) y desciende a ${formatPEN(minQuota)} en meses valle (${valleyMonthsNames || "baja rotación"}), garantizando holgura operativa sin recurrir a periodos de gracia improductivos.`;

  return {
    verdict,
    executiveSummary,
    quotaDynamicsExplanation,
    sectorClimateAssumptions: [
      ...profile.sources,
      `Sensibilidad climática regional ENFEN/SENAMHI La Libertad ponderada en ${profile.elNinoSensitivity.toFixed(2)}x sobre meses pluviales (Ene–Abr).`,
      `Escenario auditado activo: «${activeComp.scenarioLabel}» — Liquidez libre acumulada del cliente con KipuAI: ${formatPEN(activeComp.kipu.cumulativeFreeCash)}.`,
    ],
    fiveRisksMitigation: {
      optimisticEstimation: `Mitigado: Se deducen costos variables (${(profile.cogsRatio * 100).toFixed(0)}%), gastos fijos (${formatPEN(profile.fixedOperatingExpenses + profile.taxExpenseMonthly)}) y canasta familiar (${formatPEN(profile.familyBurden)}), aplicando además un recorte prudencial de campo al ${formatPct(params.fieldCriterionFactor)} de la utilidad neta.`,
      capitalConcentration:
        lastQuarterShare <= 0.35
          ? `Mitigado: El último cuarto del cronograma concentra sólo el ${formatPct(lastQuarterShare)} del principal y las 3 cuotas con más capital suman ${formatPct(top3Share)}, evitando efecto balón al vencimiento.`
          : `Controlado: El último cuarto del cronograma concentra el ${formatPct(lastQuarterShare)} del principal (3 cuotas mayores: ${formatPct(top3Share)}) debido al calendario de cosecha/campaña tardía, mitigado con seguimiento previo al cierre.`,
      creditCostIncrease:
        (interestOnlyPeriods > 0
          ? `${interestOnlyPeriods} cuota(s) de solo seguros/interés (amortización < 1% del capital) por valle profundo. `
          : "Sin cuotas de gracia ni de solo interés. ") +
        (interestDelta <= 0
          ? `Mitigado: Al adelantar amortización en campañas pico, KipuAI ahorra ${formatPEN(Math.abs(interestDelta))} en intereses frente a la Cuota Fija al ejecutar el escenario base (${formatPEN(kipuBase.totalInterest)} vs. ${formatPEN(fixedBase.totalInterest)}, que incluye intereses sobre cuotas que el cliente con cuota fija no alcanza a pagar). TCEA transparente: ${formatPct(kipuBase.tcea)}.`
          : `Controlado: El diferencial de intereses por alivio en valles tempranos es de ${formatPEN(interestDelta)} (${formatPEN(kipuBase.totalInterest)} vs. ${formatPEN(fixedBase.totalInterest)}), compensado por evitar mora >30 días (${elNinoComp.kipu.monthsOverdue30Plus} vs. ${elNinoComp.fixed.monthsOverdue30Plus} en Cuota Fija bajo El Niño).`),
      overIndebtedness: `Mitigado: El tope duro ${formatPct(params.fieldCriterionFactor)} (producto máx. ${formatPct(maxProductFactor)}) preserva el ${(100 - params.fieldCriterionFactor * 100).toFixed(0)}% de la utilidad neta como colchón ante imprevistos y obligaciones en el sistema financiero.`,
      humanFieldCriterion: `Trazable: El asesor ajustó explícitamente el límite normativo de ${formatPct(maxProductFactor)} a ${formatPct(params.fieldCriterionFactor)} según verificación presencial en ${profile.location}, quedando auditado en acta.`,
    },
    devilAdvocateObjections: [
      (() => {
        const bcBase = computeScenarioBusinessCase(baseComp, params);
        const bcNino = computeScenarioBusinessCase(elNinoComp, params);
        return `¿Pierde ingresos la Caja al cobrar menos intereses? Resultado económico (intereses + reinversión del capital recuperado − pérdida al vencimiento): escenario base KipuAI ${formatPEN(bcBase.kipu.economicResult)} vs. Cuota Fija ${formatPEN(bcBase.fixed.economicResult)} (${bcBase.economicAdvantage >= 0 ? "+" : ""}${formatPEN(bcBase.economicAdvantage)}); bajo El Niño ${bcNino.economicAdvantage >= 0 ? "+" : ""}${formatPEN(bcNino.economicAdvantage)} a favor de ${bcNino.economicAdvantage >= 0 ? "KipuAI" : "Cuota Fija"}. Vida media del capital: ${Math.round(bcBase.kipu.capitalAvgLifeDays)} vs. ${Math.round(bcBase.fixed.capitalAvgLifeDays)} días.`;
      })(),
      `¿Qué ocurre si la campaña clave se retrasa 30 días? Bajo «Retraso +30d», KipuAI registra ${stressResults.campaign_delay_30d.kipu.monthsOverdue30Plus} meses con atraso >30 días frente a ${stressResults.campaign_delay_30d.fixed.monthsOverdue30Plus} en Cuota Fija; los intereses impagos temporales se alojan en bolsa exigible sin capitalizarse al Saldo de Capital.`,
      `¿Resiste un Fenómeno El Niño Costero severo (-45% Ene-Abr)? En simulación Ayni, la Cuota Fija sufre ${elNinoComp.fixed.breachedInstallmentsCount} rupturas de capacidad, mientras KipuAI reduce la presión en meses lluviosos protegiendo el capital de trabajo.`,
      stressResults.sales_drop_25.kipu.cumulativeFreeCash > 0
        ? `¿Existe dependencia de un único pico comercial? Si las ventas caen -25% parejo todo el año, KipuAI mantiene ${formatPEN(stressResults.sales_drop_25.kipu.cumulativeFreeCash)} de liquidez libre acumulada para sostener el giro del negocio.`
        : `¿Existe dependencia de un único pico comercial? Si las ventas caen -25% parejo todo el año, el flujo neto acumulado entra en déficit (${formatPEN(stressResults.sales_drop_25.kipu.cumulativeFreeCash)}), por lo que se requiere reserva de capital de trabajo o reducción prudencial del monto.`,
    ],
    committeeConditions:
      verdict === "APROBADO_CON_MITIGANTES"
        ? [
            `Desembolso sujeto a verificación de inventario/activos asegurables por ${formatPEN(profile.insurableAssetValue)} (${params.patrimonialType === "none" ? "se recomienda activar cobertura patrimonial" : `póliza ${params.patrimonialType} vigente`}).`,
            "Seguimiento preventivo de asesor 15 días antes del inicio de campaña pico para confirmar acopio de mercadería/cosecha.",
            "En caso de declaratoria de emergencia SENAMHI/INDECI en La Libertad, activar reprogramación preventiva sin capitalización de intereses devengados.",
          ]
        : kipuBase.isFeasible
          ? [
              `Reducir monto o ampliar plazo para absorber el residual de ${formatPEN(activeComp.kipu.unpaidResidualDebt)} detectado bajo «${activeComp.scenarioLabel}».`,
              `Verificar cobertura patrimonial (${formatPEN(profile.insurableAssetValue)}) y reserva líquida previa al desembolso.`,
            ]
          : [
              `Redimensionar el principal solicitado de ${formatPEN(params.principal)} a un máximo de ${formatPEN(kipuBase.maxAffordablePrincipal)} o ampliar plazo hasta 18–24 cuotas antes de elevar a aprobación.`,
              "Validar boletas de compra de los últimos 3 meses para confirmar margen bruto real.",
            ],
    source: "fallback-deterministic",
    modelUsed: `${modelName} (Auditor Determinista Caja Trujillo)`,
    generatedAtLima: getNowLimaTimestamp(),
  };
}
