"use client";

import { useRef, useState } from "react";
import type { DiscogsSearchResult } from "@/lib/discogs";
import type { IdentifiedRecord } from "@/lib/anthropic";
import { ResultCard } from "./ResultCard";

type Stage =
  | "idle"
  | "scanning-barcode"
  | "identifying"
  | "searching"
  | "results"
  | "no-match";

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

    const dataUrl = await fileToDataUrl(file);
    setImageUrl(dataUrl);

    try {
      setStage("scanning-barcode");
      const barcode = await scanBarcode(dataUrl);

      if (barcode) {
        setStage("searching");
        const res = await fetch(`/api/discogs/search?barcode=${encodeURIComponent(barcode)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.results.length > 0) {
          setResults(data.results);
          setStage("results");
          return;
        }
      }

      setStage("identifying");
      const mediaType = ALLOWED_MEDIA_TYPES.has(file.type) ? file.type : "image/jpeg";
      const base64 = dataUrl.split(",")[1];
      const identifyRes = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const identifiedRecord: IdentifiedRecord = await identifyRes.json();
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
      const searchData = await searchRes.json();
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
      const data = await res.json();
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
            capture="environment"
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
      {stage === "identifying" && <p className="status">Reading the cover with Claude…</p>}
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
