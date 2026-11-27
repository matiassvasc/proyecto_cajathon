"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Minus,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateLima, formatPEN, formatPct, MONTH_LABELS_ES } from "@/lib/formatters";
import type { CreditParams, CycleStage, PeriodicityMode, ScheduleResult } from "@/lib/types";

interface KipuScheduleViewProps {
  businessName: string;
  params: CreditParams;
  onChangeParams: (next: CreditParams) => void;
  kipuSchedule: ScheduleResult;
  fixedSchedule: ScheduleResult;
  onNextModule: () => void;
}

interface ChartDatum {
  label: string;
  cuotaNum: number;
  dueDateFormatted: string;
  days: number;
  stage: CycleStage;
  utilidadNeta: number;
  topeCapacidad: number;
  cuotaKipu: number;
  cuotaFija: number | null;
  ratioKipu: number;
}

function CycleBadge({ stage }: { stage: CycleStage }) {
  if (stage === "cima") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        Cima
      </span>
    );
  }
  if (stage === "valle") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
        <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
        Valle
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
      <Minus className="h-3 w-3" aria-hidden="true" />
      Normal
    </span>
  );
}

export function KipuScheduleView({
  businessName,
  params,
  onChangeParams,
  kipuSchedule,
  fixedSchedule,
  onNextModule,
}: KipuScheduleViewProps) {
  const [tableView, setTableView] = useState<"kipu" | "fixed">("kipu");

  const activeSchedule = tableView === "kipu" ? kipuSchedule : fixedSchedule;

  const chartData: ChartDatum[] = kipuSchedule.rows.map((row, idx) => {
    const fixedRow = fixedSchedule.rows[idx];
    return {
      label: `C${row.number} (${MONTH_LABELS_ES[row.monthIndex]})`,
      cuotaNum: row.number,
      dueDateFormatted: formatDateLima(row.dueDate),
      days: row.days,
      stage: row.cycleStage,
      utilidadNeta: row.projectedNetProfit,
      topeCapacidad: row.paymentCap,
      cuotaKipu: row.scheduledInstallment,
      cuotaFija: fixedRow ? fixedRow.scheduledInstallment : null,
      ratioKipu: row.quotaToProfitRatio,
    };
  });

  const minKipuQuota =
    kipuSchedule.rows.length > 0
      ? Math.min(...kipuSchedule.rows.map((r) => r.scheduledInstallment))
      : 0;
  const maxKipuQuota =
    kipuSchedule.rows.length > 0
      ? Math.max(...kipuSchedule.rows.map((r) => r.scheduledInstallment))
      : 0;
  const avgFixedQuota =
    fixedSchedule.rows.reduce((acc, r) => acc + r.scheduledInstallment, 0) /
    Math.max(1, fixedSchedule.rows.length);
  const fixedBreachesCount = fixedSchedule.rows.filter((r) => r.capacityBreached).length;
  const kipuBreachesCount = kipuSchedule.rows.filter((r) => r.capacityBreached).length;

  const handlePeriodicityChange = (mode: PeriodicityMode) => {
    onChangeParams({ ...params, periodicityMode: mode });
  };

  return (
    <div className="space-y-6">
      {/* Alerta inteligente cuando el monto solicitado supera la capacidad máxima viable */}
      {!kipuSchedule.isFeasible && (
        <div
          role="alert"
          className="flex flex-col justify-between gap-4 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-extrabold text-rose-950">
                Monto solicitado excede la capacidad acumulable bajo el factor{" "}
                {formatPct(params.fieldCriterionFactor, 0)}
              </h2>
              <p className="mt-0.5 text-xs text-rose-900">
                Para cumplir estrictamente{" "}
                <code className="font-mono font-semibold">
                  Cuota_t / UtilidadNeta_t &le; {params.fieldCriterionFactor.toFixed(2)}
                </code>{" "}
                en todas las etapas sin sobreendeudar al cliente, el capital máximo viable a{" "}
                {params.numInstallments} cuotas es{" "}
                <strong className="font-mono">{formatPEN(kipuSchedule.maxAffordablePrincipal)}</strong>.
              </p>
            </div>
          </div>

          {kipuSchedule.maxAffordablePrincipal >= 1000 && (
            <button
              type="button"
              onClick={() =>
                onChangeParams({
                  ...params,
                  principal: kipuSchedule.maxAffordablePrincipal,
                })
              }
              className="shrink-0 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 cursor-pointer"
            >
              Ajustar a {formatPEN(kipuSchedule.maxAffordablePrincipal)}
            </button>
          )}
        </div>
      )}

      {/* Panel Hero Proporcionado para Presentación: Controles + ComposedChart + KPIs Comparativos */}
      <section
        aria-labelledby="kipu-chart-heading"
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5"
      >
        <div className="mb-3 flex flex-col gap-3 border-b border-slate-100 pb-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Módulo B · Motor Matemático Base 360 Caja Trujillo
            </span>
            <h1 id="kipu-chart-heading" className="text-lg font-extrabold tracking-tight text-slate-900 lg:text-xl">
              Sincronización Estacional KipuAI vs. Cuota Fija Tradicional
            </h1>
            <p className="text-xs text-slate-500">
              {businessName} · Desembolso {formatDateLima(params.disbursementDate)} · TED Base 360
              exacta por días transcurridos (dₜ)
            </p>
          </div>

          {/* Selector Periodicidad Mensual vs Elástica */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => handlePeriodicityChange("monthly")}
              aria-pressed={params.periodicityMode === "monthly"}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                params.periodicityMode === "monthly"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Mensual Estándar (~30d)
            </button>
            <button
              type="button"
              onClick={() => handlePeriodicityChange("elastic")}
              aria-pressed={params.periodicityMode === "elastic"}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                params.periodicityMode === "elastic"
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Periodicidad Elástica (22d Cima / 40d Valle)
            </button>
          </div>
        </div>

        {/* Gráfico Combinado Recharts de proporción ejecutiva para capturas 1440x900 */}
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={chartData} margin={{ top: 12, right: 20, left: 8, bottom: 8 }}>
              <defs>
                <linearGradient id="netProfitFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => `S/ ${(v / 1000).toFixed(1)}k`}
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={false}
                tickLine={false}
                width={68}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const num = Number(value);
                  return [Number.isFinite(num) ? formatPEN(num) : "—", String(name)];
                }}
                labelFormatter={(label, payload) => {
                  const item = payload?.[0]?.payload as ChartDatum | undefined;
                  if (!item) return String(label);
                  return `Cuota #${item.cuotaNum} · ${item.dueDateFormatted} (${item.days} días · ${item.stage.toUpperCase()})`;
                }}
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid #cbd5e1",
                  boxShadow: "0 10px 25px -5px rgba(15,23,42,0.12)",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              <Area
                type="monotone"
                dataKey="utilidadNeta"
                name="Utilidad Neta Proyectada"
                stroke="#0284c7"
                strokeWidth={2}
                fill="url(#netProfitFill)"
              />
              <Bar
                dataKey="cuotaKipu"
                name="Cuota Adaptada KipuAI"
                fill="#059669"
                radius={[6, 6, 0, 0]}
                maxBarSize={40}
              />
              <Line
                type="monotone"
                dataKey="topeCapacidad"
                name={`Tope Capacidad (${formatPct(params.fieldCriterionFactor, 0)})`}
                stroke="#dc2626"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={{ r: 3, fill: "#dc2626" }}
              />
              <Line
                type="monotone"
                dataKey="cuotaFija"
                name="Cuota Fija Tradicional"
                stroke="#d97706"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "#d97706" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Cinta resumen de comparación directa debajo del gráfico */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 md:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
            <span className="block text-[11px] font-semibold text-emerald-900">
              Rango Cuota KipuAI (Valle → Cima)
            </span>
            <span className="mt-0.5 block font-mono text-sm font-extrabold text-emerald-950 tabular-nums">
              {formatPEN(minKipuQuota)} → {formatPEN(maxKipuQuota)}
            </span>
            <span className="text-[11px] text-emerald-800">
              {kipuBreachesCount === 0
                ? "0 cuotas perforan el tope de pago"
                : `${kipuBreachesCount} cuotas exceden capacidad`}
            </span>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <span className="block text-[11px] font-semibold text-amber-900">
              Cuota Fija Tradicional Promedio
            </span>
            <span className="mt-0.5 block font-mono text-sm font-extrabold text-amber-950 tabular-nums">
              {formatPEN(avgFixedQuota)}
            </span>
            <span className="text-[11px] font-semibold text-rose-700">
              {fixedBreachesCount > 0
                ? `¡Perfora capacidad en ${fixedBreachesCount} de ${fixedSchedule.rows.length} cuotas!`
                : "Dentro de capacidad en escenario base"}
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="block text-[11px] font-semibold text-slate-600">
              Interés Total Acumulado (Base 360)
            </span>
            <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
              {formatPEN(kipuSchedule.totalInterest)}
            </div>
            <span className="text-[11px] text-slate-500">
              Fija: {formatPEN(fixedSchedule.totalInterest)} · Seguros:{" "}
              {formatPEN(kipuSchedule.totalInsurance)}
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="block text-[11px] font-semibold text-slate-600">
              TCEA Exacta Anualizada (TIR 360)
            </span>
            <div className="mt-0.5 flex items-baseline gap-2 font-mono text-sm tabular-nums">
              <strong className="text-emerald-700">{formatPct(kipuSchedule.tcea)}</strong>
              <span className="text-xs text-slate-400">vs.</span>
              <span className="font-semibold text-amber-700">{formatPct(fixedSchedule.tcea)}</span>
            </div>
            <span className="text-[11px] text-slate-500">
              Saldo Capital final: {formatPEN(kipuSchedule.rows.at(-1)?.endingPrincipalBalance ?? 0)}
            </span>
          </div>
        </div>
      </section>

      {/* Tabla Detallada del Cronograma con Sticky Header */}
      <section
        aria-labelledby="schedule-table-heading"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="schedule-table-heading" className="text-lg font-bold text-slate-900">
              Cronograma Detallado Auditado — Prelación Estricta Base 360
            </h2>
            <p className="text-xs text-slate-500">
              Prelación Caja Trujillo (Q&A #7): primero lo pendiente (Seguros → Interés → Capital) y luego lo
              del periodo (Seguros → Interés → Capital). Lo impago nunca se suma al Saldo de Capital.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setTableView("kipu")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  tableView === "kipu"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Cronograma KipuAI
              </button>
              <button
                type="button"
                onClick={() => setTableView("fixed")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                  tableView === "fixed"
                    ? "bg-amber-600 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Cuota Fija Tradicional
              </button>
            </div>

            <button
              type="button"
              onClick={onNextModule}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 cursor-pointer"
            >
              Someter a Estrés [Ayni]
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="schedule-table-heading"
          className="kipu-table-region max-h-[520px] rounded-xl border border-slate-200"
        >
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900 text-[11px] font-semibold uppercase tracking-wider text-slate-200">
              <tr>
                <th className="px-3 py-3">N°</th>
                <th className="px-3 py-3">Fecha Exacta</th>
                <th className="px-3 py-3 text-right">Días (dₜ)</th>
                <th className="px-3 py-3">Ciclo</th>
                <th className="px-3 py-3 text-right">Utilidad Neta</th>
                <th className="px-3 py-3 text-right">Seguros</th>
                <th className="px-3 py-3 text-right">Interés</th>
                <th className="px-3 py-3 text-right">Capital Amort.</th>
                <th className="px-3 py-3 text-right">Cuota Total</th>
                <th className="px-3 py-3 text-right">Saldo Capital</th>
                <th className="px-3 py-3 text-center">Cuota / Utilidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white font-mono tabular-nums">
              {activeSchedule.rows.map((row) => {
                const ratioHealthy = !row.capacityBreached;
                return (
                  <tr
                    key={row.number}
                    className={`transition hover:bg-slate-50 ${
                      row.capacityBreached ? "bg-rose-50/40" : ""
                    }`}
                  >
                    <th scope="row" className="bg-inherit px-3 py-2.5 font-bold text-slate-900">
                      #{row.number}
                    </th>
                    <td className="whitespace-nowrap px-3 py-2.5 font-sans font-medium text-slate-700">
                      {formatDateLima(row.dueDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{row.days}d</td>
                    <td className="px-3 py-2.5 font-sans">
                      <CycleBadge stage={row.cycleStage} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                      {formatPEN(row.projectedNetProfit)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">
                      {formatPEN(row.paidPendingInsurance + row.paidInsurance)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                      {formatPEN(row.paidPendingInterest + row.paidInterest)}
                      {row.pendingInterestBalance > 0 && (
                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-900">
                          pend. {formatPEN(row.pendingInterestBalance)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-emerald-700">
                      {formatPEN(row.principalAmortized)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-slate-950">
                      {formatPEN(row.scheduledInstallment)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                      {formatPEN(row.endingPrincipalBalance)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-sans">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${
                          ratioHealthy
                            ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border border-rose-300 bg-rose-100 text-rose-900"
                        }`}
                      >
                        {ratioHealthy ? (
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        )}
                        {Number.isFinite(row.quotaToProfitRatio)
                          ? formatPct(row.quotaToProfitRatio, 1)
                          : "Déficit"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-100 font-mono text-xs font-bold text-slate-900 tabular-nums">
              <tr>
                <td colSpan={5} className="px-3 py-3 font-sans uppercase">
                  Totales del Cronograma ({tableView === "kipu" ? "KipuAI" : "Cuota Fija"})
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {formatPEN(activeSchedule.totalInsurance)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {formatPEN(activeSchedule.totalInterest)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-emerald-800">
                  {formatPEN(
                    activeSchedule.rows.reduce((acc, r) => acc + r.principalAmortized, 0)
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {formatPEN(activeSchedule.totalPaid)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {formatPEN(activeSchedule.rows.at(-1)?.endingPrincipalBalance ?? 0)}
                </td>
                <td className="px-3 py-3 text-center">
                  TCEA {formatPct(activeSchedule.tcea)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
