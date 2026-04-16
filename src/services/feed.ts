import { getHypecastTestApi } from "../test-support";
import {
  normalizePotentialUrl,
  sanitizeImageUrl,
  sanitizeLinkUrl,
  sanitizeVideoUrl
} from "./security";
import type { FeedCast, FeedLoadOptions, FeedSnapshot, FeedSource } from "../types";

const FEED_SNAPSHOT_URL = `${import.meta.env.BASE_URL}farcaster-feed.json`;
const FEED_CACHE_KEY = "hypecast:feed-snapshot";
const FEED_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const NEYNAR_API_KEY_STORAGE_KEY = "hypecast:neynar-api-key";
const FALLBACK_NEYNAR_API_KEY = "F523CE9D-47C9-494D-954F-2C628D170E4A";
const PERSONALIZED_FEED_LIMIT = 20;
const FOLLOWING_CHANNEL_ID = "following";
const REALTIME_CASTS_PER_SOURCE = 3;

const REALTIME_SOURCES: Array<{ id: string; label: string; username: string; accentClass: string }> = [
  { id: "farcaster", label: "farcaster", username: "farcaster", accentClass: "accent-violet" },
  { id: "v", label: "v", username: "v", accentClass: "accent-live" },
  { id: "dwr", label: "dwr", username: "dwr", accentClass: "accent-orange" },
  { id: "base", label: "base", username: "base.base.eth", accentClass: "accent-teal" }
];

type UntrustedRecord = Record<string, any>;

function resolveDefaultNeynarApiKey(): string {
  const envKey = import.meta.env.VITE_NEYNAR_API_KEY?.trim();
  return envKey || FALLBACK_NEYNAR_API_KEY;
}

function isFeedSnapshot(value: unknown): value is FeedSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<FeedSnapshot>;

  return (
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.sources) &&
    Array.isArray(candidate.casts)
  );
}

function loadCachedSnapshot(): FeedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(FEED_CACHE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    return isFeedSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCachedSnapshot(snapshot: FeedSnapshot): void {
  try {
    window.localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function snapshotAgeMs(snapshot: FeedSnapshot): number {
  const generatedAtMs = Date.parse(snapshot.generatedAt);

  if (!Number.isFinite(generatedAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Date.now() - generatedAtMs;
}

function sanitizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstInitial(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 1).toUpperCase();
    }
  }

  return "H";
}

function extractNextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error("Could not find __NEXT_DATA__ in the Farcaster SSR page.");
  }

  return JSON.parse(match[1]);
}

function safeHostname(url: string | undefined): string | undefined {
  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return undefined;
  }

  try {
    return new URL(normalizedUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function normalizeUrl(url: string | undefined): string | undefined {
  return normalizePotentialUrl(url);
}

function looksLikeImageUrl(url: string | undefined): boolean {
  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return false;
  }

  try {
    const pathname = new URL(normalizedUrl).pathname;
    return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(pathname);
  } catch {
    return false;
  }
}

function looksLikeImageContentType(contentType: unknown): boolean {
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("image/");
}

function looksLikeVideoUrl(url: string | undefined): boolean {
  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return false;
  }

  try {
    const pathname = new URL(normalizedUrl).pathname;
    return /\.(m3u8|m4v|mov|mp4|ogg|ogv|webm)$/i.test(pathname);
  } catch {
    return false;
  }
}

function looksLikeVideoContentType(contentType: unknown): boolean {
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("video/");
}

