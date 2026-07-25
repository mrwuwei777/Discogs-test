"use client";

import type { DiscogsReleaseDetail, DiscogsSearchResult } from "@/lib/discogs";

export function ResultCard({
  result,
  onAdd,
  status,
  expanded,
  onToggleExpand,
  details,
  detailsLoading,
  detailsError,
}: {
  result: DiscogsSearchResult;
  onAdd: () => void;
  status: "idle" | "adding" | "added" | "error";
  expanded: boolean;
  onToggleExpand: () => void;
  details: DiscogsReleaseDetail | null;
  detailsLoading: boolean;
  detailsError: string | null;
}) {
  return (
    <div className="result-card-wrapper">
      <div className="result-card" onClick={onToggleExpand} role="button" tabIndex={0}>
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
          <div className="result-expand-hint">{expanded ? "Hide details ▲" : "View details ▼"}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          disabled={status === "adding" || status === "added"}
        >
          {status === "added" ? "Added ✓" : status === "adding" ? "Adding…" : "Add"}
        </button>
      </div>

      {expanded && (
        <div className="result-detail">
          {detailsLoading && <p className="status">Loading details…</p>}
          {detailsError && <p className="error">{detailsError}</p>}
          {details && (
            <>
              {details.images && details.images[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="result-detail-image" src={details.images[0].uri} alt="" />
              )}
              <div className="result-detail-meta">
                {details.country && <div>Country: {details.country}</div>}
                {details.released && <div>Released: {details.released}</div>}
                {details.genres && details.genres.length > 0 && (
                  <div>Genres: {details.genres.join(", ")}</div>
                )}
                {details.styles && details.styles.length > 0 && (
                  <div>Styles: {details.styles.join(", ")}</div>
                )}
                {details.labels && details.labels.length > 0 && (
                  <div>
                    Label:{" "}
                    {details.labels.map((l) => `${l.name} (${l.catno})`).join(", ")}
                  </div>
                )}
                {details.formats && details.formats.length > 0 && (
                  <div>
                    Format:{" "}
                    {details.formats
                      .map((f) => [f.name, f.qty !== "1" ? `x${f.qty}` : null, ...(f.descriptions ?? [])].filter(Boolean).join(" "))
                      .join(", ")}
                  </div>
                )}
              </div>
              {details.tracklist && details.tracklist.length > 0 && (
                <ol className="tracklist">
                  {details.tracklist.map((track, i) => (
                    <li key={`${track.position}-${i}`}>
                      <span className="track-position">{track.position}</span>
                      <span className="track-title">{track.title}</span>
                      {track.duration && <span className="track-duration">{track.duration}</span>}
                    </li>
                  ))}
                </ol>
              )}
              {details.notes && <p className="result-detail-notes">{details.notes}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
