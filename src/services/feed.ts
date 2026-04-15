import { getHypecastTestApi } from "../test-support";
import type { FeedSnapshot } from "../types";

const FEED_SNAPSHOT_URL = `${import.meta.env.BASE_URL}farcaster-feed.json`;

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

export async function loadFeedSnapshot(): Promise<FeedSnapshot> {
  const testApi = getHypecastTestApi();

  if (testApi?.loadFeedSnapshot) {
    return testApi.loadFeedSnapshot();
  }

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

  return data;
}
