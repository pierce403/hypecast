import { expect, type Page } from "@playwright/test";
import type { Address } from "viem";

interface WalletMockOptions {
  error?: string;
  session?: {
    address?: Address;
    chainId?: number;
    chainName?: string;
  };
}

interface FarcasterMockOptions {
  channelError?: string;
  profileError?: string;
  profileDelayMs?: number;
  qrCodeDataUrl?: string;
  channel?: {
    channelToken?: string;
    url?: string;
    nonce?: string;
  };
  profile?: {
    fid?: number;
    username?: string;
    displayName?: string;
    bio?: string;
    pfpUrl?: string;
    custody?: Address;
  };
}

interface XmtpMockOptions {
  error?: string;
  session?: {
    inboxId?: string;
    accountIdentifier?: string;
    installationId?: string;
  };
}

export interface HypecastMockOptions {
  isStandalone?: boolean;
  wallet?: WalletMockOptions;
  farcaster?: FarcasterMockOptions;
  xmtp?: XmtpMockOptions;
}

export const defaultWalletAddress: Address = "0x1234567890abcdef1234567890abcdef12345678";

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

export async function mountApp(page: Page, options: HypecastMockOptions = {}): Promise<void> {
  await page.addInitScript((input: HypecastMockOptions) => {
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const svgDataUrl = (label: string) =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" rx="32" fill="#0b0b0e"/><text x="120" y="120" text-anchor="middle" dominant-baseline="middle" font-size="22" fill="#f6f6f8">${label}</text></svg>`
      )}`;

    const defaultWallet: { address: Address; chainId: number; chainName: string } = {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      chainId: 8453,
      chainName: "Base"
    };
    const defaultChannel = {
      channelToken: "channel-token",
      url: "https://warpcast.com/~/sign-in/hypecast",
      nonce: "testnonce123456"
    };
    const defaultProfile = {
      fid: 777,
      username: "ada",
      displayName: "Ada Lovelace",
      bio: "Writing tests for the feed shell.",
      pfpUrl: "",
      custody: defaultWallet.address as Address
    };
    const defaultXmtp = {
      inboxId: "inbox-987654321",
      accountIdentifier: defaultWallet.address.toLowerCase(),
      installationId: "installation-123"
    };

    window.__HYPECAST_TEST_API__ = {
      isStandalone: input.isStandalone,
      connectWallet: async () => {
        if (input.wallet?.error) {
          throw new Error(input.wallet.error);
        }

        return {
          ...defaultWallet,
          ...input.wallet?.session
        };
      },
      createFarcasterChannel: async () => {
        if (input.farcaster?.channelError) {
          throw new Error(input.farcaster.channelError);
        }

        return {
          ...defaultChannel,
          ...input.farcaster?.channel
        };
      },
      createChannelQrCode: async (url: string) => input.farcaster?.qrCodeDataUrl ?? svgDataUrl(url),
      waitForFarcasterProfile: async ({ onPoll }) => {
        onPoll?.();

        if (input.farcaster?.profileDelayMs) {
          await sleep(input.farcaster.profileDelayMs);
        }

        if (input.farcaster?.profileError) {
          throw new Error(input.farcaster.profileError);
        }

        return {
          ...defaultProfile,
          ...input.farcaster?.profile
        };
      },
      connectXmtp: async ({ address }) => {
        if (input.xmtp?.error) {
          throw new Error(input.xmtp.error);
        }

        return {
          ...defaultXmtp,
          accountIdentifier: address.toLowerCase(),
          ...input.xmtp?.session
        };
      }
    };
  }, options);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
}

export async function dispatchInstallPrompt(
  page: Page,
  outcome: "accepted" | "dismissed" = "accepted"
): Promise<void> {
  await page.evaluate((installOutcome) => {
    const promptEvent = new Event("beforeinstallprompt");

    Object.defineProperty(promptEvent, "prompt", {
      value: () => Promise.resolve()
    });
    Object.defineProperty(promptEvent, "userChoice", {
      value: Promise.resolve({
        outcome: installOutcome,
        platform: "web"
      })
    });

    window.dispatchEvent(promptEvent);
  }, outcome);
}
