const DISCOGS_API = "https://api.discogs.com";
const USER_AGENT = "DiscogsPhotoCollector/0.1 (+https://github.com/mrwuwei777/discogs-test)";

function getToken(): string {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    throw new Error("DISCOGS_TOKEN is not set. Add it to your .env.local file.");
  }
  return token;
}

async function discogsFetch(path: string, init?: RequestInit) {
  const url = path.startsWith("http") ? path : `${DISCOGS_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Discogs token=${getToken()}`,
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discogs API error ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export interface DiscogsSearchResult {
  id: number;
  title: string;
  year?: string;
  format?: string[];
  label?: string[];
  catno?: string;
  thumb?: string;
  cover_image?: string;
  resource_url: string;
  type: string;
  barcode?: string[];
}

const SEARCH_RESULT_LIMIT = "10";

export async function searchByBarcode(barcode: string): Promise<DiscogsSearchResult[]> {
  const data = await discogsFetch(
    `/database/search?barcode=${encodeURIComponent(barcode)}&type=release&per_page=${SEARCH_RESULT_LIMIT}`,
  );
  return data.results ?? [];
}

export async function searchByQuery(params: {
  q?: string;
  artist?: string;
  release_title?: string;
}): Promise<DiscogsSearchResult[]> {
  const search = new URLSearchParams({ type: "release", per_page: SEARCH_RESULT_LIMIT });
  if (params.q) search.set("q", params.q);
  if (params.artist) search.set("artist", params.artist);
  if (params.release_title) search.set("release_title", params.release_title);
  const data = await discogsFetch(`/database/search?${search.toString()}`);
  return data.results ?? [];
}

export async function getIdentity(): Promise<{ username: string; id: number }> {
  return discogsFetch("/oauth/identity");
}

export interface DiscogsReleaseDetail {
  id: number;
  title: string;
  artists?: { name: string }[];
  artists_sort?: string;
  year?: number;
  country?: string;
  released?: string;
  genres?: string[];
  styles?: string[];
  notes?: string;
  data_quality?: string;
  master_id?: number;
  images?: { uri: string; type: string }[];
  labels?: { name: string; catno: string }[];
  formats?: { name: string; qty: string; descriptions?: string[] }[];
  tracklist?: { position: string; title: string; duration: string }[];
  identifiers?: { type: string; value: string; description?: string }[];
  community?: { have: number; want: number; rating?: { average: number; count: number } };
}

export async function getRelease(releaseId: number): Promise<DiscogsReleaseDetail> {
  return discogsFetch(`/releases/${releaseId}`);
}

export interface DiscogsFolder {
  id: number;
  name: string;
  count: number;
}

export async function getFolders(username: string): Promise<DiscogsFolder[]> {
  const data = await discogsFetch(`/users/${encodeURIComponent(username)}/collection/folders`);
  return data.folders ?? [];
}

export async function getCollectionInstanceCount(
  username: string,
  releaseId: number,
): Promise<number> {
  const data = await discogsFetch(
    `/users/${encodeURIComponent(username)}/collection/releases/${releaseId}`,
  );
  return Array.isArray(data.releases) ? data.releases.length : 0;
}

export async function addReleaseToCollection(
  username: string,
  releaseId: number,
  folderId = 1,
): Promise<void> {
  await discogsFetch(
    `/users/${encodeURIComponent(username)}/collection/folders/${folderId}/releases/${releaseId}`,
    { method: "POST" },
  );
}
