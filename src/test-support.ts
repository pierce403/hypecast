import type { Address } from "viem";

import type { FarcasterProfile } from "./types";

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
