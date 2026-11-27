"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  Croissant,
  FileSpreadsheet,
  Loader2,
  MapPin,
  ShieldCheck,
  Shirt,
  Sparkles,
  Sprout,
  Upload,
  Wrench,
} from "lucide-react";
import { computeMonthlyNetProfit, PERUVIAN_ARCHETYPES } from "@/lib/archetypes";
import { classifyCycleStage, formatPEN, formatPct, MONTH_LABELS_ES } from "@/lib/formatters";
import {
  BCRP_MAX_TEA,
  PRODUCT_MAX_FACTORS,
  type BusinessArchetype,
  type BusinessProfile,
  type CreditParams,
  type CreditProductType,
  type ExtractionResponse,
  type PatrimonialInsuranceType,
} from "@/lib/types";

interface ChasquiIntakeProps {
  selectedArchetypeId: string;
  onSelectArchetype: (arch: BusinessArchetype) => void;
  profile: BusinessProfile;
  onChangeProfile: (next: BusinessProfile) => void;
  params: CreditParams;
  onChangeParams: (next: CreditParams) => void;
  onNextModule: () => void;
}

const ARCHETYPE_ICONS: Record<string, typeof Croissant> = {
  panaderia_trujillo: Croissant,
  textil_porvenir: Shirt,
  agro_viru_palta: Sprout,
  taller_esperanza: Wrench,
};

async function rasterizeDataUrlToPng(dataUrl: string): Promise<{ base64: string; mimeType: string }> {
  if (!dataUrl.startsWith("data:image/svg+xml")) {
    const match = /^data:([^;]+);base64,/.exec(dataUrl);
    return {
      base64: dataUrl,
      mimeType: match?.[1] || "image/png",
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#fefce8";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, 600, 400);
        const pngUrl = canvas.toDataURL("image/png");
        resolve({ base64: pngUrl, mimeType: "image/png" });
      } else {
        resolve({ base64: dataUrl, mimeType: "image/svg+xml" });
      }
    };
    img.onerror = () => resolve({ base64: dataUrl, mimeType: "image/svg+xml" });
    img.src = dataUrl;
  });
}

