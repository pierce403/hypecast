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

export interface AppState {
  installPrompt: BeforeInstallPromptEvent | null;
  pwaInstalled: boolean;
  wallet: WalletState;
  farcaster: FarcasterState;
  xmtp: XmtpState;
}
