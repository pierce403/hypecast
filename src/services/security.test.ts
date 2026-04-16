import { describe, expect, it } from "vitest";

import {
  escapeAttribute,
  escapeHtml,
  normalizePotentialUrl,
  sanitizeImageUrl,
  sanitizeLinkUrl
} from "./security";

describe("security helpers", () => {
  it("escapes untrusted HTML text", () => {
    expect(escapeHtml(`Tom & Jerry <script>alert("x")</script>`)).toBe(
      'Tom &amp; Jerry &lt;script&gt;alert("x")&lt;/script&gt;'
    );
  });

  it("escapes untrusted attribute values", () => {
    expect(escapeAttribute(`"hello" 'world' & <tag>`)).toBe(
      "&quot;hello&quot; &#39;world&#39; &amp; &lt;tag&gt;"
    );
  });

  it("normalizes protocol-relative URLs", () => {
    expect(normalizePotentialUrl(" //cdn.example.com/preview.png ")).toBe(
      "https://cdn.example.com/preview.png"
    );
  });

  it("allows standard https links", () => {
    expect(sanitizeLinkUrl("https://example.com/cast/123")).toBe("https://example.com/cast/123");
  });

  it("preserves allowed Farcaster deep-link protocols", () => {
    expect(sanitizeLinkUrl("warpcast://~/sign-in/hypecast")).toMatch(/^warpcast:/);
    expect(sanitizeLinkUrl("farcaster://profile/123")).toMatch(/^farcaster:/);
  });

  it("rejects unsafe link protocols", () => {
    expect(sanitizeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(sanitizeLinkUrl("file:///etc/passwd")).toBeUndefined();
  });

  it("allows https and protocol-relative image URLs", () => {
    expect(sanitizeImageUrl("//cdn.example.com/preview.png")).toBe(
      "https://cdn.example.com/preview.png"
    );
    expect(sanitizeImageUrl("https://images.example.com/photo")).toBe(
      "https://images.example.com/photo"
    );
  });

  it("allows data image URLs only when explicitly enabled", () => {
    const dataImage = "data:image/png;base64,abcd";

    expect(sanitizeImageUrl(dataImage)).toBeUndefined();
    expect(sanitizeImageUrl(dataImage, { allowDataImage: true })).toBe(dataImage);
  });

  it("rejects non-image data URLs and javascript image URLs", () => {
    expect(sanitizeImageUrl("data:text/html;base64,abcd", { allowDataImage: true })).toBeUndefined();
    expect(sanitizeImageUrl("javascript:alert(1)")).toBeUndefined();
  });
});
