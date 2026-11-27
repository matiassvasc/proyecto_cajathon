import type { CycleStage } from "./types";

export const LIMA_TIMEZONE = "America/Lima";

const MONTH_NAMES_SHORT_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

export const MONTH_LABELS_ES: Record<number, string> = {
  1: "Ene",
  2: "Feb",
  3: "Mar",
  4: "Abr",
  5: "May",
  6: "Jun",
  7: "Jul",
  8: "Ago",
  9: "Sep",
  10: "Oct",
  11: "Nov",
  12: "Dic",
};

/**
 * Formatea montos exactamente al estándar monetario peruano solicitado: `S/ 12,450.00`
 * (y `-S/ 320.50` para flujos negativos), independiente de variaciones ICU entre sistemas operativos.
 */
export function formatPEN(amount: number): string {
  if (!Number.isFinite(amount)) {
    return "S/ —";
  }
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isNegative = rounded < 0 && Math.abs(rounded) >= 0.005;
  const absVal = Math.abs(rounded);
  const [intPart, decPart] = absVal.toFixed(2).split(".");
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${isNegative ? "-" : ""}S/ ${groupedInt}.${decPart}`;
}

export function formatPct(decimalValue: number, decimals = 2): string {
  if (!Number.isFinite(decimalValue)) {
    return "—";
  }
  return `${(decimalValue * 100).toFixed(decimals)}%`;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseIsoYmd(isoDate: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error(`Invalid ISO calendar date "${isoDate}". Expected YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Out-of-range ISO calendar date "${isoDate}".`);
  }
  return [year, month, day];
}

export function toIsoYmd(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

function toUtcNoonEpochMs(isoDate: string): number {
  const [y, m, d] = parseIsoYmd(isoDate);
  // Mediodía UTC (12:00Z = 07:00 America/Lima) evita cualquier desfase de -1 día
  return Date.UTC(y, m - 1, d, 12, 0, 0, 0);
}

export function exactDaysBetween(startIso: string, endIso: string): number {
  const diffMs = toUtcNoonEpochMs(endIso) - toUtcNoonEpochMs(startIso);
  return Math.round(diffMs / 86_400_000);
}

export function addDaysIso(isoDate: string, days: number): string {
  const targetMs = toUtcNoonEpochMs(isoDate) + days * 86_400_000;
  const dt = new Date(targetMs);
  return toIsoYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Avanza meses calendario respetando fin de mes (ej. 2026-01-31 + 1 mes = 2026-02-28).
 */
export function addMonthsClampedIso(isoDate: string, monthsToAdd: number): string {
  const [y, m, d] = parseIsoYmd(isoDate);
  const zeroBasedMonth = m - 1 + monthsToAdd;
  const targetYear = y + Math.floor(zeroBasedMonth / 12);
  const targetMonth = (((zeroBasedMonth % 12) + 12) % 12) + 1;
  const clampedDay = Math.min(d, daysInMonth(targetYear, targetMonth));
  return toIsoYmd(targetYear, targetMonth, clampedDay);
}

/**
 * Formatea una fecha calendario en zona horaria explícita `America/Lima`.
 */
export function formatDateLima(isoDate: string): string {
  const [y, m, d] = parseIsoYmd(isoDate);
  // 17:00:00Z corresponde exactamente a las 12:00:00 en America/Lima (UTC-5 permanente)
  const limaNoonInstant = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  const parts = new Intl.DateTimeFormat("es-PE", {
    timeZone: LIMA_TIMEZONE,
    day: "2-digit",
    month: "numeric",
    year: "numeric",
  }).formatToParts(limaNoonInstant);

  const dayStr = parts.find((p) => p.type === "day")?.value ?? String(d).padStart(2, "0");
  const monthNum = Number(parts.find((p) => p.type === "month")?.value ?? m);
  const yearStr = parts.find((p) => p.type === "year")?.value ?? String(y);
  const monthShort = MONTH_NAMES_SHORT_ES[Math.max(0, Math.min(11, monthNum - 1))];
  return `${dayStr} ${monthShort} ${yearStr}`;
}

export function getTodayLimaIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "04";
  const d = parts.find((p) => p.type === "day")?.value ?? "15";
  return `${y}-${m}-${d}`;
}

export function getNowLimaTimestamp(): string {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: LIMA_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

export function classifyCycleStage(seasonalFactor: number): CycleStage {
  if (seasonalFactor >= 1.18) return "cima";
  if (seasonalFactor <= 0.84) return "valle";
  return "normal";
}
