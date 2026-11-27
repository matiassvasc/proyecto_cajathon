"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CloudLightning,
  Clock,
  FileCheck2,
  Gavel,
  Loader2,
  Presentation,
  Printer,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  X,
} from "lucide-react";
import { BusinessCaseMonteCarlo } from "@/components/BusinessCaseMonteCarlo";
import { buildDeterministicCommitteeAudit } from "@/lib/deterministic-ai";
import { STRESS_SCENARIO_META } from "@/lib/financial-engine";
import { formatPEN, formatPct } from "@/lib/formatters";
import type {
  BusinessProfile,
  CommitteeAuditResponse,
  CreditParams,
  StressComparisonResult,
  StressEvaluation,
  StressScenarioId,
} from "@/lib/types";

interface AyniStressCommitteeProps {
  profile: BusinessProfile;
  params: CreditParams;
  stressResults: Record<StressScenarioId, StressComparisonResult>;
}

const SCENARIO_BUTTONS: Array<{
  id: StressScenarioId;
  badge: string;
  Icon: typeof ShieldCheck;
}> = [
  {
    id: "base",
    badge: "Base 100%",
    Icon: ShieldCheck,
  },
  {
    id: "sales_drop_25",
    badge: "Shock Comercial",
    Icon: TrendingDown,
  },
  {
    id: "campaign_delay_30d",
    badge: "Desfase +30d",
    Icon: Clock,
  },
  {
    id: "el_nino_shock",
    badge: "SENAMHI La Libertad",
    Icon: CloudLightning,
  },
];

function SurvivalBadge({ status }: { status: StressEvaluation["survivalStatus"] }) {
  if (status === "resiliente") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-900">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        Supervivencia Resiliente
      </span>
    );
  }
  if (status === "alerta") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-amber-100 px-3 py-1 text-xs font-bold text-amber-950">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
        Tensión Moderada (Sin Mora &gt;30d)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/60 bg-rose-100 px-3 py-1 text-xs font-bold text-rose-950">
      <AlertOctagon className="h-3.5 w-3.5 text-rose-700" aria-hidden="true" />
      Deterioro Crediticio (&gt;30 días)
    </span>
  );
}

