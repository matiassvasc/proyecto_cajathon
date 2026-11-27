import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { extractBusinessDeterministic } from "@/lib/deterministic-ai";
import type { ExtractionResponse } from "@/lib/types";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-4-hydrogen";
const MAX_IMAGE_BASE64_CHARS = 10_000_000;
const MAX_NOTES_CHARS = 12_000;
const GEMINI_TIMEOUT_MS = 15_000;

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    sector: { type: "string" },
    location: { type: "string" },
    baseMonthlySales: { type: "number" },
    cogsRatio: { type: "number" },
    fixedOperatingExpenses: { type: "number" },
    taxExpenseMonthly: { type: "number" },
    familyBurden: { type: "number" },
    insurableAssetValue: { type: "number" },
    recommendedFieldFactor: { type: "number" },
    confidence: { type: "number" },
    seasonalFactors: {
      type: "object",
      properties: {
        "1": { type: "number" },
        "2": { type: "number" },
        "3": { type: "number" },
        "4": { type: "number" },
        "5": { type: "number" },
        "6": { type: "number" },
        "7": { type: "number" },
        "8": { type: "number" },
        "9": { type: "number" },
        "10": { type: "number" },
        "11": { type: "number" },
        "12": { type: "number" },
      },
      required: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
    },
    extractedAssumptions: {
      type: "array",
      items: { type: "string" },
    },
    detectedAnomalies: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "baseMonthlySales",
    "cogsRatio",
    "fixedOperatingExpenses",
    "taxExpenseMonthly",
    "familyBurden",
    "insurableAssetValue",
    "recommendedFieldFactor",
    "confidence",
    "seasonalFactors",
    "extractedAssumptions",
    "detectedAnomalies",
  ],
};

function stripBase64Prefix(raw?: unknown): { base64: string; detectedMime?: string } | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  const dataUrlMatch = /^data:([^;,]+)(?:;[^;,]+)*;base64,([\s\S]*)$/i.exec(trimmed);
  const detectedMime = dataUrlMatch ? dataUrlMatch[1].trim().toLowerCase() : undefined;
  const base64 = (dataUrlMatch ? dataUrlMatch[2] : trimmed).replace(/\s/g, "");

  if (base64.length === 0 || base64.length > MAX_IMAGE_BASE64_CHARS) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return null;

  return { base64, detectedMime };
}

