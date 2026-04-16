import { expect, type Page } from "@playwright/test";
import type { Address } from "viem";

import type { FeedSnapshot } from "../src/types";
import { defaultFeedSnapshot } from "./feed-fixture";

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

interface FeedMockOptions {
  delayMs?: number;
  error?: string;
  personalizedError?: string;
  personalizedSnapshot?: FeedSnapshot;
  snapshots?: FeedSnapshot[];
  snapshot?: FeedSnapshot;
}

export interface HypecastMockOptions {
  isStandalone?: boolean;
  feed?: FeedMockOptions;
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

export async function triggerPullToRefresh(page: Page): Promise<void> {
  await page.locator(".shell-content").evaluate((node) => {
    const dispatchTouch = (type: string, clientY: number) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      });

      Object.defineProperty(event, "touches", {
        configurable: true,
        value:
          type === "touchend" || type === "touchcancel"
            ? []
            : [{ clientY }]
      });
      Object.defineProperty(event, "changedTouches", {
        configurable: true,
        value: [{ clientY }]
      });

      node.dispatchEvent(event);
    };

    node.scrollTop = 0;
    dispatchTouch("touchstart", 140);
    dispatchTouch("touchmove", 360);
    dispatchTouch("touchend", 360);
  });
}

export async function mountApp(
  page: Page,
  options: HypecastMockOptions = {},
  path = "/"
): Promise<void> {
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
    let feedLoadCount = 0;

    window.__HYPECAST_TEST_API__ = {
      isStandalone: input.isStandalone,
      loadFeedSnapshot: async (options) => {
        feedLoadCount += 1;

        if (input.feed?.delayMs) {
          await sleep(input.feed.delayMs);
        }

        if (options?.fid && options?.neynarApiKey) {
          if (input.feed?.personalizedError) {
            throw new Error(input.feed.personalizedError);
          }

          const personalizedSnapshot = input.feed?.personalizedSnapshot ?? input.feed?.snapshot;

          if (!personalizedSnapshot) {
            throw new Error("No personalized feed snapshot mock configured.");
          }

          return personalizedSnapshot;
        }

        if (input.feed?.error) {
          throw new Error(input.feed.error);
        }

        const snapshotSequence = input.feed?.snapshots;
        const snapshot =
          snapshotSequence && snapshotSequence.length > 0
            ? snapshotSequence[Math.min(feedLoadCount - 1, snapshotSequence.length - 1)]
            : input.feed?.snapshot;

        if (!snapshot) {
          throw new Error("No feed snapshot mock configured.");
        }

        return snapshot;
      },
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
  }, {
    ...options,
    feed: {
      snapshot: options.feed?.snapshot ?? defaultFeedSnapshot,
      ...options.feed
    }
  });

  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect.poll(async () => page.locator(".timeline-tab").count()).toBeGreaterThan(1);
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
