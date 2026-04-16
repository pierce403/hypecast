import { describe, expect, it } from "vitest";

import type { FeedCast } from "../types";
import { buildCastRouteUrl, parseCastRouteFromLocation } from "./routes";

const sampleCast: FeedCast = {
  id: "0xabc123",
  channel: "following",
  authorFid: 777,
  authorName: "Ada Lovelace",
  authorHandle: "ada",
  authorInitial: "A",
  timestamp: 1776310800000,
  text: "A routed cast."
};

describe("route helpers", () => {
  it("builds cast links with cast id and fid", () => {
    expect(buildCastRouteUrl("https://hypecast.net/?foo=bar#hash", sampleCast)).toBe(
      "https://hypecast.net/?cast=0xabc123&fid=777"
    );
  });

  it("parses internal cast routes from search params", () => {
    expect(
      parseCastRouteFromLocation({
        href: "https://hypecast.net/?fid=777&cast=0xabc123",
        search: "?fid=777&cast=0xabc123",
        hash: ""
      })
    ).toEqual({
      castId: "0xabc123",
      fid: 777
    });
  });

  it("parses hash-based internal routes", () => {
    expect(
      parseCastRouteFromLocation({
        href: "https://hypecast.net/#/casts/0xabc123",
        search: "",
        hash: "#/casts/0xabc123"
      })
    ).toEqual({
      castId: "0xabc123"
    });
  });

  it("parses Warpcast web URLs passed through the url param", () => {
    expect(
      parseCastRouteFromLocation({
        href: "https://hypecast.net/?url=https%3A%2F%2Fwarpcast.com%2Fada%2F0xabc123",
        search: "?url=https%3A%2F%2Fwarpcast.com%2Fada%2F0xabc123",
        hash: ""
      })
    ).toEqual({
      castId: "0xabc123"
    });
  });

  it("parses Farcaster mobile deep links passed through the url param", () => {
    expect(
      parseCastRouteFromLocation({
        href: "https://hypecast.net/?url=farcaster%3A%2F%2Fcasts%2F777%2F0xabc123",
        search: "?url=farcaster%3A%2F%2Fcasts%2F777%2F0xabc123",
        hash: ""
      })
    ).toEqual({
      castId: "0xabc123",
      fid: 777
    });
  });
});
