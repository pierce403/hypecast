import { describe, expect, it } from "vitest";

import { __test__ } from "./feed";

describe("feed media normalization", () => {
  it("treats image content types as image previews even without a file extension", () => {
    const result = __test__.normalizeNeynarEmbedMedia(
      {
        url: "https://cdn.example.com/media?id=42",
        metadata: {
          content_type: "image/jpeg"
        }
      },
      {
        text: "Direct image embed"
      }
    );

    expect(result?.score).toBe(4);
    expect(result?.media).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/media?id=42",
      title: "https://cdn.example.com/media?id=42",
      showDetails: false
    });
  });

  it("treats video content types as downloadable video media", () => {
    const result = __test__.normalizeNeynarEmbedMedia(
      {
        url: "https://cdn.example.com/media/video?id=7",
        metadata: {
          content_type: "video/mp4",
          image: "https://cdn.example.com/media/poster.jpg"
        }
      },
      {
        text: "Video embed"
      }
    );

    expect(result?.score).toBe(5);
    expect(result?.media).toMatchObject({
      kind: "video",
      src: "https://cdn.example.com/media/video?id=7",
      posterSrc: "https://cdn.example.com/media/poster.jpg",
      showDetails: false
    });
  });

  it("prefers a richer OG/image preview over an embedded cast fallback", () => {
    const media = __test__.normalizeNeynarMedia({
      text: "Check this out",
      embeds: [
        {
          cast: {
            author: {
              display_name: "Embedded Author",
              username: "embedded"
            },
            text: "Embedded cast fallback"
          }
        },
        {
          url: "https://example.com/story",
          metadata: {
            html: {
              ogTitle: "Story preview",
              ogDescription: "A richer preview should win.",
              ogImage: [{ url: "https://cdn.example.com/story-preview.jpg" }]
            }
          }
        }
      ]
    });

    expect(media).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/story-preview.jpg",
      href: "https://example.com/story",
      title: "Story preview",
      description: "A richer preview should win.",
      showDetails: true
    });
  });

  it("normalizes protocol-relative OG preview image URLs", () => {
    const result = __test__.normalizeNeynarEmbedMedia(
      {
        url: "https://example.com/post",
        metadata: {
          html: {
            ogTitle: "Protocol relative preview",
            ogDescription: "Should normalize to https.",
            ogImage: [{ url: "//cdn.example.com/preview.png" }]
          }
        }
      },
      {
        text: "Protocol relative test"
      }
    );

    expect(result?.media).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/preview.png",
      href: "https://example.com/post"
    });
  });

  it("rejects favicon-like OG images and falls back to a link preview", () => {
    const result = __test__.normalizeNeynarEmbedMedia(
      {
        url: "https://example.com/post",
        metadata: {
          html: {
            ogTitle: "Example article",
            ogDescription: "Should stay a link card.",
            ogImage: [{ url: "https://example.com/favicon.ico" }]
          }
        }
      },
      {
        text: "Link preview fallback"
      }
    );

    expect(result?.score).toBe(2);
    expect(result?.media).toMatchObject({
      kind: "link",
      title: "Example article",
      description: "Should stay a link card."
    });
  });

  it("sanitizes unsafe embed URLs instead of returning renderable media", () => {
    const result = __test__.normalizeNeynarEmbedMedia(
      {
        url: "javascript:alert(1)",
        metadata: {
          html: {
            ogTitle: "Unsafe preview",
            ogDescription: "Should be dropped.",
            ogImage: [{ url: "javascript:alert(1)" }]
          }
        }
      },
      {
        text: ""
      }
    );

    expect(result).toBeNull();
  });

  it("prefers a public cast image embed over an OG link image", () => {
    const media = __test__.normalizePublicMedia({
      text: "Public media test",
      channel: {
        name: "builders"
      },
      author: {
        displayName: "Public Author"
      },
      embeds: {
        images: [
          {
            url: "https://cdn.example.com/direct-image",
            alt: "Direct image alt"
          }
        ],
        urls: [
          {
            openGraph: {
              title: "OG title",
              description: "OG description",
              image: "https://cdn.example.com/og-preview.jpg"
            }
          }
        ]
      }
    });

    expect(media).toMatchObject({
      kind: "image",
      src: "https://cdn.example.com/direct-image",
      alt: "Direct image alt",
      href: "https://cdn.example.com/direct-image",
      title: "Public Author",
      showDetails: false
    });
  });
});
