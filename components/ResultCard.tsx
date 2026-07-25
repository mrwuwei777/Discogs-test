"use client";

import type { DiscogsSearchResult } from "@/lib/discogs";

export function ResultCard({
  result,
  onAdd,
  status,
}: {
  result: DiscogsSearchResult;
  onAdd: () => void;
  status: "idle" | "adding" | "added" | "error";
}) {
  return (
    <div className="result-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="result-thumb"
        src={result.thumb || result.cover_image || ""}
        alt=""
        loading="lazy"
      />
      <div className="result-info">
        <div className="result-title">{result.title}</div>
        <div className="result-meta">
          {[result.year, result.format?.join(", "), result.label?.join(", "), result.catno]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <button onClick={onAdd} disabled={status === "adding" || status === "added"}>
        {status === "added" ? "Added ✓" : status === "adding" ? "Adding…" : "Add"}
      </button>
    </div>
  );
}
