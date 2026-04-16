import { describe, expect, it } from "vitest";

import { __test__ } from "./video";

describe("inline video source detection", () => {
  it("detects HLS streams from the URL path", () => {
    expect(__test__.looksLikeHlsStream("https://cdn.example.com/stream/playlist.m3u8?token=1")).toBe(
      true
    );
  });

  it("detects HLS streams from the MIME type", () => {
    expect(
      __test__.looksLikeHlsStream(
        "https://cdn.example.com/stream?id=7",
        "application/vnd.apple.mpegurl"
      )
    ).toBe(true);
  });

  it("does not classify MP4 assets as HLS streams", () => {
    expect(__test__.looksLikeHlsStream("https://cdn.example.com/video/demo.mp4")).toBe(false);
  });
});
