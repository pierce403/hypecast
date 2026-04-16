import type { Address } from "viem";

import type {
  FarcasterProfile,
  FeedLoadOptions,
  FeedSnapshot
} from "./types";

export interface HypecastTestWalletSession {
  address: Address;
  chainId: number;
  chainName: string;
}

export interface HypecastTestFarcasterChannel {
  channelToken: string;
  url: string;
  nonce?: string;
}

export interface HypecastTestXmtpSession {
  inboxId: string;
  accountIdentifier: string;
  installationId?: string;
}

export interface HypecastTestApi {
  isStandalone?: boolean;
  loadFeedSnapshot?: (options?: FeedLoadOptions) => Promise<FeedSnapshot>;
  connectWallet?: () => Promise<HypecastTestWalletSession>;
  createFarcasterChannel?: (options: {
    domain: string;
    siweUri: string;
  }) => Promise<HypecastTestFarcasterChannel>;
  createChannelQrCode?: (url: string) => Promise<string>;
  waitForFarcasterProfile?: (options: {
    channelToken: string;
    domain: string;
    nonce: string;
    onPoll?: () => void;
  }) => Promise<FarcasterProfile>;
  connectFarcasterWriteAccess?: (options: {
    clientId: string;
    apiKey: string;
  }) => Promise<{
    fid?: number;
    signer_uuid?: string;
    user?: Record<string, unknown>;
  }>;
  publishReaction?: (options: {
    apiKey: string;
    signerUuid: string;
    reactionType: "like" | "recast";
    target: string;
    targetAuthorFid?: number;
    remove?: boolean;
  }) => Promise<void>;
  publishCast?: (options: {
    apiKey: string;
    signerUuid: string;
    text: string;
    parent?: string;
    parentAuthorFid?: number;
  }) => Promise<{ hash: string }>;
  connectXmtp?: (options: {
    address: Address;
    chainId: number;
    chainName: string;
  }) => Promise<HypecastTestXmtpSession>;
}

declare global {
  interface Window {
    __HYPECAST_TEST_API__?: HypecastTestApi;
  }
}

export function getHypecastTestApi(): HypecastTestApi | undefined {
  return window.__HYPECAST_TEST_API__;
}
