import type { Address } from "viem";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface WalletState {
  status: "idle" | "connecting" | "connected" | "error";
  address?: Address;
  chainId?: number;
  chainName?: string;
  error?: string;
}

export interface FarcasterProfile {
  fid: number;
  username?: string;
  displayName?: string;
  bio?: string;
  pfpUrl?: string;
  custody?: Address;
}

export interface FarcasterState {
  status: "idle" | "creating" | "pending" | "connected" | "error";
  qrCodeDataUrl?: string;
  channelUrl?: string;
  profile?: FarcasterProfile;
  error?: string;
}

export interface XmtpState {
  status: "idle" | "connecting" | "connected" | "error";
  inboxId?: string;
  accountIdentifier?: string;
  error?: string;
}

export interface FeedMedia {
  kind: "image" | "video" | "link";
  src?: string;
  href?: string;
  posterSrc?: string;
  alt?: string;
  eyebrow?: string;
  title: string;
  description: string;
  showDetails?: boolean;
}

export interface FeedSource {
  id: string;
  label: string;
  username: string;
  displayName: string;
  pfpUrl?: string;
  bio?: string;
  accentClass?: string;
}

export interface FeedCast {
  id: string;
  channel: string;
  authorName: string;
  authorHandle: string;
  authorInitial: string;
  authorAvatarUrl?: string;
  accentClass?: string;
  timestamp: number;
  contextLabel?: string;
  text: string;
  permalink?: string;
  replies?: number;
  recasts?: number;
  reactions?: number;
  media?: FeedMedia;
}

export interface FeedLoadOptions {
  fid?: number;
  neynarApiKey?: string;
}

export interface FeedSnapshot {
  generatedAt: string;
  sources: FeedSource[];
  casts: FeedCast[];
  mode?: "public" | "following";
  provider?: "public-ssr" | "bundled" | "neynar";
  viewerFid?: number;
}

export interface FeedState {
  status: "idle" | "loading" | "ready" | "error";
  snapshot?: FeedSnapshot;
  error?: string;
}

export interface AppState {
  installPrompt: BeforeInstallPromptEvent | null;
  pwaInstalled: boolean;
  wallet: WalletState;
  farcaster: FarcasterState;
  xmtp: XmtpState;
  feed: FeedState;
}
