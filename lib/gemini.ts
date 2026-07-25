import { GoogleGenAI } from "@google/genai";

export interface IdentifiedRecord {
  artist?: string;
  title?: string;
  format?: string;
  year?: string;
  label?: string;
  catalogNumber?: string;
  barcode?: string;
  confidence: "high" | "medium" | "low";
  notes?: string;
}

const SYSTEM_PROMPT = `You identify vinyl/CD records from a photo of their sleeve, cover, or label for lookup on Discogs.
Read any visible text (artist, album/release title, label name, catalogue number, barcode, year/pressing info).
If you cannot read something, use null for that field. "confidence" reflects how sure you are of the artist+title.`;

// Discogs search fields don't handle stray punctuation/symbols well (quotes,
// asterisks, em-dashes, etc. that vision OCR sometimes emits), so strip
// anything that isn't a letter, number, or space before it's used to query.
function sanitizeText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeBarcode(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9A-Za-z]/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    artist: { type: "string", nullable: true },
    title: { type: "string", nullable: true },
    format: { type: "string", nullable: true },
    year: { type: "string", nullable: true },
    label: { type: "string", nullable: true },
    catalogNumber: { type: "string", nullable: true },
    barcode: { type: "string", nullable: true },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string", nullable: true },
  },
  required: ["confidence"],
};

export async function identifyRecordFromImage(
  base64Image: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<IdentifiedRecord> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Add it to your .env.local file.");
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mediaType, data: base64Image } },
          { text: "Identify this record and return the JSON object described in your instructions." },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No text response from Gemini");
  }

  let parsed: IdentifiedRecord;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Could not parse Gemini response as JSON: ${text}`);
  }

  return {
    ...parsed,
    artist: sanitizeText(parsed.artist),
    title: sanitizeText(parsed.title),
    format: sanitizeText(parsed.format),
    year: sanitizeText(parsed.year),
    label: sanitizeText(parsed.label),
    catalogNumber: sanitizeText(parsed.catalogNumber),
    barcode: sanitizeBarcode(parsed.barcode),
  };
}
