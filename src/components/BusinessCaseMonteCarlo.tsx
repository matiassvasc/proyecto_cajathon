"use client";

import { useEffect, useMemo, useState } from "react";
import { Dices, Landmark, Loader2 } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { computeAllBusinessCases } from "@/lib/business-case";
import { formatPEN, formatPct } from "@/lib/formatters";
import { runMonteCarlo, type MonteCarloResult } from "@/lib/monte-carlo";
import type {
  BusinessProfile,
  CreditParams,
  StressComparisonResult,
  StressScenarioId,
} from "@/lib/types";

interface Props {
  profile: BusinessProfile;
  params: CreditParams;
  stressResults: Record<StressScenarioId, StressComparisonResult>;
}

export function BusinessCaseMonteCarlo({ profile, params, stressResults }: Props) {
  const businessCases = useMemo(
    () => computeAllBusinessCases(stressResults, params),
    [stressResults, params]
  );

  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    setRunning(true);
    const handle = setTimeout(() => {
      try {
        setMc(runMonteCarlo(profile, params));
      } finally {
        setRunning(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [profile, params]);

  const kipuRows = stressResults.base.kipu.schedule.rows;
  const bandData = useMemo(
    () =>
      (mc?.netProfitBands ?? []).map((b, i) => ({
        label: `C${b.period}`,
        band: [b.p10, b.p90] as [number, number],
        p50: b.p50,
        cuota: kipuRows[i]?.scheduledInstallment ?? 0,
      })),
    [mc, kipuRows]
  );

  return (
    <section
      aria-labelledby="business-case-heading"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5"
    >
      <div className="mb-3 border-b border-slate-100 pb-3">
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
          Sostenibilidad financiera de Caja Trujillo
        </span>
        <h2
          id="business-case-heading"
          className="text-lg font-extrabold tracking-tight text-slate-900 lg:text-xl"
        >
          Caso de negocio y riesgo probabilístico (Monte Carlo)
        </h2>
        <p className="text-xs text-slate-500">
          Resultado para la Caja = intereses cobrados + reinversión del capital recuperado a la misma
          TEA − saldo impago al vencimiento (pérdida bruta, antes de garantías). Seguros excluidos
          (son de la aseguradora).
        </p>
      </div>

      {/* Caso de negocio por escenario */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">Escenario</th>
              <th className="py-2 pr-3 text-right">Intereses K / F</th>
              <th className="py-2 pr-3 text-right">Vida media capital K / F</th>
              <th className="py-2 pr-3 text-right">Pérdida K / F</th>
              <th className="py-2 pr-3 text-right">Resultado Caja K / F</th>
              <th className="py-2 text-right">Ventaja KipuAI</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {businessCases.map((bc) => (
              <tr key={bc.scenarioId} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-sans font-semibold text-slate-800">
                  {bc.scenarioLabel}
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatPEN(bc.kipu.interestCollected)} / {formatPEN(bc.fixed.interestCollected)}
                </td>
                <td className="py-2 pr-3 text-right">
                  {Math.round(bc.kipu.capitalAvgLifeDays)}d / {Math.round(bc.fixed.capitalAvgLifeDays)}d
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatPEN(bc.kipu.unpaidResidual)} / {formatPEN(bc.fixed.unpaidResidual)}
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatPEN(bc.kipu.economicResult)} / {formatPEN(bc.fixed.economicResult)}
                </td>
                <td
                  className={`py-2 text-right font-bold ${
                    bc.economicAdvantage >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {bc.economicAdvantage >= 0 ? "+" : ""}
                  {formatPEN(bc.economicAdvantage)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Monte Carlo */}
      <div className="mt-5 flex items-center gap-2">
        <Dices className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-900">
          Monte Carlo: {(mc?.config.simulations ?? 1000).toLocaleString("en-US")} trayectorias del ciclo (semilla{" "}
          {mc?.config.seed ?? "—"}, reproducible)
        </h3>
        {running && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Simulando" />}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Shock de nivel de ventas σ {formatPct(mc?.config.levelSigma ?? 0.1, 0)} · ruido mensual AR(1)
        σ {formatPct(mc?.config.monthlySigma ?? 0.07, 0)} · P(retraso de campaña){" "}
        {formatPct(mc?.config.campaignDelayProb ?? 0.2, 0)} · P(El Niño){" "}
        {formatPct(mc?.config.elNinoProb ?? 0.15, 0)} con severidad aleatoria × sensibilidad zonal{" "}
        {profile.elNinoSensitivity.toFixed(2)}.
      </p>

      {mc && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {(
              [
                ["KipuAI", mc.kipu, "border-emerald-200 bg-emerald-50/60"],
                ["Cuota fija", mc.fixed, "border-slate-200 bg-slate-50"],
              ] as const
            ).map(([label, s, cls]) => (
              <div key={label} className={`rounded-xl border p-3 ${cls}`}>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <Landmark className="h-3.5 w-3.5" aria-hidden="true" /> {label}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <Stat k="P(cuota > 100% de la utilidad)" v={formatPct(s.probAnyShortfall, 1)} />
                  <Stat k="P(atraso > 30 días)" v={formatPct(s.probOverdue30, 1)} />
                  <Stat k="P(deuda al vencimiento)" v={formatPct(s.probResidualDebt, 1)} />
                  <Stat k="P(alguna cuota > factor)" v={formatPct(s.probAnyFactorBreach, 1)} />
                  <Stat k="Pérdida esperada" v={formatPEN(s.expectedResidual)} />
                  <Stat k="Pérdida P95 (VaR)" v={formatPEN(s.residualP95)} />
                  <Stat k="Resultado esperado Caja" v={formatPEN(s.expectedEconomicResult)} />
                  <Stat k="Resultado P5 (peor 5%)" v={formatPEN(s.economicResultP5)} />
                </dl>
              </div>
            ))}
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            Superar el factor no es impago: el factor reserva una parte de la utilidad como colchón. El
            impago real ocurre cuando la cuota supera el 100% de la utilidad neta del periodo.
          </p>

          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bandData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={(value: unknown, name: unknown) =>
                    Array.isArray(value)
                      ? [`${formatPEN(Number(value[0]))} – ${formatPEN(Number(value[1]))}`, String(name)]
                      : [formatPEN(Number(value)), String(name)]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="band"
                  name="Utilidad neta simulada P10–P90"
                  fill="#6ee7b7"
                  stroke="#34d399"
                  strokeWidth={0.5}
                  fillOpacity={0.45}
                  legendType="square"
                />
                <Line type="monotone" dataKey="p50" name="Utilidad neta mediana" stroke="#047857" strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="cuota" name="Cuota KipuAI" stroke="#0f172a" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Probabilidad por cuota de superar el factor (KipuAI):{" "}
            {mc.kipu.breachProbByPeriod.map((p, i) => `C${i + 1} ${Math.round(p * 100)}%`).join(" · ")}
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-slate-600">{k}</dt>
      <dd className="text-right font-mono font-bold tabular-nums text-slate-900">{v}</dd>
    </>
  );
}
