import { getHypecastTestApi } from "../test-support";
import type { FeedCast, FeedLoadOptions, FeedSnapshot, FeedSource } from "../types";

const FEED_SNAPSHOT_URL = `${import.meta.env.BASE_URL}farcaster-feed.json`;
const FEED_CACHE_KEY = "hypecast:feed-snapshot";
const FEED_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const NEYNAR_API_KEY_STORAGE_KEY = "hypecast:neynar-api-key";
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
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function looksLikeImageUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const pathname = new URL(url).pathname;
    return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(pathname);
  } catch {
    return false;
  }
}

function normalizePublicMedia(cast: UntrustedRecord): FeedCast["media"] {
  const imageEmbed = cast?.embeds?.images?.[0];
  const urlEmbed = cast?.embeds?.urls?.[0]?.openGraph;

  if (imageEmbed?.media?.staticRaster || imageEmbed?.url) {
    return {
      kind: "image",
      src: imageEmbed.media?.staticRaster ?? imageEmbed.url,
      alt: imageEmbed.alt ?? imageEmbed.openGraph?.title ?? "Cast image",
      eyebrow: cast?.channel?.name,
      title: cast?.author?.displayName ?? cast?.author?.username ?? "Farcaster",
      description: sanitizeText(cast?.text)
    };
  }

  if (urlEmbed?.image) {
    return {
      kind: "image",
      src: urlEmbed.image,
      alt: urlEmbed.title ?? "Linked preview",
      eyebrow: urlEmbed.domain ?? cast?.channel?.name,
      title: sanitizeText(urlEmbed.title || urlEmbed.domain || "Linked preview"),
      description: sanitizeText(urlEmbed.description || urlEmbed.url || cast?.text)
    };
  }

  if (urlEmbed) {
    return {
      kind: "link",
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
    authorName: cast.author?.displayName ?? source.displayName,
    authorHandle: cast.author?.username ?? source.username,
    authorInitial: firstInitial(cast.author?.displayName, cast.author?.username, source.displayName),
    authorAvatarUrl: cast.author?.pfp?.url ?? source.pfpUrl,
    accentClass: source.accentClass,
    timestamp,
    contextLabel: cast.channel?.name ? `in ${cast.channel.name}` : `via ${source.label}`,
    text,
    permalink: typeof cast?.permalink === "string" ? cast.permalink : undefined,
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
    pfpUrl: user.pfp?.url,
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
  const embed = Array.isArray(cast.embeds) ? cast.embeds.find(Boolean) : undefined;

  if (!embed) {
    return undefined;
  }

  if (embed.cast?.author) {
    const embeddedTitle =
      embed.cast.author.display_name ?? embed.cast.author.username ?? `fid ${embed.cast.author.fid ?? "cast"}`;
    const embeddedHandle = embed.cast.author.username ? `@${embed.cast.author.username}` : "embedded cast";

    return {
      kind: "link",
      eyebrow: embeddedHandle,
      title: embeddedTitle,
      description: sanitizeText(embed.cast.text) || "Embedded cast"
    };
  }

  const embedUrl = typeof embed.url === "string" ? embed.url : undefined;
  const metadata = embed.metadata;
  const frameImage =
    typeof metadata?.frame?.image === "string"
      ? metadata.frame.image
      : typeof metadata?.html?.fcFrame?.imageUrl === "string"
        ? metadata.html.fcFrame.imageUrl
        : undefined;
  const ogImage =
    typeof metadata?.html?.ogImage?.[0]?.url === "string" ? metadata.html.ogImage[0].url : undefined;
  const title = sanitizeText(metadata?.frame?.title || metadata?.html?.ogTitle || embedUrl || "Linked preview");
  const description = sanitizeText(metadata?.html?.ogDescription || embedUrl || cast.text || title);
  const eyebrow = safeHostname(embedUrl);
  const imageSrc = frameImage ?? ogImage ?? (looksLikeImageUrl(embedUrl) ? embedUrl : undefined);

  if (imageSrc) {
    return {
      kind: "image",
      src: imageSrc,
      alt: title,
      eyebrow,
      title,
      description
    };
  }

  if (embedUrl) {
    return {
      kind: "link",
      eyebrow,
      title,
      description
    };
  }

  return undefined;
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
    authorName: author.display_name ?? author.username ?? `fid ${author.fid ?? "unknown"}`,
    authorHandle: author.username ?? String(author.fid ?? "unknown"),
    authorInitial: firstInitial(author.display_name, author.username),
    authorAvatarUrl: author.pfp_url,
    accentClass: "accent-live",
    timestamp,
    contextLabel: typeof channel.name === "string" ? `in ${channel.name}` : undefined,
    text: text || media?.description || media?.title || "Cast",
    permalink: undefined,
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

export async function loadFeedSnapshot(options: FeedLoadOptions = {}): Promise<FeedSnapshot> {
  const testApi = getHypecastTestApi();

  if (testApi?.loadFeedSnapshot) {
    return testApi.loadFeedSnapshot(options);
  }

  const cachedSnapshot = loadCachedSnapshot();
  const neynarApiKey = options.neynarApiKey?.trim();
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