function isLikelyPreviewImage(url: string | undefined): boolean {
  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return false;
  }

  try {
    const parsed = new URL(normalizedUrl);
    const pathname = parsed.pathname.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (pathname.endsWith(".ico")) {
      return false;
    }

    if (pathname.includes("/favicon")) {
      return false;
    }

    if (pathname.includes("/emoji/")) {
      return false;
    }

    if (hostname.includes("twimg.com") && pathname.includes("/emoji/")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizePublicMedia(cast: UntrustedRecord): FeedCast["media"] {
  const imageEmbed = cast?.embeds?.images?.[0];
  const videoEmbed = cast?.embeds?.videos?.[0];
  const urlEmbed = cast?.embeds?.urls?.[0]?.openGraph;
  const videoSrc = sanitizeVideoUrl(
    videoEmbed?.url ??
      videoEmbed?.media?.url ??
      videoEmbed?.media?.streamingUrl ??
      videoEmbed?.media?.sourceUrl
  );
  const videoPoster = sanitizeImageUrl(
    videoEmbed?.thumbnail?.url ??
      videoEmbed?.poster?.url ??
      videoEmbed?.previewImage?.url ??
      videoEmbed?.media?.thumbnailUrl
  );
  const imageSrc = sanitizeImageUrl(imageEmbed?.media?.staticRaster ?? imageEmbed?.url);
  const ogImage = sanitizeImageUrl(urlEmbed?.image);
  const safeUrlEmbedUrl = sanitizeLinkUrl(urlEmbed?.url);

  if (videoSrc) {
    return {
      kind: "video",
      src: videoSrc,
      href: videoSrc,
      posterSrc: videoPoster,
      alt: "Cast video",
      eyebrow: cast?.channel?.name,
      title: sanitizeText(cast?.text) || "Cast video",
      description: sanitizeText(cast?.text),
      showDetails: false
    };
  }

  if (imageSrc) {
    return {
      kind: "image",
      src: imageSrc,
      href: imageSrc,
      alt: imageEmbed.alt ?? imageEmbed.openGraph?.title ?? "Cast image",
      eyebrow: cast?.channel?.name,
      title: cast?.author?.displayName ?? cast?.author?.username ?? "Farcaster",
      description: sanitizeText(cast?.text),
      showDetails: false
    };
  }

  if (ogImage && isLikelyPreviewImage(ogImage)) {
    return {
      kind: "image",
      src: ogImage,
      href: safeUrlEmbedUrl,
      alt: urlEmbed.title ?? "Linked preview",
      eyebrow: urlEmbed.domain ?? cast?.channel?.name,
      title: sanitizeText(urlEmbed.title || urlEmbed.domain || "Linked preview"),
      description: sanitizeText(urlEmbed.description || urlEmbed.url || cast?.text),
      showDetails: true
    };
  }

  if (urlEmbed) {
    return {
      kind: "link",
      href: safeUrlEmbedUrl,
      eyebrow: urlEmbed.domain ?? cast?.channel?.name,
      title: sanitizeText(urlEmbed.title || urlEmbed.domain || "Linked preview"),
      description: sanitizeText(urlEmbed.description || urlEmbed.url || cast?.text)
    };
  }

  return undefined;
}

function normalizePublicCast(source: FeedSource, cast: UntrustedRecord): FeedCast | null {
  const text = sanitizeText(cast?.embeds?.processedCastText || cast?.text);

  if (!text) {
    return null;
  }

  const timestamp = Number(cast.timestamp);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return {
    id: String(cast.hash ?? `${source.id}-${timestamp}`),
    channel: source.id,
    authorFid: typeof cast.author?.fid === "number" ? cast.author.fid : undefined,
    authorName: cast.author?.displayName ?? source.displayName,
    authorHandle: cast.author?.username ?? source.username,
    authorInitial: firstInitial(cast.author?.displayName, cast.author?.username, source.displayName),
    authorAvatarUrl: sanitizeImageUrl(cast.author?.pfp?.url ?? source.pfpUrl),
    accentClass: source.accentClass,
    timestamp,
    contextLabel: cast.channel?.name ? `in ${cast.channel.name}` : `via ${source.label}`,
    text,
    permalink: typeof cast?.permalink === "string" ? sanitizeLinkUrl(cast.permalink) : undefined,
    replies: typeof cast.replies?.count === "number" ? cast.replies.count : undefined,
    recasts: typeof cast.recasts?.count === "number" ? cast.recasts.count : undefined,
    reactions: typeof cast.reactions?.count === "number" ? cast.reactions.count : undefined,
    media: normalizePublicMedia(cast)
  };
}

async function fetchSsrProfileHtml(username: string): Promise<string> {
  const originUrl = `https://ssr.farcaster.xyz/${username}`;
  const mirrors = [
    originUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(originUrl)}`,
    `https://r.jina.ai/http://ssr.farcaster.xyz/${username}`
  ];

  for (const url of mirrors) {
    try {
      const response = await fetch(url, {
        cache: "no-store"
      });

      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Try the next mirror.
    }
  }

  throw new Error(`Failed to fetch live Farcaster profile data for @${username}.`);
}

async function fetchRealtimeSource(sourceConfig: {
  id: string;
  label: string;
  username: string;
  accentClass: string;
}): Promise<{ source: FeedSource; casts: FeedCast[] }> {
  const html = await fetchSsrProfileHtml(sourceConfig.username);
  const nextData = extractNextData(html) as UntrustedRecord;
  const pageProps = nextData?.props?.pageProps;
  const user = pageProps?.user;
  const rawCasts =
    pageProps?.recentCasts?.length > 0 ? pageProps.recentCasts : (pageProps?.topCasts ?? []);

  if (!user || rawCasts.length === 0) {
    throw new Error(`Farcaster SSR page for ${sourceConfig.username} did not include casts.`);
  }

  const source: FeedSource = {
    id: sourceConfig.id,
    label: sourceConfig.label,
    username: user.username ?? sourceConfig.username,
    displayName: user.displayName ?? sourceConfig.label,
    pfpUrl: sanitizeImageUrl(user.pfp?.url),
    bio: user.profile?.bio?.text,
    accentClass: sourceConfig.accentClass
  };

  const casts = rawCasts
    .slice(0, REALTIME_CASTS_PER_SOURCE)
    .map((cast: UntrustedRecord) => normalizePublicCast(source, cast))
    .filter((cast: FeedCast | null): cast is FeedCast => cast !== null);

  return {
    source,
    casts
  };
}

async function fetchRealtimeFeedSnapshot(): Promise<FeedSnapshot> {
  const results = await Promise.all(REALTIME_SOURCES.map((source) => fetchRealtimeSource(source)));

  return {
    generatedAt: new Date().toISOString(),
    sources: results.map((result) => result.source),
    casts: results.flatMap((result) => result.casts).sort((left, right) => right.timestamp - left.timestamp),
    mode: "public",
    provider: "public-ssr"
  };
}

async function fetchBundledSnapshot(): Promise<FeedSnapshot> {
  const response = await fetch(FEED_SNAPSHOT_URL, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Feed snapshot request failed with ${response.status}.`);
  }

  const data = (await response.json()) as unknown;

  if (!isFeedSnapshot(data)) {
    throw new Error("Feed snapshot payload was malformed.");
  }

  return {
    ...data,
    mode: data.mode ?? "public",
    provider: data.provider ?? "bundled"
  };
}

function normalizeNeynarMedia(cast: UntrustedRecord): FeedCast["media"] {
  const embeds = Array.isArray(cast.embeds) ? cast.embeds.filter(Boolean) : [];

  const rankedMedia = embeds
    .map((embed) => normalizeNeynarEmbedMedia(embed as UntrustedRecord, cast))
    .filter((candidate): candidate is { media: FeedCast["media"]; score: number } => Boolean(candidate?.media))
    .sort((left, right) => right.score - left.score);

  return rankedMedia[0]?.media;
}

function normalizeNeynarEmbedMedia(
  embed: UntrustedRecord,
  cast: UntrustedRecord
): { media: FeedCast["media"]; score: number } | null {
  if (embed.cast?.author) {
    const embeddedTitle =
      embed.cast.author.display_name ?? embed.cast.author.username ?? `fid ${embed.cast.author.fid ?? "cast"}`;
    const embeddedHandle = embed.cast.author.username ? `@${embed.cast.author.username}` : "embedded cast";

    return {
      score: 1,
      media: {
        kind: "link",
        eyebrow: embeddedHandle,
        title: embeddedTitle,
        description: sanitizeText(embed.cast.text) || "Embedded cast"
      }
    };
  }

  const embedUrl = sanitizeLinkUrl(typeof embed.url === "string" ? embed.url : undefined);
  const metadata = embed.metadata ?? {};
  const html = metadata.html ?? {};
  const frame = metadata.frame ?? {};
  const directImage = looksLikeImageContentType(metadata.content_type) || Boolean(metadata.image);
  const directVideo = looksLikeVideoContentType(metadata.content_type) || Boolean(metadata.video);
  const directImageSrc = sanitizeImageUrl(
    typeof metadata.image === "string" ? metadata.image : embedUrl
  );
  const directVideoSrc = sanitizeVideoUrl(
    typeof metadata.video === "string" ? metadata.video : embedUrl
  );
  const frameImage = sanitizeImageUrl(
    typeof frame.image === "string"
      ? frame.image
      : typeof html?.fcFrame?.imageUrl === "string"
        ? html.fcFrame.imageUrl
        : typeof html?.fcFrame?.ogImageUrl === "string"
          ? html.fcFrame.ogImageUrl
          : typeof frame?.manifest?.frame?.og_image_url === "string"
            ? frame.manifest.frame.og_image_url
            : typeof frame?.manifest?.frame?.hero_image_url === "string"
              ? frame.manifest.frame.hero_image_url
              : typeof frame?.manifest?.miniapp?.og_image_url === "string"
                ? frame.manifest.miniapp.og_image_url
                : typeof frame?.manifest?.miniapp?.hero_image_url === "string"
                  ? frame.manifest.miniapp.hero_image_url
                : undefined
  );
  const ogImage = sanitizeImageUrl(
    typeof html?.ogImage?.[0]?.url === "string"
      ? html.ogImage[0].url
      : typeof html?.oembed?.thumbnail_url === "string"
        ? html.oembed.thumbnail_url
        : undefined
  );
  const ogVideo = sanitizeVideoUrl(
    typeof html?.ogVideo?.[0]?.url === "string"
      ? html.ogVideo[0].url
      : typeof html?.ogVideo?.url === "string"
        ? html.ogVideo.url
        : typeof html?.oembed?.video_url === "string"
          ? html.oembed.video_url
          : undefined
  );
  const title = sanitizeText(
    frame.title ||
      html?.fcFrame?.ogTitle ||
      html?.ogTitle ||
      html?.oembed?.title ||
      html?.oembed?.author_name ||
      embedUrl ||
      "Linked preview"
  );
  const description = sanitizeText(
    html?.ogDescription ||
      html?.fcFrame?.ogDescription ||
      cast.text ||
      html?.oembed?.author_name ||
      embedUrl ||
      title
  );
  const eyebrow = safeHostname(embedUrl);
  const fallbackEmbedImage = looksLikeImageUrl(embedUrl) ? sanitizeImageUrl(embedUrl) : undefined;
  const fallbackEmbedVideo = looksLikeVideoUrl(embedUrl) ? sanitizeVideoUrl(embedUrl) : undefined;
  const videoPoster = sanitizeImageUrl(
    typeof metadata.image === "string" ? metadata.image : frameImage ?? ogImage
  );
  const videoSrc = directVideo && directVideoSrc ? directVideoSrc : ogVideo ?? fallbackEmbedVideo;
  const imageSrc = directImage && directImageSrc
    ? directImageSrc
    : frameImage && isLikelyPreviewImage(frameImage)
      ? frameImage
      : ogImage && isLikelyPreviewImage(ogImage)
        ? ogImage
        : fallbackEmbedImage
          ? fallbackEmbedImage
          : undefined;

  if (videoSrc) {
    return {
      score: directVideo ? 5 : 4,
      media: {
        kind: "video",
        src: videoSrc,
        href: embedUrl ?? videoSrc,
        posterSrc: videoPoster,
        alt: title,
        eyebrow,
        title,
        description,
        showDetails: !directVideo
      }
    };
  }

  if (imageSrc) {
    return {
      score: directImage ? 4 : 3,
      media: {
        kind: "image",
        src: imageSrc,
        href: directImage ? embedUrl ?? imageSrc : embedUrl,
        alt: title,
        eyebrow,
        title,
        description,
        showDetails: !directImage
      }
    };
  }

  if (embedUrl) {
    return {
      score: 2,
      media: {
        kind: "link",
        href: embedUrl,
        eyebrow,
        title,
        description
      }
    };
  }

  return null;
}

function normalizeNeynarCast(cast: UntrustedRecord): FeedCast | null {
  const media = normalizeNeynarMedia(cast);
  const text = sanitizeText(cast.text);
  const timestamp = Date.parse(String(cast.timestamp ?? ""));

  if (!Number.isFinite(timestamp) || (!text && !media)) {
    return null;
  }

  const author = cast.author ?? {};
  const channel = cast.channel ?? {};

  return {
    id: String(cast.hash ?? `${author.fid ?? "cast"}-${timestamp}`),
    channel: FOLLOWING_CHANNEL_ID,
    authorFid: typeof author.fid === "number" ? author.fid : undefined,
    authorName: author.display_name ?? author.username ?? `fid ${author.fid ?? "unknown"}`,
    authorHandle: author.username ?? String(author.fid ?? "unknown"),
    authorInitial: firstInitial(author.display_name, author.username),
    authorAvatarUrl: sanitizeImageUrl(author.pfp_url),
    accentClass: "accent-live",
    timestamp,
    contextLabel: typeof channel.name === "string" ? `in ${channel.name}` : undefined,
    text: text || media?.description || media?.title || "Cast",
    permalink: sanitizeLinkUrl(typeof cast.permalink === "string" ? cast.permalink : cast.url),
    replies: typeof cast.replies?.count === "number" ? cast.replies.count : undefined,
    recasts: typeof cast.reactions?.recasts_count === "number" ? cast.reactions.recasts_count : undefined,
    reactions: typeof cast.reactions?.likes_count === "number" ? cast.reactions.likes_count : undefined,
    media
  };
}

async function fetchFollowingFeedSnapshot(fid: number, apiKey: string): Promise<FeedSnapshot> {
  const url = new URL("https://api.neynar.com/v2/farcaster/feed/following/");
  url.searchParams.set("fid", String(fid));
  url.searchParams.set("viewer_fid", String(fid));
  url.searchParams.set("limit", String(PERSONALIZED_FEED_LIMIT));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "x-api-key": apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Neynar following feed request failed with ${response.status}.`);
  }

  const data = (await response.json()) as UntrustedRecord;
  const casts = Array.isArray(data.casts)
    ? data.casts
        .map((cast: UntrustedRecord) => normalizeNeynarCast(cast))
        .filter((cast: FeedCast | null): cast is FeedCast => cast !== null)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    sources: [],
    casts,
    mode: "following",
    provider: "neynar",
    viewerFid: fid
  };
}

