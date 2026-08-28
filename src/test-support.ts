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

export type HypecastTestFarcasterCustodySecretKind = "mnemonic" | "privateKey";

export interface HypecastTestFarcasterCustodyAccount {
  address: Address;
  privateKey: `0x${string}`;
  mnemonic?: string;
  kind: HypecastTestFarcasterCustodySecretKind;
}

export interface HypecastTestFarcasterAccountQuote {
  address: Address;
  recoveryAddress: Address;
  balanceWei: string;
  registrationPriceWei: string;
  recommendedBalanceWei: string;
  recommendedFundingWei: string;
  fid?: number;
}

export interface HypecastTestFarcasterRegistration {
  fid: number;
  transactionHash: `0x${string}`;
}

export interface HypecastTestLocalFarcasterSession {
  fid: number;
  custodyAddress: Address;
  signerKeyId: string;
  signerPublicKey: `0x${string}`;
  apiKey: string;
}

export interface HypecastTestLocalFarcasterConnection {
  session: HypecastTestLocalFarcasterSession;
  profile: FarcasterProfile;
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
  inspectFarcasterAccount?: (options: {
    address: Address;
    recoveryAddress: Address;
  }) => Promise<HypecastTestFarcasterAccountQuote>;
  registerFarcasterAccount?: (options: {
    account: HypecastTestFarcasterCustodyAccount;
    recoveryAddress: Address;
  }) => Promise<HypecastTestFarcasterRegistration>;
  connectLocalFarcasterAccount?: (options: {
    fid: number;
    custodyAddress?: string;
    registrationTransactionHash?: `0x${string}`;
  }) => Promise<Partial<HypecastTestLocalFarcasterSession> | void>;
  publishSignedCast?: (options: {
    text: string;
    parent?: { fid: number; hash: string } | { url: string };
  }) => Promise<{ hash?: string } | void>;
  publishSignedReaction?: (options: {
    reactionType: "like" | "recast";
    target: { fid: number; hash: string } | { url: string };
    remove?: boolean;
  }) => Promise<void>;
  removeSignedCast?: (options: {
    targetHash: string;
  }) => Promise<void>;
  publishSignedLink?: (options: {
    targetFid: number;
    type?: string;
    remove?: boolean;
  }) => Promise<void>;
  publishSignedProfile?: (options: {
    type:
      | "pfp"
      | "displayName"
      | "bio"
      | "url"
      | "username"
      | "location"
      | "twitter"
      | "github"
      | "banner"
      | "primaryAddressEthereum"
      | "primaryAddressSolana"
      | "profileToken"
      | "liveAt";
    value: string;
  }) => Promise<void>;
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
