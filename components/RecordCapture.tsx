"use client";

import { useRef, useState } from "react";
import type { DiscogsPriceStats, DiscogsReleaseDetail, DiscogsSearchResult } from "@/lib/discogs";
import type { IdentifiedRecord } from "@/lib/gemini";
import { ResultCard } from "./ResultCard";

type Stage =
  | "idle"
  | "scanning-barcode"
  | "identifying"
  | "review"
  | "searching"
  | "results"
  | "no-match";

interface ReviewFields {
  artist: string;
  title: string;
  label: string;
  catalogNumber: string;
}

const EMPTY_REVIEW_FIELDS: ReviewFields = { artist: "", title: "", label: "", catalogNumber: "" };

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

async function fetchSearchResults(params: URLSearchParams): Promise<DiscogsSearchResult[]> {
  const res = await fetch(`/api/discogs/search?${params.toString()}`);
  const data = await parseJsonResponse(res);
  if (data.error) throw new Error(data.error);
  return data.results;
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [releaseDetails, setReleaseDetails] = useState<Record<number, DiscogsReleaseDetail>>({});
  const [detailsLoading, setDetailsLoading] = useState<Record<number, boolean>>({});
  const [detailsError, setDetailsError] = useState<Record<number, string>>({});
  const [ownedMap, setOwnedMap] = useState<Record<number, number>>({});
  const [priceMap, setPriceMap] = useState<Record<number, DiscogsPriceStats | null>>({});
  const [reviewFields, setReviewFields] = useState<ReviewFields>(EMPTY_REVIEW_FIELDS);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  async function checkOwnership(resultsList: DiscogsSearchResult[]) {
    if (resultsList.length === 0) return;
    try {
      const ids = resultsList.map((r) => r.id).join(",");
      const res = await fetch(`/api/discogs/collection-status?releaseIds=${ids}`);
      const data = await parseJsonResponse(res);
      if (data.owned) {
        setOwnedMap((prev) => ({ ...prev, ...data.owned }));
      }
    } catch {
      // Non-critical — skip silently if the ownership check fails.
    }
  }

  async function checkPrices(resultsList: DiscogsSearchResult[]) {
    if (resultsList.length === 0) return;
    try {
      const ids = resultsList.map((r) => r.id).join(",");
      const res = await fetch(`/api/discogs/price-status?releaseIds=${ids}`);
      const data = await parseJsonResponse(res);
      if (data.prices) {
        setPriceMap((prev) => ({ ...prev, ...data.prices }));
      }
    } catch {
      // Non-critical — skip silently if the price check fails.
    }
  }

  async function toggleExpand(releaseId: number) {
    if (expandedId === releaseId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(releaseId);
    if (releaseDetails[releaseId] || detailsLoading[releaseId]) return;

    setDetailsLoading((prev) => ({ ...prev, [releaseId]: true }));
    setDetailsError((prev) => {
      const next = { ...prev };
      delete next[releaseId];
      return next;
    });
    try {
      const res = await fetch(`/api/discogs/release/${releaseId}`);
      const data = await parseJsonResponse(res);
      if (data.error) throw new Error(data.error);
      setReleaseDetails((prev) => ({ ...prev, [releaseId]: data }));
    } catch (err) {
      setDetailsError((prev) => ({
        ...prev,
        [releaseId]: err instanceof Error ? err.message : "Could not load details",
      }));
    } finally {
      setDetailsLoading((prev) => ({ ...prev, [releaseId]: false }));
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setIdentified(null);
    setResults([]);
    setAddStatus({});
    setExpandedId(null);
    setReleaseDetails({});
    setDetailsLoading({});
    setDetailsError({});
    setOwnedMap({});
    setPriceMap({});
    setReviewFields(EMPTY_REVIEW_FIELDS);

    try {
      const rawDataUrl = await fileToDataUrl(file);
      const dataUrl = await shrinkImage(rawDataUrl);
      setImageUrl(dataUrl);

      setStage("scanning-barcode");
      const barcode = await scanBarcode(dataUrl);

      if (barcode) {
        setStage("searching");
        const barcodeResults = await fetchSearchResults(new URLSearchParams({ barcode }));
        if (barcodeResults.length > 0) {
          setResults(barcodeResults);
          setStage("results");
          checkOwnership(barcodeResults);
          checkPrices(barcodeResults);
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
      setReviewFields({
        artist: identifiedRecord.artist ?? "",
        title: identifiedRecord.title ?? "",
        label: identifiedRecord.label ?? "",
        catalogNumber: identifiedRecord.catalogNumber ?? "",
      });
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStage("idle");
    }
  }

  async function runSearch() {
    setError(null);
    const params = new URLSearchParams();
    if (reviewFields.artist.trim()) params.set("artist", reviewFields.artist.trim());
    if (reviewFields.title.trim()) params.set("release_title", reviewFields.title.trim());
    if (reviewFields.label.trim()) params.set("label", reviewFields.label.trim());
    if (reviewFields.catalogNumber.trim()) params.set("catno", reviewFields.catalogNumber.trim());

    if ([...params.keys()].length === 0) {
      setError("Enter at least one field to search with.");
      return;
    }

    setStage("searching");
    try {
      const searchResults = await fetchSearchResults(params);
      setResults(searchResults);
      setStage(searchResults.length > 0 ? "results" : "no-match");
      checkOwnership(searchResults);
      checkPrices(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStage("review");
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
      setOwnedMap((prev) => ({ ...prev, [releaseId]: (prev[releaseId] ?? 0) + 1 }));
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
    setExpandedId(null);
    setReleaseDetails({});
    setDetailsLoading({});
    setDetailsError({});
    setOwnedMap({});
    setPriceMap({});
    setReviewFields(EMPTY_REVIEW_FIELDS);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }

  const busy = stage === "scanning-barcode" || stage === "identifying" || stage === "searching";

  const activeSearchFields = [
    reviewFields.artist.trim() && { label: "artist", value: reviewFields.artist.trim() },
    reviewFields.title.trim() && { label: "release_title", value: reviewFields.title.trim() },
    reviewFields.label.trim() && { label: "label", value: reviewFields.label.trim() },
    reviewFields.catalogNumber.trim() && { label: "catno", value: reviewFields.catalogNumber.trim() },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div>
      <div className="restart-bar">
        <button className="secondary" onClick={reset}>
          ↺ Restart
        </button>
      </div>

      {!imageUrl && (
        <div className="capture-box">
          <p>Take a photo of the record cover, label, or barcode.</p>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ flex: 1 }} onClick={() => cameraInputRef.current?.click()}>
              Use camera
            </button>
            <button
              className="secondary"
              style={{ flex: 1 }}
              onClick={() => galleryInputRef.current?.click()}
            >
              Choose photo
            </button>
          </div>
        </div>
      )}

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Captured record" className="preview" />
      )}

      {stage === "scanning-barcode" && <p className="status">Scanning for a barcode…</p>}
      {stage === "identifying" && <p className="status">Reading the cover with Gemini…</p>}
      {stage === "searching" && !identified && <p className="status">Searching Discogs…</p>}

      {identified && (identified.artist || identified.title) && (
        <div className="identified-box">
          <strong>
            {identified.artist ?? "Unknown artist"} — {identified.title ?? "Unknown title"}
          </strong>
          {identified.format && <div>Format: {identified.format}</div>}
          {identified.notes && <div style={{ color: "var(--muted)" }}>{identified.notes}</div>}
        </div>
      )}

      {(stage === "review" || stage === "searching") && identified && (
        <div className="review-box">
          <h2>Review search terms</h2>
          <p className="status">
            Edit any field before searching. Fewer fields cast a wider net; more fields narrow it down —
            clear a field if Discogs isn't finding a match.
          </p>

          <div className="field-group">
            <label htmlFor="review-artist">Artist</label>
            <input
              id="review-artist"
              type="text"
              value={reviewFields.artist}
              onChange={(e) => setReviewFields((prev) => ({ ...prev, artist: e.target.value }))}
            />
          </div>
          <div className="field-group">
            <label htmlFor="review-title">Release title</label>
            <input
              id="review-title"
              type="text"
              value={reviewFields.title}
              onChange={(e) => setReviewFields((prev) => ({ ...prev, title: e.target.value }))}
            />
          </div>
          <div className="field-group">
            <label htmlFor="review-label">Label</label>
            <input
              id="review-label"
              type="text"
              value={reviewFields.label}
              onChange={(e) => setReviewFields((prev) => ({ ...prev, label: e.target.value }))}
            />
          </div>
          <div className="field-group">
            <label htmlFor="review-catno">Catalogue number</label>
            <input
              id="review-catno"
              type="text"
              value={reviewFields.catalogNumber}
              onChange={(e) => setReviewFields((prev) => ({ ...prev, catalogNumber: e.target.value }))}
            />
          </div>

          <div className="query-preview">
            {activeSearchFields.length > 0
              ? `Discogs search will use: ${activeSearchFields
                  .map((f) => `${f.label}="${f.value}"`)
                  .join(", ")}`
              : "No fields set — add at least one before searching."}
          </div>

          <button onClick={runSearch} disabled={stage === "searching"} style={{ width: "100%" }}>
            {stage === "searching" ? "Searching…" : "Search Discogs"}
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {stage === "no-match" && (
        <div>
          <p className="status">No matches found on Discogs. Try adjusting the search terms below.</p>
          <button className="secondary" onClick={() => setStage("review")} style={{ width: "100%" }}>
            ← Edit search terms
          </button>
        </div>
      )}

      {results.map((result) => (
        <ResultCard
          key={result.id}
          result={result}
          status={addStatus[result.id] ?? "idle"}
          onAdd={() => handleAdd(result.id)}
          expanded={expandedId === result.id}
          onToggleExpand={() => toggleExpand(result.id)}
          details={releaseDetails[result.id] ?? null}
          detailsLoading={detailsLoading[result.id] ?? false}
          detailsError={detailsError[result.id] ?? null}
          ownedCount={ownedMap[result.id] ?? 0}
          price={priceMap[result.id] ?? null}
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