function cleanStringList(raw: unknown, fallback: string[]): string[] {
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

  const notes =
    typeof body.notes === "string" ? body.notes.slice(0, MAX_NOTES_CHARS) : "";
  const currentArchetypeId =
    typeof body.currentArchetypeId === "string" ? body.currentArchetypeId : undefined;
  const bodyMime =
    typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : undefined;

  const parsedImage = stripBase64Prefix(body.imageBase64);
  const effectiveMime = parsedImage?.detectedMime || bodyMime || "image/png";
  const supportedImageMime = ["image/png", "image/jpeg", "image/webp"].includes(effectiveMime);

  const fallback = extractBusinessDeterministic({
    notes,
    hasImage: Boolean(parsedImage && supportedImageMime),
    currentArchetypeId,
    modelName: DEFAULT_MODEL,
  });

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(fallback, { status: 200 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const promptText = `Actúa como analista senior de admisión microfinanciera en campo de Caja Trujillo (La Libertad, Perú).
Extrae la estructura económica mensual en Soles (PEN) y los 12 factores estacionales (1=Enero .. 12=Diciembre, donde 1.00 es un mes normal, >1.18 es cima y <0.84 es valle) a partir de los siguientes apuntes y/o imagen de cuaderno de ventas:

Notas del asesor:
${notes || "(Sin notas textuales adicionales; analizar evidencia visual o inferir del giro comercial)"}

Arquetipo referencial actual: ${currentArchetypeId || "microempresa_trujillo"}`;

    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mime_type: "image/png" | "image/jpeg" | "image/webp" }
    > = [{ type: "text", text: promptText }];

    if (parsedImage && supportedImageMime) {
      contentParts.push({
        type: "image",
        data: parsedImage.base64,
        mime_type: effectiveMime as "image/png" | "image/jpeg" | "image/webp",
      });
    }

    const interaction = await Promise.race([
      ai.interactions.create({
        model: DEFAULT_MODEL,
        system_instruction:
          "Devuelve exclusivamente JSON válido conforme al esquema solicitado, calibrado a la realidad microempresarial peruana (INEI, MIDAGRI, SENAMHI, BCRP).",
        input: contentParts,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: EXTRACTION_JSON_SCHEMA,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini extraction timeout")), GEMINI_TIMEOUT_MS)
      ),
    ]);

    const rawJson = interaction.output_text;
    if (!rawJson) {
      return NextResponse.json(fallback, { status: 200 });
    }

    const parsed = JSON.parse(rawJson);
    const seasonalFactors: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      const val = Number(parsed?.seasonalFactors?.[String(m)]);
      seasonalFactors[m] =
        Number.isFinite(val) && val >= 0.3 && val <= 2.5
          ? val
          : fallback.profilePatch.seasonalFactors[m];
    }

    const numSales = Number(parsed?.baseMonthlySales);
    const numCogs = Number(parsed?.cogsRatio);
    const numFixed = Number(parsed?.fixedOperatingExpenses);
    const numTax = Number(parsed?.taxExpenseMonthly);
    const numFamily = Number(parsed?.familyBurden);
    const numInsurable = Number(parsed?.insurableAssetValue);
    const numFactor = Number(parsed?.recommendedFieldFactor);
    const numConfidence = Number(parsed?.confidence);

    const liveResponse: ExtractionResponse = {
      profilePatch: {
        name:
          typeof parsed?.name === "string" && parsed.name.trim()
            ? parsed.name.trim()
            : fallback.profilePatch.name,
        sector:
          typeof parsed?.sector === "string" && parsed.sector.trim()
            ? parsed.sector.trim()
            : fallback.profilePatch.sector,
        location:
          typeof parsed?.location === "string" && parsed.location.trim()
            ? parsed.location.trim()
            : fallback.profilePatch.location,
        baseMonthlySales:
          Number.isFinite(numSales) && numSales > 0
            ? numSales
            : fallback.profilePatch.baseMonthlySales,
        cogsRatio:
          Number.isFinite(numCogs) && numCogs > 0.1 && numCogs < 0.9
            ? numCogs
            : fallback.profilePatch.cogsRatio,
        fixedOperatingExpenses:
          Number.isFinite(numFixed) && numFixed >= 0
            ? numFixed
            : fallback.profilePatch.fixedOperatingExpenses,
        taxExpenseMonthly:
          Number.isFinite(numTax) && numTax >= 0
            ? numTax
            : fallback.profilePatch.taxExpenseMonthly,
        familyBurden:
          Number.isFinite(numFamily) && numFamily >= 0
            ? numFamily
            : fallback.profilePatch.familyBurden,
        insurableAssetValue:
          Number.isFinite(numInsurable) && numInsurable >= 0
            ? numInsurable
            : fallback.profilePatch.insurableAssetValue,
        seasonalFactors,
      },
      recommendedFieldFactor: Math.min(
        0.85,
        Math.max(
          0.35,
          Number.isFinite(numFactor) ? numFactor : fallback.recommendedFieldFactor
        )
      ),
      confidence: Math.min(
        0.99,
        Math.max(0.5, Number.isFinite(numConfidence) ? numConfidence : 0.9)
      ),
      extractedAssumptions: cleanStringList(
        parsed?.extractedAssumptions,
        fallback.extractedAssumptions
      ),
      detectedAnomalies: cleanStringList(
        parsed?.detectedAnomalies,
        fallback.detectedAnomalies
      ),
      source: "gemini-live",
      modelUsed: DEFAULT_MODEL,
    };

    return NextResponse.json(liveResponse, { status: 200 });
  } catch (err) {
    console.warn("[extract-business] Falling back to deterministic engine:", err);
    return NextResponse.json(fallback, { status: 200 });
  }
}
