import type { FeedCast } from "../types";
import { normalizePotentialUrl, sanitizeLinkUrl } from "./security";

export interface CastRoute {
  castId: string;
  fid?: number;
}

export function buildCastRouteUrl(baseUrl: string, cast: FeedCast): string {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("cast", cast.id);

  if (typeof cast.authorFid === "number") {
    url.searchParams.set("fid", String(cast.authorFid));
  }

  return url.toString();
}

export function parseCastRouteFromLocation(locationLike: {
  href: string;
  search: string;
  hash: string;
}): CastRoute | null {
  const absoluteUrl = new URL(locationLike.href);
  const directSearchRoute = parseRouteSearchParams(new URLSearchParams(locationLike.search), absoluteUrl.origin);

  if (directSearchRoute) {
    return directSearchRoute;
  }

  const hash = locationLike.hash.trim();

  if (!hash) {
    return null;
  }

  if (hash.startsWith("#?")) {
    return parseRouteSearchParams(new URLSearchParams(hash.slice(2)), absoluteUrl.origin);
  }

  if (hash.startsWith("#/casts/")) {
    const castId = decodeURIComponent(hash.slice("#/casts/".length)).trim();
    return castId ? { castId } : null;
  }

  if (hash.startsWith("#cast=")) {
    const castId = decodeURIComponent(hash.slice("#cast=".length)).trim();
    return castId ? { castId } : null;
  }

  const externalRoute = parseCastRouteInput(hash.slice(1), absoluteUrl.origin);
  return externalRoute;
}

function parseRouteSearchParams(searchParams: URLSearchParams, origin: string): CastRoute | null {
  const castId =
    searchParams.get("cast")?.trim() ??
    searchParams.get("castId")?.trim() ??
    searchParams.get("hash")?.trim() ??
    searchParams.get("castHash")?.trim();

  if (castId) {
    return {
      castId,
      fid: parseOptionalFid(searchParams.get("fid"))
    };
  }

  const urlParam = searchParams.get("url");

  if (!urlParam) {
    return null;
  }

  return parseCastRouteInput(urlParam, origin);
}

function parseCastRouteInput(value: string, origin: string): CastRoute | null {
  const normalizedValue = normalizePotentialUrl(value);

  if (!normalizedValue) {
    return null;
  }

  const customSchemeRoute = parseCustomSchemeRoute(normalizedValue);

  if (customSchemeRoute) {
    return customSchemeRoute;
  }

  const safeUrl = sanitizeLinkUrl(normalizedValue);

  if (!safeUrl) {
    return null;
  }

  const parsed = new URL(safeUrl, origin);

  if (parsed.origin === origin) {
    const nestedSearchRoute = parseRouteSearchParams(parsed.searchParams, origin);

    if (nestedSearchRoute) {
      return nestedSearchRoute;
    }
  }

  const conversationHash = parsed.pathname.match(/\/~\/conversations\/([^/?#]+)/i)?.[1];

  if (conversationHash) {
    return {
      castId: decodeURIComponent(conversationHash),
      fid: parseOptionalFid(parsed.searchParams.get("fid"))
    };
  }

  const pathnameSegments = parsed.pathname.split("/").filter(Boolean);
  const candidateHash = pathnameSegments.at(-1);

  if (!candidateHash || pathnameSegments.length < 2) {
    return null;
  }

  return {
    castId: decodeURIComponent(candidateHash),
    fid: parseOptionalFid(parsed.searchParams.get("fid"))
  };
}

function parseCustomSchemeRoute(value: string): CastRoute | null {
  const match = value.match(/^(?:warpcast|farcaster):\/\/casts\/(\d+)\/([^/?#]+)/i);

  if (!match) {
    return null;
  }

  return {
    fid: Number(match[1]),
    castId: decodeURIComponent(match[2])
  };
}

function parseOptionalFid(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
