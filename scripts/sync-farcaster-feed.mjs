import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SOURCES = [
  {
    id: "farcaster",
    label: "farcaster",
    username: "farcaster",
    accentClass: "accent-violet"
  },
  {
    id: "v",
    label: "v",
    username: "v",
    accentClass: "accent-live"
  },
  {
    id: "dwr",
    label: "dwr",
    username: "dwr",
    accentClass: "accent-orange"
  },
  {
    id: "base",
    label: "base",
    username: "base.base.eth",
    accentClass: "accent-teal"
  }
];

const CASTS_PER_SOURCE = 3;
const OUTPUT_PATH = resolve(process.cwd(), "public/farcaster-feed.json");

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error("Could not find __NEXT_DATA__ in the Farcaster SSR page.");
  }

  return JSON.parse(match[1]);
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstInitial(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 1).toUpperCase();
    }
  }

  return "H";
}

function normalizeMedia(cast) {
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

function normalizeCast(source, cast) {
  const text = sanitizeText(cast?.embeds?.processedCastText || cast?.text);

  if (!text) {
    return null;
  }

  return {
    id: cast.hash,
    channel: source.id,
    authorName: cast.author?.displayName ?? source.displayName,
    authorHandle: cast.author?.username ?? source.username,
    authorInitial: firstInitial(cast.author?.displayName, cast.author?.username, source.displayName),
    authorAvatarUrl: cast.author?.pfp?.url ?? source.pfpUrl,
    accentClass: source.accentClass,
    timestamp: Number(cast.timestamp),
    contextLabel: cast.channel?.name ? `in ${cast.channel.name}` : `via ${source.label}`,
    text,
    replies: typeof cast.replies?.count === "number" ? cast.replies.count : undefined,
    recasts: typeof cast.recasts?.count === "number" ? cast.recasts.count : undefined,
    reactions: typeof cast.reactions?.count === "number" ? cast.reactions.count : undefined,
    media: normalizeMedia(cast)
  };
}

async function fetchSource(sourceConfig) {
  const response = await fetch(`https://ssr.farcaster.xyz/${sourceConfig.username}`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${sourceConfig.username} from Farcaster SSR with status ${response.status}.`
    );
  }

  const html = await response.text();
  const nextData = extractNextData(html);
  const pageProps = nextData?.props?.pageProps;
  const user = pageProps?.user;
  const rawCasts =
    pageProps?.recentCasts?.length > 0 ? pageProps.recentCasts : pageProps?.topCasts ?? [];

  if (!user || rawCasts.length === 0) {
    throw new Error(`Farcaster SSR page for ${sourceConfig.username} did not include casts.`);
  }

  const source = {
    id: sourceConfig.id,
    label: sourceConfig.label,
    username: user.username ?? sourceConfig.username,
    displayName: user.displayName ?? sourceConfig.label,
    pfpUrl: user.pfp?.url,
    bio: user.profile?.bio?.text,
    accentClass: sourceConfig.accentClass
  };

  const casts = rawCasts
    .slice(0, CASTS_PER_SOURCE)
    .map((cast) => normalizeCast(source, cast))
    .filter(Boolean);

  return {
    source,
    casts
  };
}

async function main() {
  const results = await Promise.all(SOURCES.map((source) => fetchSource(source)));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    sources: results.map((result) => result.source),
    casts: results
      .flatMap((result) => result.casts)
      .sort((left, right) => right.timestamp - left.timestamp)
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  console.log(
    `Wrote ${snapshot.casts.length} casts from ${snapshot.sources.length} sources to ${OUTPUT_PATH}.`
  );
}

await main();
