"use client";

import { useState } from "react";
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
  ownedCount,
}: {
  result: DiscogsSearchResult;
  onAdd: () => void;
  status: "idle" | "adding" | "added" | "error";
  expanded: boolean;
  onToggleExpand: () => void;
  details: DiscogsReleaseDetail | null;
  detailsLoading: boolean;
  detailsError: string | null;
  ownedCount: number;
}) {
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const owned = ownedCount > 0;

  return (
    <div className={`result-card-wrapper${owned ? " owned" : ""}`}>
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
          {owned && (
            <div className="owned-badge">
              ✓ In your collection{ownedCount > 1 ? ` (${ownedCount})` : ""}
            </div>
          )}
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
          {owned && (
            <p className="owned-banner">
              You already have this release in your collection
              {ownedCount > 1 ? ` — ${ownedCount} copies` : ""}.
            </p>
          )}
          {details && (
            <>
              {details.images && details.images.length > 0 && (
                <div className="result-detail-gallery">
                  {details.images.map((image, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={image.uri}
                      alt=""
                      loading="lazy"
                      onClick={() => setLightboxUri(image.uri)}
                    />
                  ))}
                </div>
              )}
              <div className="result-detail-meta">
                {details.artists && details.artists.length > 0 && (
                  <div>Artist: {details.artists.map((a) => a.name).join(", ")}</div>
                )}
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
                    Label: {details.labels.map((l) => l.name).join(", ")}
                  </div>
                )}
                {details.labels && details.labels.length > 0 && (
                  <div>
                    Catalog #: {details.labels.map((l) => l.catno).filter(Boolean).join(", ")}
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
                {details.identifiers && details.identifiers.length > 0 && (
                  <div>
                    {details.identifiers
                      .map((id) => `${id.description || id.type}: ${id.value}`)
                      .join(" · ")}
                  </div>
                )}
                {details.community && (
                  <div>
                    Collection stats: {details.community.have} have, {details.community.want} want
                    {details.community.rating && details.community.rating.count > 0
                      ? ` · rated ${details.community.rating.average.toFixed(2)}/5 (${details.community.rating.count})`
                      : ""}
                  </div>
                )}
                {details.data_quality && <div>Data quality: {details.data_quality}</div>}
                {details.master_id && <div>Master release ID: {details.master_id}</div>}
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

      {lightboxUri && (
        <div className="lightbox" onClick={() => setLightboxUri(null)}>
          <button className="lightbox-close" onClick={() => setLightboxUri(null)} aria-label="Close">
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUri} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
