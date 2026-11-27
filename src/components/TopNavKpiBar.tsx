"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Landmark,
  SlidersHorizontal,
} from "lucide-react";
import { formatPEN, formatPct } from "@/lib/formatters";
import type { CreditParams, ScheduleResult } from "@/lib/types";

export type ActiveModuleId = "chasqui" | "kipu" | "ayni";

interface TopNavKpiBarProps {
  activeModule: ActiveModuleId;
  onSelectModule: (mod: ActiveModuleId) => void;
  businessName: string;
  params: CreditParams;
  kipuSchedule: ScheduleResult;
  fixedSchedule: ScheduleResult;
}

const MODULE_STEPS: Array<{
  id: ActiveModuleId;
  stepNum: string;
  title: string;
  tag: string;
  Icon: typeof Compass;
}> = [
  {
    id: "chasqui",
    stepNum: "1",
    title: "Perfil & Campo",
    tag: "Chasqui",
    Icon: Compass,
  },
  {
    id: "kipu",
    stepNum: "2",
    title: "Ciclo & Cronograma",
    tag: "Kipu",
    Icon: SlidersHorizontal,
  },
  {
    id: "ayni",
    stepNum: "3",
    title: "Estrés & Comité",
    tag: "Ayni",
    Icon: ClipboardCheck,
  },
];

export function TopNavKpiBar({
  activeModule,
  onSelectModule,
  businessName,
  params,
  kipuSchedule,
  fixedSchedule,
}: TopNavKpiBarProps) {
  const maxRatio = kipuSchedule.maxQuotaToProfitRatio;
  const ratioHealthy =
    kipuSchedule.isFeasible &&
    Number.isFinite(maxRatio) &&
    maxRatio <= params.fieldCriterionFactor + 0.003;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950 text-white shadow-lg no-print">
      {/* Fila superior: Identidad institucional + Stepper de 3 módulos */}
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 px-4 py-2 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 shadow-inner">
            <Landmark className="h-4 w-4 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-white">KipuAI</span>
              <span className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 whitespace-nowrap">
                CAJATHON 2026 · NEG-01
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-400">
              Caja Trujillo · <span className="text-slate-200">{businessName}</span>
            </p>
          </div>
        </div>

        <nav aria-label="Módulos de evaluación crediticia" className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          {MODULE_STEPS.map(({ id, stepNum, title, tag, Icon }) => {
            const isActive = activeModule === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectModule(id)}
                aria-current={isActive ? "step" : undefined}
                className={`group flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? "border-emerald-400/70 bg-emerald-500/20 text-white shadow-sm"
                    : "border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800/80 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md font-mono text-[11px] font-bold ${
                    isActive
                      ? "bg-emerald-400 text-slate-950"
                      : "bg-slate-800 text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  {stepNum}
                </span>
                <div className="leading-tight">
                  <span className="block text-xs font-bold">{title}</span>
                  <span
                    className={`font-mono text-[9px] uppercase tracking-wider ${
                      isActive ? "text-emerald-300" : "text-slate-400"
                    }`}
                  >
                    [{tag}]
                  </span>
                </div>
                <Icon
                  className={`h-3.5 w-3.5 ${isActive ? "text-emerald-300" : "text-slate-500"}`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </nav>
      </div>

      {/* Cinta global de KPIs siempre visible */}
      <div className="border-t border-slate-800/90 bg-slate-900/95">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 py-1.5 md:grid-cols-4 lg:px-6">
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
            <div>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
                Monto & Plazo
              </span>
              <span className="font-mono text-sm font-bold text-white tabular-nums">
                {formatPEN(params.principal)}
              </span>
            </div>
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
              {params.numInstallments}c ·{" "}
              {params.periodicityMode === "elastic" ? "Elástica" : "Mensual"}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
            <div>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
                TEA Base 360
              </span>
              <span className="font-mono text-sm font-bold text-sky-300 tabular-nums">
                {formatPct(params.tea)}
              </span>
            </div>
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
              Tope BCRP &le;75%
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
            <div>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
                TCEA KipuAI vs. Fija
              </span>
              <div className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
                <span className="font-bold text-emerald-400">{formatPct(kipuSchedule.tcea)}</span>
                <span className="text-xs text-slate-500">vs.</span>
                <span className="font-semibold text-amber-300">{formatPct(fixedSchedule.tcea)}</span>
              </div>
            </div>
            <Activity className="h-4 w-4 text-slate-500" aria-hidden="true" />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5">
            <div>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
                Ratio Máx. Cuota / Utilidad
              </span>
              <div className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
                <span className={`font-bold ${ratioHealthy ? "text-emerald-400" : "text-rose-400"}`}>
                  {Number.isFinite(maxRatio) ? formatPct(maxRatio, 1) : "Déficit"}
                </span>
                <span className="text-xs text-slate-400">
                  / tope {formatPct(params.fieldCriterionFactor, 0)}
                </span>
              </div>
            </div>
            {ratioHealthy ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