export function AyniStressCommittee({
  profile,
  params,
  stressResults,
}: AyniStressCommitteeProps) {
  const [activeScenario, setActiveScenario] = useState<StressScenarioId>("el_nino_shock");
  const [auditing, setAuditing] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditReport, setAuditReport] = useState<CommitteeAuditResponse>(() =>
    buildDeterministicCommitteeAudit({
      profile,
      params,
      stressResults,
      activeScenario: "el_nino_shock",
      modelName: "gemini-4-hydrogen",
    })
  );

  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    setAuditReport(
      buildDeterministicCommitteeAudit({
        profile,
        params,
        stressResults,
        activeScenario,
        modelName: "gemini-4-hydrogen",
      })
    );
  }, [profile, params, stressResults, activeScenario]);

  const currentComparison = stressResults[activeScenario];
  const kipuEval = currentComparison.kipu;
  const fixedEval = currentComparison.fixed;
  const totalInstallments = kipuEval.schedule.rows.length;

  const handleRunLiveAudit = async () => {
    setAuditing(true);
    setAuditError(null);
    try {
      const res = await fetch("/api/audit-committee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          params,
          stressResults,
          activeScenario,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as CommitteeAuditResponse;
      if (!data?.executiveSummary) {
        throw new Error("Respuesta incompleta de auditoría.");
      }
      setAuditReport(data);
    } catch {
      setAuditError(
        "No se pudo actualizar el dictamen en línea; se mantiene vigente el dictamen determinista."
      );
    } finally {
      setAuditing(false);
    }
  };

  const openPresentationModal = () => {
    const dlg = dialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
  };

  const verdictStyle =
    auditReport.verdict === "APROBADO_CON_MITIGANTES"
      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
      : auditReport.verdict === "OBSERVADO_AJUSTAR_MONTO"
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-rose-300 bg-rose-50 text-rose-950";

  const verdictLabel =
    auditReport.verdict === "APROBADO_CON_MITIGANTES"
      ? "APROBADO CON MITIGANTES ESTACIONALES"
      : auditReport.verdict === "OBSERVADO_AJUSTAR_MONTO"
        ? "OBSERVADO — REDIMENSIONAR MONTO / PLAZO"
        : "RECHAZADO POR RIESGO DE SOBREENDEUDAMIENTO";

  return (
    <div className="space-y-6">
      {/* 1. Panel Hero Ejecutivo (Proporción 16:10 ideal para capturas de presentación): Escenarios + Scorecard */}
      <section
        aria-labelledby="ayni-scorecard-heading"
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5"
      >
        <div className="mb-3 flex flex-col gap-2.5 border-b border-slate-100 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Módulo C · Ayni — Simulador «Abogado del Diablo» & Comité Caja Trujillo
            </span>
            <h1
              id="ayni-scorecard-heading"
              className="text-lg font-extrabold tracking-tight text-slate-900 lg:text-xl"
            >
              Scorecard Comparativo de Supervivencia Crediticia
            </h1>
            <p className="text-xs text-slate-500">
              {profile.name} ({profile.location}) · Prelación estricta Base 360 sin capitalización de
              intereses ni seguros impagos
            </p>
          </div>

          <button
            type="button"
            onClick={openPresentationModal}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 whitespace-nowrap cursor-pointer"
          >
            <Presentation className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            Modo Presentación / Exportar Resumen
          </button>
        </div>

        {/* Botonera de 1 clic para los 4 Escenarios Adversos */}
        <div
          role="group"
          aria-label="Seleccionar escenario de estrés"
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
        >
          {SCENARIO_BUTTONS.map(({ id, badge, Icon }) => {
            const meta = STRESS_SCENARIO_META[id];
            const selected = activeScenario === id;
            const isNino = id === "el_nino_shock";
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveScenario(id)}
                aria-pressed={selected}
                className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition cursor-pointer ${
                  selected
                    ? isNino
                      ? "border-rose-600 bg-rose-50/70 ring-2 ring-rose-600/20 shadow-xs"
                      : "border-slate-900 bg-slate-900 text-white shadow-xs"
                    : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                      selected
                        ? isNino
                          ? "bg-rose-600 text-white"
                          : "bg-emerald-400 text-slate-950"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {badge}
                  </span>
                  <Icon
                    className={`h-4 w-4 ${
                      selected
                        ? isNino
                          ? "text-rose-600"
                          : "text-emerald-300"
                        : "text-slate-500"
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <span
                  className={`text-xs font-extrabold ${
                    selected && !isNino ? "text-white" : "text-slate-900"
                  }`}
                >
                  {meta.shortLabel}
                </span>
                <span
                  className={`mt-0.5 line-clamp-2 text-[11px] ${
                    selected && !isNino ? "text-slate-300" : "text-slate-600"
                  }`}
                >
                  {meta.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Scorecard Lado a Lado: KipuAI vs Cuota Fija Tradicional */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Tarjeta Izquierda: Cronograma Adaptado KipuAI */}
          <div className="rounded-2xl border-2 border-emerald-500/60 bg-gradient-to-b from-emerald-50/70 to-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/80 pb-3">
              <div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                  Propuesta Adaptada al Ciclo
                </span>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Plan KipuAI ({params.periodicityMode === "elastic" ? "Elástico" : "Mensual"})
                </h2>
              </div>
              <SurvivalBadge status={kipuEval.survivalStatus} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-white p-3">
                <span className="block text-[11px] font-medium text-slate-500">
                  Cuotas que rompen capacidad
                </span>
                <span className="mt-1 block font-mono text-2xl font-extrabold text-emerald-700 tabular-nums">
                  {kipuEval.breachedInstallmentsCount}{" "}
                  <span className="text-xs font-semibold text-slate-400">
                    / {totalInstallments}
                  </span>
                </span>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-white p-3">
                <span className="block text-[11px] font-medium text-slate-500">
                  Meses en atraso (&gt;30 días)
                </span>
                <span
                  className={`mt-1 block font-mono text-2xl font-extrabold tabular-nums ${
                    kipuEval.monthsOverdue30Plus === 0 ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {kipuEval.monthsOverdue30Plus}{" "}
                  <span className="text-xs font-semibold text-slate-400">meses</span>
                </span>
              </div>

              <div className="col-span-2 rounded-xl border border-emerald-200 bg-white p-3 sm:col-span-1">
                <span className="block text-[11px] font-medium text-slate-500">
                  TCEA Resultante
                </span>
                <span className="mt-1 block font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
                  {formatPct(kipuEval.tcea)}
                </span>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-white p-3">
                <span className="block text-[11px] font-medium text-slate-500">
                  Liquidez libre acumulada
                </span>
                <span className="mt-1 block font-mono text-base font-extrabold text-emerald-800 tabular-nums">
                  {formatPEN(kipuEval.cumulativeFreeCash)}
                </span>
              </div>

              <div className="col-span-1 rounded-xl border border-emerald-200 bg-white p-3 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    Interés Total Base 360
                  </span>
                  <span className="font-mono text-[11px] text-emerald-800">
                    Residual impago: {formatPEN(kipuEval.unpaidResidualDebt)}
                  </span>
                </div>
                <span className="mt-1 block font-mono text-base font-extrabold text-slate-900 tabular-nums">
                  {formatPEN(kipuEval.totalInterestAccrued)}
                </span>
              </div>
            </div>
          </div>

          {/* Tarjeta Derecha: Cronograma de Cuota Fija Tradicional */}
          <div className="rounded-2xl border-2 border-rose-300 bg-gradient-to-b from-rose-50/60 to-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-rose-200/80 pb-3">
              <div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-rose-800">
                  Esquema Rígido Convencional
                </span>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Cuota Fija Tradicional (Base 360)
                </h2>
              </div>
              <SurvivalBadge status={fixedEval.survivalStatus} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-rose-200 bg-white p-3">
                <span className="block text-[11px] font-medium text-slate-500">
                  Cuotas que rompen capacidad
                </span>
                <span
                  className={`mt-1 block font-mono text-2xl font-extrabold tabular-nums ${
                    fixedEval.breachedInstallmentsCount > 0 ? "text-rose-600" : "text-slate-900"
                  }`}
                >
                  {fixedEval.breachedInstallmentsCount}{" "}
                  <span className="text-xs font-semibold text-slate-400">
                    / {fixedEval.schedule.rows.length}
                  </span>
                </span>
              </div>

              <div className="rounded-xl border border-rose-200 bg-white p-3">
                <span className="block text-[11px] font-medium text-slate-500">
                  Meses en atraso (&gt;30 días)
                </span>
                <span
                  className={`mt-1 block font-mono text-2xl font-extrabold tabular-nums ${
                    fixedEval.monthsOverdue30Plus > 0 ? "text-rose-600" : "text-slate-900"
                  }`}
                >
                  {fixedEval.monthsOverdue30Plus}{" "}
                  <span className="text-xs font-semibold text-slate-400">meses</span>
                </span>
              </div>

              <div className="col-span-2 rounded-xl border border-rose-200 bg-white p-3 sm:col-span-1">
                <span className="block text-[11px] font-medium text-slate-500">
                  TCEA Resultante
                </span>
                <span className="mt-1 block font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
                  {formatPct(fixedEval.tcea)}
                </span>
              </div>

              <div className="rounded-xl border border-rose-200 bg-white p-3">
                <span className="block text-[11px] font-medium text-slate-500">
                  Liquidez libre acumulada
                </span>
                <span className="mt-1 block font-mono text-base font-extrabold text-slate-800 tabular-nums">
                  {formatPEN(fixedEval.cumulativeFreeCash)}
                </span>
              </div>

              <div className="col-span-1 rounded-xl border border-rose-200 bg-white p-3 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-500">
                    Interés Total Base 360
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-rose-700">
                    Residual impago: {formatPEN(fixedEval.unpaidResidualDebt)}
                  </span>
                </div>
                <span className="mt-1 block font-mono text-base font-extrabold text-slate-900 tabular-nums">
                  {formatPEN(fixedEval.totalInterestAccrued)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Nota técnica de trazabilidad de prelación sin anatocismo */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
          <span>
            <strong>Regla de No-Capitalización Caja Trujillo verificada:</strong> Ante déficit de
            caja en estrés, los seguros e intereses impagos quedan registrados como deuda exigible
            pendiente y se cobran primero en la cuota siguiente sin sumarse jamás al Saldo de Capital.
          </span>
          <span className="font-mono text-[11px] font-bold text-emerald-800">
            Reducción de rupturas: -{Math.max(0, fixedEval.breachedInstallmentsCount - kipuEval.breachedInstallmentsCount)} cuotas
          </span>
        </div>
      </section>

      {/* 1b. Caso de negocio para la Caja + Monte Carlo del ciclo */}
      <BusinessCaseMonteCarlo profile={profile} params={params} stressResults={stressResults} />

      {/* 2. Dictamen Explicable para Comité de Crédito ("Abogado del Diablo") */}
      <section
        aria-labelledby="committee-audit-heading"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6"
      >
        <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Gavel className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <h2 id="committee-audit-heading" className="text-lg font-extrabold text-slate-900">
                Dictamen Explicable para Comité («Abogado del Diablo»)
              </h2>
              <p className="text-xs text-slate-500">
                Emitido en America/Lima: <time suppressHydrationWarning>{auditReport.generatedAtLima}</time> · Origen:{" "}
                <span className="font-mono font-semibold text-slate-700">
                  {auditReport.source === "gemini-live"
                    ? `Gemini Live (${auditReport.modelUsed})`
                    : auditReport.modelUsed}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRunLiveAudit}
            disabled={auditing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow-2xs transition hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            {auditing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Auditando con IA...
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                Auditar con IA (/api/audit-committee)
              </>
            )}
          </button>
        </div>

        {/* Veredicto + Resumen Ejecutivo */}
        {auditError && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900"
          >
            {auditError}
          </div>
        )}
        <div className={`mb-5 rounded-xl border p-4 ${verdictStyle}`}>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-extrabold uppercase">
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
              Dictamen Propuesto: {verdictLabel}
            </span>
            <span className="font-mono text-[11px] font-semibold">
              Escenario foco: {currentComparison.scenarioLabel}
            </span>
          </div>
          <p className="text-xs leading-relaxed font-medium">{auditReport.executiveSummary}</p>
          <p className="mt-2 border-t border-current/15 pt-2 text-xs leading-relaxed">
            <strong>Justificación matemática de cuotas:</strong>{" "}
            {auditReport.quotaDynamicsExplanation}
          </p>
        </div>

        {/* Matriz de Mitigación de los 5 Riesgos Regulatorios */}
        <div className="mb-5">
          <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">
            Auditoría de Mitigación de los 5 Riesgos Críticos (Desafío NEG-01)
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              {
                num: "R1",
                title: "Estimación Optimista",
                body: auditReport.fiveRisksMitigation.optimisticEstimation,
              },
              {
                num: "R2",
                title: "Concentración Final",
                body: auditReport.fiveRisksMitigation.capitalConcentration,
              },
              {
                num: "R3",
                title: "Encarecimiento TCEA",
                body: auditReport.fiveRisksMitigation.creditCostIncrease,
              },
              {
                num: "R4",
                title: "Sobreendeudamiento",
                body: auditReport.fiveRisksMitigation.overIndebtedness,
              },
              {
                num: "R5",
                title: "Criterio de Campo",
                body: auditReport.fiveRisksMitigation.humanFieldCriterion,
              },
            ].map((risk) => (
              <div
                key={risk.num}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                    {risk.num}
                  </span>
                  <strong className="text-slate-900">{risk.title}</strong>
                </div>
                <p className="leading-relaxed text-[11px] text-slate-700">{risk.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Objeciones Abogado del Diablo + Supuestos Sectoriales/Climáticos */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-amber-950">
              Interrogatorio del «Abogado del Diablo»
            </h3>
            <ul className="space-y-2 text-xs text-slate-800">
              {auditReport.devilAdvocateObjections.map((obj, idx) => (
                <li key={idx} className="leading-relaxed">
                  • {obj}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-700">
              Supuestos Sectoriales / Climáticos & Condiciones de Comité
            </h3>
            <ul className="mb-3 space-y-1 text-[11px] text-slate-600">
              {auditReport.sectorClimateAssumptions.map((src, idx) => (
                <li key={idx}>• {src}</li>
              ))}
            </ul>
            <div className="border-t border-slate-200 pt-2.5">
              <span className="block text-[11px] font-bold text-slate-900">
                Condiciones sugeridas para desembolso:
              </span>
              <ul className="mt-1 space-y-1 text-[11px] text-emerald-950">
                {auditReport.committeeConditions.map((cond, idx) => (
                  <li key={idx}>✓ {cond}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Modal Nativo <dialog> para Modo Presentación / Exportar Resumen (modern-web-guidance: dialog) */}
      <dialog
        ref={dialogRef}
        aria-labelledby="acta-modal-title"
        {...({ closedby: "any" } as Record<string, string>)}
        className="m-auto w-full max-w-4xl rounded-2xl border border-slate-300 bg-white p-0 text-slate-900 shadow-2xl"
      >
        <div className="kipu-printable-acta p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between border-b-2 border-slate-900 pb-4">
            <div>
              <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                CAJA TRUJILLO · COMITÉ DE CRÉDITO MICROEMPRESA · KIPUAI (NEG-01)
              </span>
              <h2 id="acta-modal-title" className="mt-1 text-2xl font-extrabold text-slate-950">
                Acta Ejecutiva de Evaluación y Estrés Climático
              </h2>
              <p className="text-xs text-slate-600">
                Titular / Unidad: <strong>{profile.name}</strong> ({profile.ownerName}) ·{" "}
                {profile.location} · Fecha Lima: <time suppressHydrationWarning>{auditReport.generatedAtLima}</time>
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white whitespace-nowrap hover:bg-emerald-700 cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Imprimir / Guardar PDF
              </button>
              <form method="dialog">
                <button
                  type="submit"
                  aria-label="Cerrar modo presentación"
                  autoFocus
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>

          {/* Resumen numérico compacto de Acta */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs tabular-nums">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="block font-sans text-[10px] uppercase text-slate-500">
                Principal & Plazo
              </span>
              <strong className="text-sm text-slate-950">
                {formatPEN(params.principal)} ({params.numInstallments}c)
              </strong>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="block font-sans text-[10px] uppercase text-slate-500">
                TEA / TCEA KipuAI
              </span>
              <strong className="text-sm text-emerald-700">
                {formatPct(params.tea)} / {formatPct(stressResults.base.kipu.tcea)}
              </strong>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="block font-sans text-[10px] uppercase text-slate-500">
                Criterio de Campo
              </span>
              <strong className="text-sm text-slate-950">
                Tope {formatPct(params.fieldCriterionFactor, 0)} (
                {params.periodicityMode === "elastic" ? "Elástico" : "Mensual"})
              </strong>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="block font-sans text-[10px] uppercase text-slate-500">
                Shock El Niño (&gt;30d mora)
              </span>
              <strong className="text-sm text-emerald-800">
                Kipu {stressResults.el_nino_shock.kipu.monthsOverdue30Plus}m vs. Fija{" "}
                {stressResults.el_nino_shock.fixed.monthsOverdue30Plus}m
              </strong>
            </div>
          </div>

          <div className={`mb-4 rounded-xl border p-4 ${verdictStyle}`}>
            <p className="font-mono text-xs font-extrabold uppercase">{verdictLabel}</p>
            <p className="mt-1 text-xs leading-relaxed">{auditReport.executiveSummary}</p>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-slate-200 p-3.5">
              <h2 className="mb-1.5 font-bold text-slate-900">
                Mitigación de Riesgos Regulatorios
              </h2>
              <ul className="space-y-1.5 text-[11px] text-slate-700">
                <li>
                  <strong>1. Flujo prudente:</strong>{" "}
                  {auditReport.fiveRisksMitigation.optimisticEstimation}
                </li>
                <li>
                  <strong>2. Anti-balón:</strong>{" "}
                  {auditReport.fiveRisksMitigation.capitalConcentration}
                </li>
                <li>
                  <strong>3. Costo efectivo:</strong>{" "}
                  {auditReport.fiveRisksMitigation.creditCostIncrease}
                </li>
                <li>
                  <strong>4. Endeudamiento:</strong>{" "}
                  {auditReport.fiveRisksMitigation.overIndebtedness}
                </li>
                <li>
                  <strong>5. Criterio humano:</strong>{" "}
                  {auditReport.fiveRisksMitigation.humanFieldCriterion}
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-slate-200 p-3.5">
              <h2 className="mb-1.5 font-bold text-slate-900">
                Condiciones y Supuestos Auditados
              </h2>
              <ul className="space-y-1.5 text-[11px] text-slate-700">
                {auditReport.committeeConditions.map((c, idx) => (
                  <li key={idx}>✓ {c}</li>
                ))}
              </ul>
              <div className="mt-3 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
                Fuentes empleadas: {profile.sources.join(" · ")}
              </div>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