async function fetchCastByIdentifier(options: {
  identifier: string;
  type: "hash" | "url";
  apiKey: string;
  viewerFid?: number;
}): Promise<FeedCast> {
  const url = new URL("https://api.neynar.com/v2/farcaster/cast/");
  url.searchParams.set("identifier", options.identifier);
  url.searchParams.set("type", options.type);

  if (typeof options.viewerFid === "number") {
    url.searchParams.set("viewer_fid", String(options.viewerFid));
  }

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "x-api-key": options.apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Neynar cast lookup failed with ${response.status}.`);
  }

  const data = (await response.json()) as UntrustedRecord;
  const cast = normalizeNeynarCast(data.cast);

  if (!cast) {
    throw new Error("Neynar cast lookup returned a malformed cast.");
  }

  return cast;
}

function isMatchingPersonalizedSnapshot(snapshot: FeedSnapshot, fid: number): boolean {
  return snapshot.mode === "following" && snapshot.viewerFid === fid;
}

export function loadStoredNeynarApiKey(): string {
  try {
    return window.localStorage.getItem(NEYNAR_API_KEY_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function getDefaultNeynarApiKey(): string {
  return resolveDefaultNeynarApiKey();
}

export function getEffectiveNeynarApiKey(): string {
  return loadStoredNeynarApiKey() || getDefaultNeynarApiKey();
}

export function saveStoredNeynarApiKey(value: string): void {
  const nextValue = value.trim();

  if (!nextValue) {
    clearStoredNeynarApiKey();
    return;
  }

  try {
    window.localStorage.setItem(NEYNAR_API_KEY_STORAGE_KEY, nextValue);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export function clearStoredNeynarApiKey(): void {
  try {
    window.localStorage.removeItem(NEYNAR_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

export function hasStoredNeynarApiKey(): boolean {
  return loadStoredNeynarApiKey().length > 0;
}

export function hasEffectiveNeynarApiKey(): boolean {
  return getEffectiveNeynarApiKey().length > 0;
}

export async function loadFeedSnapshot(options: FeedLoadOptions = {}): Promise<FeedSnapshot> {
  const testApi = getHypecastTestApi();

  if (testApi?.loadFeedSnapshot) {
    return testApi.loadFeedSnapshot(options);
  }

  const cachedSnapshot = loadCachedSnapshot();
  const requestedNeynarApiKey = options.neynarApiKey?.trim();
  const defaultNeynarApiKey = getDefaultNeynarApiKey();
  const neynarApiKey = requestedNeynarApiKey || loadStoredNeynarApiKey() || defaultNeynarApiKey;
  const fid = options.fid;

  if (typeof fid === "number" && neynarApiKey) {
    if (
      cachedSnapshot &&
      isMatchingPersonalizedSnapshot(cachedSnapshot, fid) &&
      snapshotAgeMs(cachedSnapshot) <= FEED_CACHE_MAX_AGE_MS
    ) {
      return cachedSnapshot;
    }

    try {
      const followingSnapshot = await fetchFollowingFeedSnapshot(fid, neynarApiKey);
      saveCachedSnapshot(followingSnapshot);
      return followingSnapshot;
    } catch (error) {
      if (defaultNeynarApiKey && defaultNeynarApiKey !== neynarApiKey) {
        try {
          const fallbackSnapshot = await fetchFollowingFeedSnapshot(fid, defaultNeynarApiKey);
          saveCachedSnapshot(fallbackSnapshot);
          return fallbackSnapshot;
        } catch {
          // Fall through to the cached-snapshot and error paths below.
        }
      }

      if (cachedSnapshot && isMatchingPersonalizedSnapshot(cachedSnapshot, fid)) {
        return cachedSnapshot;
      }

      throw error;
    }
  }

  if (
    cachedSnapshot &&
    cachedSnapshot.mode !== "following" &&
    snapshotAgeMs(cachedSnapshot) <= FEED_CACHE_MAX_AGE_MS
  ) {
    return cachedSnapshot;
  }

  try {
    const realtimeSnapshot = await fetchRealtimeFeedSnapshot();
    saveCachedSnapshot(realtimeSnapshot);
    return realtimeSnapshot;
  } catch {
    if (cachedSnapshot) {
      return cachedSnapshot;
    }

    const bundledSnapshot = await fetchBundledSnapshot();
    saveCachedSnapshot(bundledSnapshot);
    return bundledSnapshot;
  }
}

export async function loadCastByIdentifier(options: {
  identifier: string;
  type: "hash" | "url";
  viewerFid?: number;
  neynarApiKey?: string;
}): Promise<FeedCast> {
  const requestedNeynarApiKey = options.neynarApiKey?.trim();
  const defaultNeynarApiKey = getDefaultNeynarApiKey();
  const neynarApiKey = requestedNeynarApiKey || loadStoredNeynarApiKey() || defaultNeynarApiKey;

  if (!neynarApiKey) {
    throw new Error("A Neynar API key is required to look up a cast.");
  }

  try {
    return await fetchCastByIdentifier({
      identifier: options.identifier,
      type: options.type,
      viewerFid: options.viewerFid,
      apiKey: neynarApiKey
    });
  } catch (error) {
    if (defaultNeynarApiKey && defaultNeynarApiKey !== neynarApiKey) {
      return fetchCastByIdentifier({
        identifier: options.identifier,
        type: options.type,
        viewerFid: options.viewerFid,
        apiKey: defaultNeynarApiKey
      });
    }

    throw error;
  }
}

export const __test__ = {
  isLikelyPreviewImage,
  looksLikeImageContentType,
  looksLikeVideoContentType,
  normalizeNeynarEmbedMedia,
  normalizeNeynarMedia,
  normalizePublicMedia
};
