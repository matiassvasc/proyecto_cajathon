import type { BusinessArchetype, BusinessProfile } from "./types";

function encodeSvgDataUrl(svg: string): string {
  if (typeof Buffer !== "undefined") {
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  }
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function buildNotebookSampleSvg(
  title: string,
  subtitle: string,
  lines: string[],
  stamp: string
): string {
  const lineElements = lines
    .map(
      (line, idx) => `
      <line x1="56" y1="${132 + idx * 38}" x2="564" y2="${132 + idx * 38}" stroke="#cbd5e1" stroke-width="1" />
      <text x="68" y="${124 + idx * 38}" font-family="monospace" font-size="14" fill="#1e293b">${line}</text>`
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" rx="14" fill="#fefce8" stroke="#ca8a04" stroke-width="2"/>
    <rect x="0" y="0" width="44" height="400" rx="14" fill="#fde68a"/>
    <line x1="56" y1="0" x2="56" y2="400" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 2"/>
    <text x="68" y="42" font-family="sans-serif" font-size="18" font-weight="bold" fill="#0f172a">${title}</text>
    <text x="68" y="66" font-family="sans-serif" font-size="12" fill="#475569">${subtitle}</text>
    <rect x="410" y="22" width="166" height="34" rx="6" fill="#dcfce7" stroke="#16a34a" stroke-width="1.2"/>
    <text x="493" y="44" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#166534">${stamp}</text>
    ${lineElements}
  </svg>`;

  return encodeSvgDataUrl(svg);
}

/**
 * Calcula la Utilidad Neta mensual proyectada de la unidad económico-familiar:
 * Ventas Estacionales - Costo de Ventas - Gastos Operativos Fijos - Impuestos - Carga Familiar.
 */
export function computeMonthlyNetProfit(
  profile: BusinessProfile,
  seasonalFactor: number,
  overrides?: {
    salesMultiplier?: number;
    extraOperatingCost?: number;
  }
): number {
  const salesMult = overrides?.salesMultiplier ?? 1;
  const extraCost = overrides?.extraOperatingCost ?? 0;
  const monthlySales = profile.baseMonthlySales * seasonalFactor * salesMult;
  const cogs = monthlySales * profile.cogsRatio;
  return (
    monthlySales -
    cogs -
    profile.fixedOperatingExpenses -
    profile.taxExpenseMonthly -
    profile.familyBurden -
    extraCost
  );
}

export const PERUVIAN_ARCHETYPES: BusinessArchetype[] = [
  {
    id: "panaderia_trujillo",
    shortTitle: "Panadería y Pastelería Artesanal",
    subtitle: "Trujillo Centro, La Libertad",
    badge: "Comercio & Manufactura Ligera",
    peakSummary: "Cimas: May (Día de la Madre), Jul y Dic (Panetones)",
    valleySummary: "Valles: Feb–Mar (calor de verano y desvío por gasto escolar)",
    profile: {
      id: "panaderia_trujillo",
      name: "Panadería & Pastelería Artesanal «Horno de Oro»",
      ownerName: "Rosa María Otiniano Rebaza",
      sector: "Elaboración de productos de panadería y pastelería",
      location: "Urb. Palermo, Trujillo — La Libertad",
      baseMonthlySales: 18500,
      cogsRatio: 0.54,
      fixedOperatingExpenses: 2650,
      taxExpenseMonthly: 50,
      familyBurden: 2100,
      seasonalFactors: {
        1: 0.88,
        2: 0.68,
        3: 0.72,
        4: 0.96,
        5: 1.44,
        6: 1.04,
        7: 1.38,
        8: 1.02,
        9: 0.95,
        10: 1.08,
        11: 1.15,
        12: 1.62,
      },
      insurableAssetValue: 48000,
      elNinoSensitivity: 0.85,
      sources: [
        "INEI — Encuesta Mensual de Comercio y Servicios (La Libertad)",
        "BCRP Sucursal Trujillo — Síntesis Económica Regional",
        "Calendario Comercial Minorista Peruano (Campaña Madre, Fiestas Patrias, Navidad)",
        "SUNAT — Régimen tributario MYPE (Nuevo RUS / RER / RMT): carga tributaria mensual",
      ],
    },
    recommendedCredit: {
      principal: 16000,
      numInstallments: 12,
      tea: 0.385,
      desgravamenEnabled: true,
      desgravamenRateAnnual: 0.012,
      patrimonialType: "multirriesgo",
      patrimonialRateAnnual: 0.0055,
      insurableValue: 48000,
      productType: "inclusion",
      fieldCriterionFactor: 0.58,
      periodicityMode: "monthly",
    },
    sampleFieldNotes:
      "Visita en campo Urb. Palermo (Trujillo): Horno rotatorio operativo y vitrina refrigerada propia. Cuaderno diario muestra ventas promedio S/ 18,500/mes; insumos (harina, manteca, gas) representan ~54%. Alquiler y luz trifásica suman S/ 2,650, Nuevo RUS S/ 50 y canasta familiar de 2 hijos S/ 2,100. En febrero y marzo la venta de pan caliente cae ~30% por calor; en mayo (tortas Día de la Madre), julio y diciembre (campaña panetones) sube entre +38% y +62%. Se sugiere moderar factor a 0.58 por alza reciente de manteca.",
    sampleNotebookDataUrl: buildNotebookSampleSvg(
      "CUADERNO DE VENTAS — HORNO DE ORO",
      "Urb. Palermo, Trujillo | Verificación de Asesor Caja Trujillo",
      [
        "Venta mensual normal (abr/jun/ago):   S/ 18,500.00",
        "Insumos harina/azúcar/gas (54%):     -S/  9,990.00",
        "Luz trifásica + alquiler + ayudante: -S/  2,650.00",
        "Nuevo RUS Cat. 2 + Gasto familiar:   -S/  2,150.00",
        "Feb-Mar baja por verano (-30%):       S/ 12,600.00",
        "Campaña Mayo/Dic tortas y panetón:    S/ 29,900.00",
      ],
      "VERIFICADO EN CAMPO"
    ),
  },
  {
    id: "textil_porvenir",
    shortTitle: "Comercio Textil y Campaña Escolar",
    subtitle: "El Porvenir, Trujillo",
    badge: "Confección & Campaña Escolar",
    peakSummary: "Cimas: Feb–Mar (Uniformes/Buzos) y Dic (Campaña Navideña)",
    valleySummary: "Valles: May y Sep (transición de temporada textil)",
    profile: {
      id: "textil_porvenir",
      name: "Taller & Tienda Textil «Confecciones El Porvenir»",
      ownerName: "Segundo Wilmer Carranza Valderrama",
      sector: "Confección de prendas escolares, deportivas y comercio textil",
      location: "Sector Río Seco, El Porvenir — Trujillo",
      baseMonthlySales: 24000,
      cogsRatio: 0.58,
      fixedOperatingExpenses: 3400,
      taxExpenseMonthly: 180,
      familyBurden: 2300,
      seasonalFactors: {
        1: 1.08,
        2: 1.52,
        3: 1.65,
        4: 0.92,
        5: 0.66,
        6: 0.94,
        7: 1.24,
        8: 0.9,
        9: 0.68,
        10: 0.96,
        11: 1.18,
        12: 1.58,
      },
      insurableAssetValue: 65000,
      elNinoSensitivity: 1.0,
      sources: [
        "PRODUCE / INEI — Estadística MYPE Manufactura Textil La Libertad",
        "Cámara de Comercio de La Libertad — Campaña Escolar y Navideña",
        "SENAMHI — Impacto de lluvias intensas en El Porvenir (Quebrada San Idelfonso)",
      ],
    },
    recommendedCredit: {
      principal: 22000,
      numInstallments: 12,
      tea: 0.34,
      desgravamenEnabled: true,
      desgravamenRateAnnual: 0.012,
      patrimonialType: "multirriesgo",
      patrimonialRateAnnual: 0.006,
      insurableValue: 65000,
      productType: "pequena_empresa",
      fieldCriterionFactor: 0.68,
      periodicityMode: "monthly",
    },
    sampleFieldNotes:
      "Taller con 6 máquinas remalladoras/rectas en El Porvenir. Contratos con 4 colegios locales impulsan ventas fuertes en febrero-marzo (+52% a +65%) y campaña navideña en diciembre (+58%). Ventas base S/ 24,000, costo de tela/avíos 58%, gastos fijos taller S/ 3,400, RER S/ 180 y carga familiar S/ 2,300. En mayo y septiembre pedidos bajan a ~66%. Zona expuesta a escorrentía de Quebrada San Idelfonso: recomendable Seguro Multirriesgo sobre maquinaria (S/ 65,000).",
    sampleNotebookDataUrl: buildNotebookSampleSvg(
      "APUNTES TALLER — CONFECCIONES EL PORVENIR",
      "El Porvenir, Trujillo | Inventario de Máquinas y Pedidos",
      [
        "Ventas mes regular (jun/oct):         S/ 24,000.00",
        "Telas Gamarra + avíos + destajo 58%: -S/ 13,920.00",
        "Taller, energía y operarios fijos:   -S/  3,400.00",
        "RER SUNAT (S/ 180) + Hogar:          -S/  2,480.00",
        "Campaña Escolar Feb-Mar (colegios):   S/ 39,600.00",
        "Meses lentos Mayo y Septiembre:       S/ 15,840.00",
      ],
      "6 MÁQUINAS OPERATIVAS"
    ),
  },
  {
    id: "agro_viru_palta",
    shortTitle: "Productor Agrícola Palta / Espárrago",
    subtitle: "Chao / Virú, La Libertad",
    badge: "Agroexportación & Clima SENAMHI",
    peakSummary: "Cimas: Abr–Jul (cosecha principal MIDAGRI) y ventana Nov",
    valleySummary: "Valles: Ene–Feb y Sep–Oct (etapa vegetativa y riesgo El Niño)",
    profile: {
      id: "agro_viru_palta",
      name: "Fundo Familiar «Valle Verde — Palta Hass & Espárrago»",
      ownerName: "Teófilo Sandoval Cruzado",
      sector: "Cultivo agrícola de palta Hass y espárrago verde articulado a acopiadores",
      location: "Sector San José, Virú / Chao — La Libertad",
      baseMonthlySales: 28000,
      cogsRatio: 0.5,
      fixedOperatingExpenses: 4200,
      taxExpenseMonthly: 220,
      familyBurden: 2400,
      seasonalFactors: {
        1: 0.6,
        2: 0.56,
        3: 0.86,
        4: 1.38,
        5: 1.62,
        6: 1.58,
        7: 1.32,
        8: 0.94,
        9: 0.64,
        10: 0.66,
        11: 1.24,
        12: 0.98,
      },
      insurableAssetValue: 82000,
      elNinoSensitivity: 1.32,
      sources: [
        "MIDAGRI — Calendario Nacional de Siembras y Cosechas (Valle de Virú y Chao)",
        "SENAMHI / ENFEN — Monitoreo Térmico y Anomalías Pluviales Fenómeno El Niño",
        "BCRP — Reporte de Agroexportación No Tradicional Norte",
      ],
    },
    recommendedCredit: {
      principal: 25000,
      numInstallments: 12,
      tea: 0.32,
      desgravamenEnabled: true,
      desgravamenRateAnnual: 0.012,
      patrimonialType: "vivienda",
      patrimonialRateAnnual: 0.0045,
      insurableValue: 82000,
      productType: "pequena_empresa",
      fieldCriterionFactor: 0.66,
      periodicityMode: "elastic",
    },
    sampleFieldNotes:
      "Parcela de 4.5 ha tecnificada en Virú (Chao) con entrega a planta empacadora. Ingreso mensual referencial S/ 28,000 con 50% en fertilización, fitosanitarios y jornales; mantenimiento de riego y transporte fijo S/ 4,200; tributos S/ 220 y hogar S/ 2,400. Fuerte concentración de cosecha de palta Hass entre abril y julio (+38% a +62%) y corte complementario de espárrago en noviembre. Enero-febrero y sep-oct son meses de inversión vegetativa (56%–66%). Alta sensibilidad a anomalías cálidas El Niño (caída de floración y bloqueo de vías).",
    sampleNotebookDataUrl: buildNotebookSampleSvg(
      "LIQUIDACIÓN DE ACOPIO — VALLE VERDE (VIRÚ)",
      "Chao / Virú, La Libertad | 4.5 ha Palta Hass y Espárrago",
      [
        "Ingreso mensual ponderado anual:      S/ 28,000.00",
        "Fertilizantes, agroquímicos, jornal: -S/ 14,000.00",
        "Riego tecnificado y flete fijo:      -S/  4,200.00",
        "Tributos + Sostenimiento familiar:   -S/  2,620.00",
        "Ventana cosecha Abr-Jul (MIDAGRI):    S/ 45,360.00",
        "Etapa vegetativa Ene-Feb (mínimo):    S/ 15,680.00",
      ],
      "SENSIBLE A EL NIÑO"
    ),
  },
  {
    id: "taller_esperanza",
    shortTitle: "Taller Mecánico y Repuestos",
    subtitle: "La Esperanza, Trujillo",
    badge: "Servicios & Transporte Urbano",
    peakSummary: "Cimas: Jul (pre-Fiestas Patrias) y Nov–Dic (campaña transporte)",
    valleySummary: "Valles: Feb y Abr (menor rotación de flota ligera)",
    profile: {
      id: "taller_esperanza",
      name: "Servicio Automotriz & Repuestos «Norte Motor»",
      ownerName: "Héctor Luis Zavaleta Paredes",
      sector: "Mantenimiento mecánico multimarca y venta de repuestos/lubricantes",
      location: "Av. Tahuantinsuyo, La Esperanza — Trujillo",
      baseMonthlySales: 21000,
      cogsRatio: 0.52,
      fixedOperatingExpenses: 3100,
      taxExpenseMonthly: 190,
      familyBurden: 2200,
      seasonalFactors: {
        1: 0.96,
        2: 0.72,
        3: 0.92,
        4: 0.76,
        5: 1.02,
        6: 1.06,
        7: 1.38,
        8: 1.04,
        9: 0.94,
        10: 1.05,
        11: 1.28,
        12: 1.44,
      },
      insurableAssetValue: 58000,
      elNinoSensitivity: 0.78,
      sources: [
        "INEI — Índice de Flujo Vehicular y Servicios Automotrices Norte",
        "MTC / SUTRAN — Picos de Mantenimiento Preventivo Pre-Feriados Largos",
        "BCRP Trujillo — Indicadores de Actividad Comercial y Servicios",
        "SBS — Indicadores de endeudamiento MYPE La Libertad (deudas del sistema ya descontadas de la Utilidad Neta)",
      ],
    },
    recommendedCredit: {
      principal: 18000,
      numInstallments: 12,
      tea: 0.36,
      desgravamenEnabled: true,
      desgravamenRateAnnual: 0.012,
      patrimonialType: "multirriesgo",
      patrimonialRateAnnual: 0.0055,
      insurableValue: 58000,
      productType: "inclusion",
      fieldCriterionFactor: 0.6,
      periodicityMode: "monthly",
    },
    sampleFieldNotes:
      "Taller consolidado en Av. Tahuantinsuyo (La Esperanza) con elevador hidráulico, escáner electrónico y vitrina de filtros/lubricantes. Facturación base S/ 21,000/mes; compra de repuestos y aceites 52%; local + 2 técnicos S/ 3,100; MYPE Tributario S/ 190 y hogar S/ 2,200. Picos claros antes de Fiestas Patrias (julio +38%) y campaña de carga/transporte interprovincial en nov-dic (+28% a +44%); flujo menor en febrero y abril.",
    sampleNotebookDataUrl: buildNotebookSampleSvg(
      "ÓRDENES DE TRABAJO — NORTE MOTOR",
      "Av. Tahuantinsuyo, La Esperanza | Mecánica y Repuestos",
      [
        "Facturación servicios + repuestos:    S/ 21,000.00",
        "Costo repuestos y lubricantes (52%): -S/ 10,920.00",
        "Alquiler local + 2 mecánicos fijos:  -S/  3,100.00",
        "MYPE Tributario + Carga familiar:    -S/  2,390.00",
        "Campaña Jul / Dic flota transporte:   S/ 30,240.00",
        "Valle Febrero / Abril:                S/ 15,120.00",
      ],
      "ACTIVOS VERIFICADOS"
    ),
  },
];

export function getArchetypeById(id: string): BusinessArchetype {
  return PERUVIAN_ARCHETYPES.find((item) => item.id === id) ?? PERUVIAN_ARCHETYPES[0];
}
