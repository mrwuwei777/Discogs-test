"use client";

import { useRef, useState } from "react";
import type { DiscogsSearchResult } from "@/lib/discogs";
import type { IdentifiedRecord } from "@/lib/gemini";
import { ResultCard } from "./ResultCard";

type Stage =
  | "idle"
  | "scanning-barcode"
  | "identifying"
  | "searching"
  | "results"
  | "no-match";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Phone camera photos can be several MB; shrink + re-encode as JPEG so the
// base64 payload stays well under serverless request body size limits.
function shrinkImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported on this browser"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error("Could not load the photo for resizing"));
    img.src = dataUrl;
  });
}

async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      res.ok
        ? "Server returned an unexpected response"
        : `Request failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
}

async function scanBarcode(dataUrl: string): Promise<string | null> {
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    const result = await Promise.race([reader.decodeFromImageUrl(dataUrl), timeout]);
    return result ? result.getText() : null;
  } catch {
    return null;
  }
}

export function RecordCapture() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [identified, setIdentified] = useState<IdentifiedRecord | null>(null);
  const [results, setResults] = useState<DiscogsSearchResult[]>([]);
  const [addStatus, setAddStatus] = useState<Record<number, "idle" | "adding" | "added" | "error">>({});
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setIdentified(null);
    setResults([]);
    setAddStatus({});

    try {
      const rawDataUrl = await fileToDataUrl(file);
      const dataUrl = await shrinkImage(rawDataUrl);
      setImageUrl(dataUrl);

      setStage("scanning-barcode");
      const barcode = await scanBarcode(dataUrl);

      if (barcode) {
        setStage("searching");
        const res = await fetch(`/api/discogs/search?barcode=${encodeURIComponent(barcode)}`);
        const data = await parseJsonResponse(res);
        if (data.error) throw new Error(data.error);
        if (data.results.length > 0) {
          setResults(data.results);
          setStage("results");
          return;
        }
      }

      setStage("identifying");
      const base64 = dataUrl.split(",")[1];
      const identifyRes = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }),
      });
      const identifiedRecord: IdentifiedRecord = await parseJsonResponse(identifyRes);
      if ((identifiedRecord as unknown as { error?: string }).error) {
        throw new Error((identifiedRecord as unknown as { error: string }).error);
      }
      setIdentified(identifiedRecord);

      if (!identifiedRecord.artist && !identifiedRecord.title) {
        setStage("no-match");
        return;
      }

      setStage("searching");
      const q = [identifiedRecord.artist, identifiedRecord.title].filter(Boolean).join(" ");
      const searchRes = await fetch(`/api/discogs/search?q=${encodeURIComponent(q)}`);
      const searchData = await parseJsonResponse(searchRes);
      if (searchData.error) throw new Error(searchData.error);

      setResults(searchData.results);
      setStage(searchData.results.length > 0 ? "results" : "no-match");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStage("idle");
    }
  }

  async function handleAdd(releaseId: number) {
    setAddStatus((prev) => ({ ...prev, [releaseId]: "adding" }));
    try {
      const res = await fetch("/api/discogs/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      const data = await parseJsonResponse(res);
      if (data.error) throw new Error(data.error);
      setAddStatus((prev) => ({ ...prev, [releaseId]: "added" }));
    } catch (err) {
      setAddStatus((prev) => ({ ...prev, [releaseId]: "error" }));
      setError(err instanceof Error ? err.message : "Could not add to collection");
    }
  }

  function reset() {
    setImageUrl(null);
    setStage("idle");
    setIdentified(null);
    setResults([]);
    setAddStatus({});
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = stage === "scanning-barcode" || stage === "identifying" || stage === "searching";

  return (
    <div>
      {!imageUrl && (
        <div className="capture-box">
          <p>Take a photo of the record cover, label, or barcode.</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <button onClick={() => inputRef.current?.click()}>Take / choose photo</button>
        </div>
      )}

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Captured record" className="preview" />
      )}

      {stage === "scanning-barcode" && <p className="status">Scanning for a barcode…</p>}
      {stage === "identifying" && <p className="status">Reading the cover with Gemini…</p>}
      {stage === "searching" && <p className="status">Searching Discogs…</p>}

      {identified && (identified.artist || identified.title) && (
        <div className="identified-box">
          <strong>
            {identified.artist ?? "Unknown artist"} — {identified.title ?? "Unknown title"}
          </strong>
          {identified.format && <div>Format: {identified.format}</div>}
          {identified.notes && <div style={{ color: "var(--muted)" }}>{identified.notes}</div>}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {stage === "no-match" && (
        <p className="status">No matches found on Discogs. Try a clearer photo of the cover or barcode.</p>
      )}

      {results.map((result) => (
        <ResultCard
          key={result.id}
          result={result}
          status={addStatus[result.id] ?? "idle"}
          onAdd={() => handleAdd(result.id)}
        />
      ))}

      {imageUrl && !busy && (
        <button className="secondary" onClick={reset} style={{ marginTop: 8, width: "100%" }}>
          Scan another record
        </button>
      )}
    </div>
  );
}