export function ChasquiIntake({
  selectedArchetypeId,
  onSelectArchetype,
  profile,
  onChangeProfile,
  params,
  onChangeParams,
  onNextModule,
}: ChasquiIntakeProps) {
  const currentArch =
    PERUVIAN_ARCHETYPES.find((a) => a.id === selectedArchetypeId) ?? PERUVIAN_ARCHETYPES[0];

  const [fieldNotes, setFieldNotes] = useState<string>(currentArch.sampleFieldNotes);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>("image/png");
  const [extracting, setExtracting] = useState<boolean>(false);
  const [extractionResult, setExtractionResult] = useState<ExtractionResponse | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [appliedBanner, setAppliedBanner] = useState<boolean>(false);
  const [teaWarning, setTeaWarning] = useState<string | null>(null);

  const maxProductFactor = PRODUCT_MAX_FACTORS[params.productType];
  const baseNetMonthly = computeMonthlyNetProfit(profile, 1.0);

  const handleChooseArchetype = (arch: BusinessArchetype) => {
    onSelectArchetype(arch);
    setFieldNotes(arch.sampleFieldNotes);
    setPreviewDataUrl(null);
    setExtractionResult(null);
    setExtractError(null);
    setAppliedBanner(false);
    setTeaWarning(null);
  };

  const handleLoadSampleNotebook = () => {
    setPreviewDataUrl(currentArch.sampleNotebookDataUrl);
    setImageMime("image/svg+xml");
    setFieldNotes(currentArch.sampleFieldNotes);
    setAppliedBanner(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPreviewDataUrl(reader.result);
        setImageMime(file.type || "image/jpeg");
        setAppliedBanner(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRunExtraction = async () => {
    setExtracting(true);
    setAppliedBanner(false);
    setExtractError(null);
    try {
      let imagePayload: { base64?: string; mimeType?: string } = {};
      if (previewDataUrl) {
        imagePayload = await rasterizeDataUrlToPng(previewDataUrl);
      }

      const res = await fetch("/api/extract-business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: fieldNotes,
          imageBase64: imagePayload.base64,
          mimeType: imagePayload.mimeType || imageMime,
          currentArchetypeId: selectedArchetypeId,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as ExtractionResponse;
      if (!data?.profilePatch) {
        throw new Error("Respuesta incompleta del extractor.");
      }
      setExtractionResult(data);
    } catch {
      setExtractError(
        "No se pudo procesar la extracción en este momento. Verifica tus apuntes o intenta nuevamente."
      );
    } finally {
      setExtracting(false);
    }
  };

  const handleApplyExtracted = () => {
    if (!extractionResult) return;
    const patch = extractionResult.profilePatch;
    onChangeProfile({
      ...profile,
      name: patch.name || profile.name,
      sector: patch.sector || profile.sector,
      location: patch.location || profile.location,
      baseMonthlySales: patch.baseMonthlySales,
      cogsRatio: patch.cogsRatio,
      fixedOperatingExpenses: patch.fixedOperatingExpenses,
      taxExpenseMonthly: patch.taxExpenseMonthly,
      familyBurden: patch.familyBurden,
      insurableAssetValue: patch.insurableAssetValue,
      seasonalFactors: patch.seasonalFactors,
    });

    const clampedFactor = Math.min(
      PRODUCT_MAX_FACTORS[params.productType],
      extractionResult.recommendedFieldFactor
    );
    onChangeParams({
      ...params,
      insurableValue: params.patrimonialType === "none" ? 0 : patch.insurableAssetValue,
      fieldCriterionFactor: clampedFactor,
    });
    setAppliedBanner(true);
  };

  const handleProductChange = (nextProduct: CreditProductType) => {
    const nextMax = PRODUCT_MAX_FACTORS[nextProduct];
    onChangeParams({
      ...params,
      productType: nextProduct,
      fieldCriterionFactor: Math.min(params.fieldCriterionFactor, nextMax),
    });
  };

  const handleTeaPercentChange = (rawPct: number) => {
    if (!Number.isFinite(rawPct)) return;
    if (rawPct > BCRP_MAX_TEA * 100) {
      setTeaWarning(
        `Tope máximo referencial BCRP alcanzado (${(BCRP_MAX_TEA * 100).toFixed(1)}%). Se ajustó automáticamente.`
      );
      onChangeParams({ ...params, tea: BCRP_MAX_TEA });
    } else {
      setTeaWarning(null);
      onChangeParams({ ...params, tea: Math.max(0.05, rawPct / 100) });
    }
  };

  const handlePatrimonialChange = (nextType: PatrimonialInsuranceType) => {
    const defaultRate =
      nextType === "multirriesgo" ? 0.0055 : nextType === "vivienda" ? 0.0045 : 0;
    const changedType = nextType !== params.patrimonialType;
    onChangeParams({
      ...params,
      patrimonialType: nextType,
      patrimonialRateAnnual:
        nextType === "none"
          ? 0
          : changedType
            ? defaultRate
            : params.patrimonialRateAnnual || defaultRate,
      insurableValue:
        nextType === "none" ? 0 : params.insurableValue || profile.insurableAssetValue,
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. Selector de los 4 Arquetipos Sintéticos Peruanos Calibrados */}
      <section aria-labelledby="archetypes-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Módulo A · Chasqui — Admisión en Campo
            </span>
            <h1 id="archetypes-heading" className="text-xl font-extrabold tracking-tight text-slate-900">
              1. Selecciona un Arquetipo Microempresarial Calibrado (La Libertad)
            </h1>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            Calibrado con series INEI · MIDAGRI · SENAMHI · BCRP
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {PERUVIAN_ARCHETYPES.map((arch) => {
            const Icon = ARCHETYPE_ICONS[arch.id] ?? Building2;
            const isSelected = arch.id === selectedArchetypeId;
            return (
              <button
                key={arch.id}
                type="button"
                onClick={() => handleChooseArchetype(arch)}
                aria-pressed={isSelected}
                className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all cursor-pointer ${
                  isSelected
                    ? "border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-600/20 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                }`}
              >
                <div>
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                        isSelected
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                      {arch.badge}
                    </span>
                  </div>

                  <h2 className="text-sm font-bold text-slate-900">{arch.shortTitle}</h2>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {arch.subtitle}
                  </p>

                  <div className="mt-3 space-y-1 text-[11px]">
                    <p className="font-medium text-emerald-800">{arch.peakSummary}</p>
                    <p className="font-medium text-amber-800">{arch.valleySummary}</p>
                  </div>
                </div>

                {/* Mini sparkline de estacionalidad mensual (12 meses) */}
                <div className="mt-4 border-t border-slate-200/80 pt-3">
                  <div className="flex h-10 items-end gap-1" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, idx) => {
                      const m = idx + 1;
                      const factor = arch.profile.seasonalFactors[m] ?? 1;
                      const stage = classifyCycleStage(factor);
                      const heightPct = Math.max(22, Math.min(100, Math.round((factor / 1.7) * 100)));
                      const barColor =
                        stage === "cima"
                          ? "bg-emerald-500"
                          : stage === "valle"
                            ? "bg-amber-400"
                            : "bg-slate-400";
                      return (
                        <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5">
                          <div
                            style={{ height: `${heightPct}%` }}
                            className={`w-full rounded-t ${barColor}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-400">
                    <span>Ene</span>
                    <span>Jun</span>
                    <span>Dic</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Grid de 2 columnas: Extractor Multimodal en Vivo + Parámetros del Crédito */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Columna Izquierda (5 cols): Extractor Multimodal en Vivo + Flujo Base */}
        <section
          aria-labelledby="extractor-heading"
          className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5 lg:p-6"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-sky-700">
                  Ingesta Multimodal Gemini IA
                </span>
                <h2 id="extractor-heading" className="text-lg font-bold text-slate-900">
                  2. Cuaderno de Ventas & Notas del Asesor
                </h2>
              </div>
              <button
                type="button"
                onClick={handleLoadSampleNotebook}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                Cargar cuaderno muestra
              </button>
            </div>

            {/* Subida o previsualización de foto */}
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
              {previewDataUrl ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewDataUrl}
                    alt="Evidencia visual de cuaderno de ventas o comprobante en campo"
                    className="max-h-48 w-full rounded-lg border border-slate-200 object-contain bg-white"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-medium text-emerald-700">
                      Evidencia visual lista para análisis multimodal
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewDataUrl(null)}
                      className="font-semibold text-rose-600 hover:underline cursor-pointer"
                    >
                      Quitar imagen
                    </button>
                  </div>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center py-4 text-center">
                  <Upload className="mb-1.5 h-6 w-6 text-slate-400" aria-hidden="true" />
                  <span className="text-xs font-semibold text-slate-700">
                    Subir foto de cuaderno de ventas, boleta o liquidación
                  </span>
                  <span className="mt-0.5 text-[11px] text-slate-500">
                    PNG, JPG o WEBP (o usa «Cargar cuaderno muestra» arriba)
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              )}
            </div>

            <div>
              <label
                htmlFor="advisor-field-notes"
                className="mb-1 block text-xs font-semibold text-slate-700"
              >
                Apuntes de visita en campo del asesor de negocios
              </label>
              <textarea
                id="advisor-field-notes"
                rows={4}
                value={fieldNotes}
                onChange={(e) => setFieldNotes(e.target.value)}
                placeholder="Ej.: Ventas mes normal S/ 18,500, insumos 54%, alquiler S/ 2,650, RUS S/ 50, carga familiar S/ 2,100..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleRunExtraction}
              disabled={extracting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
            >
              {extracting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Analizando evidencia de campo...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  Extraer Flujo y Estacionalidad (/api/extract-business)
                </>
              )}
            </button>

            {extractError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                <span>{extractError}</span>
              </div>
            )}

            {extractionResult && (
              <div className="space-y-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-emerald-950">
                    Extracción completada · Confianza {(extractionResult.confidence * 100).toFixed(0)}%
                  </span>
                  <span className="rounded-md border border-emerald-300 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-800">
                    {extractionResult.source === "gemini-live"
                      ? `Gemini Live (${extractionResult.modelUsed})`
                      : "Fallback Determinista Calibrado"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-2.5 font-mono text-[11px] tabular-nums">
                  <div>
                    <span className="text-slate-500">Ventas Base:</span>{" "}
                    <strong className="text-slate-900">
                      {formatPEN(extractionResult.profilePatch.baseMonthlySales)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Costo Ventas:</span>{" "}
                    <strong className="text-slate-900">
                      {(extractionResult.profilePatch.cogsRatio * 100).toFixed(0)}%
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Gastos + Trib.:</span>{" "}
                    <strong className="text-slate-900">
                      {formatPEN(
                        extractionResult.profilePatch.fixedOperatingExpenses +
                          extractionResult.profilePatch.taxExpenseMonthly
                      )}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Carga Familiar:</span>{" "}
                    <strong className="text-slate-900">
                      {formatPEN(extractionResult.profilePatch.familyBurden)}
                    </strong>
                  </div>
                </div>

                <ul className="space-y-1 text-[11px] text-slate-700">
                  {extractionResult.detectedAnomalies.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={handleApplyExtracted}
                  className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 cursor-pointer"
                >
                  {appliedBanner
                    ? "✓ Parámetros aplicados al flujo activo"
                    : "Aplicar datos extraídos al flujo del negocio"}
                </button>
              </div>
            )}
          </div>

          {/* Resumen editable rápido de la unidad económico-familiar */}
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Flujo Operativo Mensual Activo (Mes Normal 1.00x)
              </h3>
              <span className="font-mono text-xs font-bold text-emerald-700 tabular-nums">
                Utilidad Neta: {formatPEN(baseNetMonthly)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">Ventas Base (S/)</span>
                <input
                  type="number"
                  min={1000}
                  step={500}
                  value={profile.baseMonthlySales}
                  onChange={(e) =>
                    onChangeProfile({
                      ...profile,
                      baseMonthlySales: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">Costo Ventas (%)</span>
                <input
                  type="number"
                  min={10}
                  max={88}
                  step={1}
                  value={Math.round(profile.cogsRatio * 100)}
                  onChange={(e) =>
                    onChangeProfile({
                      ...profile,
                      cogsRatio: Math.min(0.88, Math.max(0.1, Number(e.target.value) / 100)),
                    })
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">Gastos Operativos (S/)</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={profile.fixedOperatingExpenses}
                  onChange={(e) =>
                    onChangeProfile({
                      ...profile,
                      fixedOperatingExpenses: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">Carga Familiar (S/)</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={profile.familyBurden}
                  onChange={(e) =>
                    onChangeProfile({
                      ...profile,
                      familyBurden: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Columna Derecha (7 cols): Parámetros del Crédito, Seguros Base 360 y Criterio de Campo */}
        <section
          aria-labelledby="credit-params-heading"
          className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7 lg:p-6"
        >
          <div className="space-y-5">
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500">
                Reglas de Negocio Caja Trujillo
              </span>
              <h2 id="credit-params-heading" className="text-lg font-bold text-slate-900">
                3. Estructura del Crédito, Seguros Base 360 y Criterio de Campo
              </h2>
            </div>

            {/* Fila 1: Monto, Plazo, Desembolso, TEA */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="credit-principal"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Monto del Crédito (S/)
                </label>
                <input
                  id="credit-principal"
                  type="number"
                  min={1000}
                  max={300000}
                  step={500}
                  value={params.principal}
                  onChange={(e) =>
                    onChangeParams({
                      ...params,
                      principal: Math.max(500, Number(e.target.value)),
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm font-bold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[12000, 16000, 22000, 28000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onChangeParams({ ...params, principal: preset })}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      {formatPEN(preset)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="credit-installments"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Plazo / Número de Cuotas
                  </label>
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white tabular-nums">
                    {params.numInstallments} cuotas
                  </span>
                </div>
                <input
                  id="credit-installments"
                  type="range"
                  min={6}
                  max={24}
                  step={1}
                  value={params.numInstallments}
                  onChange={(e) =>
                    onChangeParams({ ...params, numInstallments: Number(e.target.value) })
                  }
                  className="mt-2.5 w-full accent-slate-900 cursor-pointer"
                />
                <div className="flex justify-between font-mono text-[10px] text-slate-400">
                  <span>6 cuotas</span>
                  <span>12 cuotas</span>
                  <span>18 cuotas</span>
                  <span>24 cuotas</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="disbursement-date"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Fecha de Desembolso (America/Lima)
                </label>
                <input
                  id="disbursement-date"
                  type="date"
                  value={params.disbursementDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      onChangeParams({ ...params, disbursementDate: e.target.value });
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="credit-tea" className="text-xs font-semibold text-slate-700">
                    Tasa Efectiva Anual — TEA (%)
                  </label>
                  <span className="font-mono text-[11px] font-medium text-emerald-700">
                    Máx. BCRP {(BCRP_MAX_TEA * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  id="credit-tea"
                  type="number"
                  min={5}
                  max={75}
                  step={0.5}
                  value={Number((params.tea * 100).toFixed(2))}
                  onChange={(e) => handleTeaPercentChange(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm font-bold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
                {teaWarning && (
                  <p className="mt-1 text-[11px] font-medium text-amber-700">{teaWarning}</p>
                )}
              </div>
            </div>

            {/* Fila 2: Seguros Base 360 */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-700" aria-hidden="true" />
                  <span className="text-xs font-bold text-slate-800">
                    Seguros Opcionales (Cálculo Exacto Simple Base 360)
                  </span>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.desgravamenEnabled}
                    onChange={(e) =>
                      onChangeParams({ ...params, desgravamenEnabled: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                  Seguro de Desgravamen ({(params.desgravamenRateAnnual * 100).toFixed(2)}% anual)
                </label>
              </div>

              <div>
                <span className="mb-1.5 block text-[11px] font-semibold text-slate-600">
                  Cobertura Patrimonial Excluyente
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(
                    [
                      { id: "none", label: "Sin seguro patrimonial", sub: "0.00% anual" },
                      {
                        id: "multirriesgo",
                        label: "Seguro Multirriesgo",
                        sub: "Maquinaria / Mercadería",
                      },
                      {
                        id: "vivienda",
                        label: "Seguro de Vivienda",
                        sub: "Inmueble / Local propio",
                      },
                    ] as const
                  ).map((opt) => {
                    const active = params.patrimonialType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handlePatrimonialChange(opt.id)}
                        aria-pressed={active}
                        className={`rounded-lg border px-3 py-2 text-left transition cursor-pointer ${
                          active
                            ? "border-slate-900 bg-white ring-1 ring-slate-900 shadow-2xs"
                            : "border-slate-200 bg-white/60 hover:bg-white"
                        }`}
                      >
                        <span className="block text-xs font-bold text-slate-900">{opt.label}</span>
                        <span className="block text-[10px] text-slate-500">{opt.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {params.patrimonialType !== "none" && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <label className="block text-xs">
                    <span className="text-[11px] font-medium text-slate-600">
                      Valor Asegurable (S/)
                    </span>
                    <input
                      type="number"
                      min={5000}
                      step={1000}
                      value={params.insurableValue}
                      onChange={(e) =>
                        onChangeParams({
                          ...params,
                          insurableValue: Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="text-[11px] font-medium text-slate-600">
                      Tasa Anual Patrimonial (%)
                    </span>
                    <input
                      type="number"
                      min={0.1}
                      max={5}
                      step={0.05}
                      value={Number((params.patrimonialRateAnnual * 100).toFixed(2))}
                      onChange={(e) =>
                        onChangeParams({
                          ...params,
                          patrimonialRateAnnual: Math.max(0, Number(e.target.value) / 100),
                        })
                      }
                      className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Fila 3: Producto Normativo + Deslizador de Criterio Humano de Campo */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      id: "inclusion",
                      title: "Inclusión Financiera",
                      capLabel: "Factor máx. 0.65 (65%)",
                      desc: "Microempresas en formalización o primer tramo crediticio",
                    },
                    {
                      id: "pequena_empresa",
                      title: "Pequeña Empresa",
                      capLabel: "Factor máx. 0.85 (85%)",
                      desc: "Unidades consolidadas con historial e inventario verificable",
                    },
                  ] as const
                ).map((prod) => {
                  const selected = params.productType === prod.id;
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => handleProductChange(prod.id)}
                      aria-pressed={selected}
                      className={`rounded-xl border p-3 text-left transition cursor-pointer ${
                        selected
                          ? "border-emerald-700 bg-white ring-2 ring-emerald-600/20"
                          : "border-slate-200 bg-white/70 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">{prod.title}</span>
                        <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-900">
                          {prod.capLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600">{prod.desc}</p>
                    </button>
                  );
                })}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="field-criterion-slider"
                    className="text-xs font-bold text-slate-900"
                  >
                    Deslizador de Criterio de Campo (Ajuste Prudencial del Asesor)
                  </label>
                  <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="text-slate-500">
                      Tope producto: {formatPct(maxProductFactor, 0)}
                    </span>
                    <span className="rounded-lg bg-emerald-700 px-2.5 py-0.5 font-bold text-white">
                      Aplicado: {formatPct(params.fieldCriterionFactor, 0)}
                    </span>
                  </div>
                </div>

                <input
                  id="field-criterion-slider"
                  type="range"
                  min={0.3}
                  max={maxProductFactor}
                  step={0.01}
                  value={params.fieldCriterionFactor}
                  onChange={(e) =>
                    onChangeParams({
                      ...params,
                      fieldCriterionFactor: Number(e.target.value),
                    })
                  }
                  className="mt-2 w-full accent-emerald-700 cursor-pointer"
                />

                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                  <span>Conservador (30%)</span>
                  <span className="font-medium text-emerald-900">
                    Tope mensual normal hoy:{" "}
                    <strong className="font-mono tabular-nums">
                      {formatPEN(Math.max(0, baseNetMonthly) * params.fieldCriterionFactor)}
                    </strong>{" "}
                    (reserva {(100 - params.fieldCriterionFactor * 100).toFixed(0)}% de liquidez libre)
                  </span>
                  <span>Máx. ({(maxProductFactor * 100).toFixed(0)}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Curva estacional activa + botón al Módulo Kipu */}
          <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>
                Estacionalidad activa:{" "}
                {Object.entries(profile.seasonalFactors)
                  .filter(([, f]) => f >= 1.18)
                  .map(([m]) => MONTH_LABELS_ES[Number(m)])
                  .join(", ")}{" "}
                (Cimas)
              </span>
            </div>

            <button
              type="button"
              onClick={onNextModule}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 cursor-pointer"
            >
              Generar Cronograma Base 360 [Kipu]
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
