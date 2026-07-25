import Anthropic from "@anthropic-ai/sdk";

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
Respond with ONLY a JSON object, no markdown fences, matching this shape:
{"artist": string|null, "title": string|null, "format": string|null, "year": string|null, "label": string|null, "catalogNumber": string|null, "barcode": string|null, "confidence": "high"|"medium"|"low", "notes": string|null}
If you cannot read something, use null for that field. "confidence" reflects how sure you are of the artist+title.`;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export async function identifyRecordFromImage(
  base64Image: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<IdentifiedRecord> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to your .env.local file.");
  }
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Image },
          },
          {
            type: "text",
            text: "Identify this record and return the JSON object described in your instructions.",
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  try {
    return JSON.parse(stripCodeFence(textBlock.text));
  } catch {
    throw new Error(`Could not parse Claude response as JSON: ${textBlock.text}`);
  }
}
