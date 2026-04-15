import type { FeedSnapshot } from "../src/types";

export const defaultFeedSnapshot: FeedSnapshot = {
  generatedAt: "2026-04-15T18:30:00.000Z",
  sources: [
    {
      id: "farcaster",
      label: "farcaster",
      username: "farcaster",
      displayName: "Farcaster",
      bio: "Enough with the bots.",
      pfpUrl: "https://example.com/farcaster.png",
      accentClass: "accent-violet"
    },
    {
      id: "v",
      label: "v",
      username: "v",
      displayName: "Varun Srinivasan",
      bio: "Building Farcaster.",
      pfpUrl: "https://example.com/v.png",
      accentClass: "accent-live"
    },
    {
      id: "dwr",
      label: "dwr",
      username: "dwr",
      displayName: "Dan Romero",
      bio: "Working on social software.",
      pfpUrl: "https://example.com/dwr.png",
      accentClass: "accent-orange"
    },
    {
      id: "base",
      label: "base",
      username: "base.base.eth",
      displayName: "Base",
      bio: "A place to build.",
      pfpUrl: "https://example.com/base.png",
      accentClass: "accent-teal"
    }
  ],
  casts: [
    {
      id: "cast-farcaster-snaps",
      channel: "farcaster",
      authorName: "Farcaster",
      authorHandle: "farcaster",
      authorInitial: "F",
      authorAvatarUrl: "https://example.com/farcaster.png",
      accentClass: "accent-violet",
      timestamp: 1775599170000,
      contextLabel: "in protocol",
      text: "introducing snaps. a new primitive for richer, interactive feed posts.",
      media: {
        kind: "link",
        eyebrow: "snap.host",
        title: "Snap Kitchen Sink",
        description: "Buttons, charts, toggles, and other interactive feed primitives."
      }
    },
    {
      id: "cast-v-elon",
      channel: "v",
      authorName: "Varun Srinivasan",
      authorHandle: "v",
      authorInitial: "V",
      authorAvatarUrl: "https://example.com/v.png",
      accentClass: "accent-live",
      timestamp: 1773935791000,
      contextLabel: "in product",
      text: "Elon likes the Farcasters.",
      media: {
        kind: "link",
        eyebrow: "x.com",
        title: "x.com/elonmusk/status/2034410549438755168",
        description: "Linked post discussing Farcaster."
      }
    },
    {
      id: "cast-dwr-lol",
      channel: "dwr",
      authorName: "Dan Romero",
      authorHandle: "dwr",
      authorInitial: "D",
      authorAvatarUrl: "https://example.com/dwr.png",
      accentClass: "accent-orange",
      timestamp: 1776168817000,
      contextLabel: "via dwr",
      text: "lol",
      media: {
        kind: "link",
        eyebrow: "x.com",
        title: "x.com/danywander/status/2044007186079044012",
        description: "Linked post from Dan Romero."
      }
    },
    {
      id: "cast-base-build",
      channel: "base",
      authorName: "Base",
      authorHandle: "base.base.eth",
      authorInitial: "B",
      authorAvatarUrl: "https://example.com/base.png",
      accentClass: "accent-teal",
      timestamp: 1776111000000,
      contextLabel: "in base",
      text: "Base builders are shipping another round of mini apps this week.",
      media: {
        kind: "image",
        src: "https://example.com/base-card.png",
        alt: "Base preview",
        eyebrow: "base.org",
        title: "Builder Week",
        description: "A visual preview for the latest Base app launch set."
      }
    },
    {
      id: "cast-farcaster-clients",
      channel: "farcaster",
      authorName: "Farcaster",
      authorHandle: "farcaster",
      authorInitial: "F",
      authorAvatarUrl: "https://example.com/farcaster.png",
      accentClass: "accent-violet",
      timestamp: 1775539200000,
      contextLabel: "in ecosystem",
      text: "clients can now render richer post actions without leaving the feed."
    },
    {
      id: "cast-v-launch",
      channel: "v",
      authorName: "Varun Srinivasan",
      authorHandle: "v",
      authorInitial: "V",
      authorAvatarUrl: "https://example.com/v.png",
      accentClass: "accent-live",
      timestamp: 1775480400000,
      contextLabel: "via v",
      text: "shipping another round of protocol and app performance work."
    }
  ]
};
