import { expect, type Page } from "@playwright/test";
import type { Address } from "viem";

import type {
  HypecastTestFarcasterAccountQuote,
  HypecastTestFarcasterRegistration,
  HypecastTestLocalFarcasterSession
} from "../src/test-support";
import type { FarcasterProfile, FeedSnapshot } from "../src/types";
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
  exactProfile?: FarcasterProfile;
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

interface WriteMockOptions {
  clientId?: string;
  apiKey?: string;
  connectError?: string;
  reactionError?: string;
  castError?: string;
  session?: {
    fid?: number;
    signerUuid?: string;
    username?: string;
    displayName?: string;
    bio?: string;
    pfpUrl?: string;
  };
  preconnected?: boolean;
}

interface FarcasterAccountMockOptions {
  inspectError?: string;
  inspectDelaysMs?: number[];
  registerError?: string;
  quote?: Partial<HypecastTestFarcasterAccountQuote>;
  quotes?: Partial<HypecastTestFarcasterAccountQuote>[];
  registration?: Partial<HypecastTestFarcasterRegistration>;
}

interface LocalWriteMockOptions {
  apiKey?: string;
  connectError?: string;
  castError?: string;
  reactionError?: string;
  removeCastError?: string;
  linkError?: string;
  profileError?: string;
  session?: Partial<HypecastTestLocalFarcasterSession>;
  profile?: {
    fid?: number;
    username?: string;
    displayName?: string;
    bio?: string;
    pfpUrl?: string;
    custody?: Address;
  };
  preconnected?: boolean;
}

export interface HypecastMockOptions {
  isStandalone?: boolean;
  feed?: FeedMockOptions;
  wallet?: WalletMockOptions;
  farcaster?: FarcasterMockOptions;
  account?: FarcasterAccountMockOptions;
  localWrite?: LocalWriteMockOptions;
  write?: WriteMockOptions;
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
    const defaultWrite = {
      fid: defaultProfile.fid,
      signer_uuid: "7d88d5b3-5a07-4e25-a7d1-c2a8133177a9",
      user: {
        fid: defaultProfile.fid,
        username: defaultProfile.username,
        display_name: defaultProfile.displayName,
        pfp_url: defaultProfile.pfpUrl,
        profile: {
          bio: {
            text: defaultProfile.bio
          }
        }
      }
    };
    const defaultRecoveryAddress = "0x00000000fcb080a4d6c39a9354da9eb9bc104cd7" as Address;
    const defaultAccountQuote: HypecastTestFarcasterAccountQuote = {
      address: defaultWallet.address,
      recoveryAddress: defaultRecoveryAddress,
      balanceWei: "0",
      registrationPriceWei: "80142328119754",
      recommendedBalanceWei: "280142328119754",
      recommendedFundingWei: "280142328119754"
    };
    const defaultRegistration: HypecastTestFarcasterRegistration = {
      fid: 888,
      transactionHash: `0x${"a".repeat(64)}` as `0x${string}`
    };
    const localSignerSentinel = "playwright-local-signer";
    const defaultLocalSession: HypecastTestLocalFarcasterSession = {
      fid: defaultProfile.fid,
      custodyAddress: defaultWallet.address,
      signerKeyId: localSignerSentinel,
      signerPublicKey: `0x${"b".repeat(64)}` as `0x${string}`,
      apiKey: "playwright-local-api-key"
    };
    const localProfile = {
      ...defaultProfile,
      ...input.localWrite?.profile
    };
    const localSession = {
      ...defaultLocalSession,
      ...input.localWrite?.session,
      fid: input.localWrite?.session?.fid ?? input.localWrite?.profile?.fid ?? defaultLocalSession.fid,
      custodyAddress:
        input.localWrite?.session?.custodyAddress ??
        input.localWrite?.profile?.custody ??
        defaultLocalSession.custodyAddress,
      apiKey: input.localWrite?.apiKey ?? input.localWrite?.session?.apiKey ?? defaultLocalSession.apiKey
    };
    let feedLoadCount = 0;
    let accountInspectionCount = 0;
    let castPublishCount = 0;
    let signedCastPublishCount = 0;
    let registeredFid = input.account?.quote?.fid ?? input.account?.quotes?.[0]?.fid;
    let lastRegistrationTransactionHash: `0x${string}` | undefined;
    const localWriteCalls = {
      casts: [] as unknown[],
      reactions: [] as unknown[]
    };

    (
      window as Window & {
        __hypecastLocalWriteCalls?: typeof localWriteCalls;
      }
    ).__hypecastLocalWriteCalls = localWriteCalls;

    if (input.write?.clientId) {
      window.localStorage.setItem("hypecast:neynar-client-id", input.write.clientId);
    }

    if (input.write?.apiKey) {
      window.localStorage.setItem("hypecast:neynar-api-key", input.write.apiKey);
    }

    if (input.write?.preconnected && input.write?.clientId && input.write?.apiKey) {
      window.localStorage.setItem(
        "hypecast:farcaster-profile",
        JSON.stringify({
          fid: input.write.session?.fid ?? defaultProfile.fid,
          username: input.write.session?.username ?? defaultProfile.username,
          displayName: input.write.session?.displayName ?? defaultProfile.displayName,
          bio: input.write.session?.bio ?? defaultProfile.bio,
          pfpUrl: input.write.session?.pfpUrl ?? defaultProfile.pfpUrl,
          custody: defaultWallet.address
        })
      );
      window.localStorage.setItem(
        "hypecast:farcaster-write-session",
        JSON.stringify({
          fid: input.write.session?.fid ?? defaultProfile.fid,
          signerUuid: input.write.session?.signerUuid ?? defaultWrite.signer_uuid,
          clientId: input.write.clientId,
          apiKey: input.write.apiKey,
          username: input.write.session?.username ?? defaultProfile.username,
          displayName: input.write.session?.displayName ?? defaultProfile.displayName,
          bio: input.write.session?.bio ?? defaultProfile.bio,
          pfpUrl: input.write.session?.pfpUrl ?? defaultProfile.pfpUrl
        })
      );
    }

    if (input.localWrite?.preconnected) {
      window.localStorage.setItem(
        "hypecast:farcaster-profile",
        JSON.stringify({
          ...localProfile,
          fid: localSession.fid,
          custody: localSession.custodyAddress
        })
      );
      window.localStorage.setItem(
        "hypecast:farcaster-local-session",
        JSON.stringify(localSession)
      );
    }

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

        if (input.farcaster?.exactProfile) {
          return input.farcaster.exactProfile;
        }

        return {
          ...defaultProfile,
          ...input.farcaster?.profile
        };
      },
      inspectFarcasterAccount: async ({ address, recoveryAddress }) => {
        const inspectionIndex = accountInspectionCount;
        accountInspectionCount += 1;
        const quoteSequence = input.account?.quotes;
        const quote =
          quoteSequence && quoteSequence.length > 0
            ? quoteSequence[Math.min(inspectionIndex, quoteSequence.length - 1)]
            : input.account?.quote;
        const delayMs = input.account?.inspectDelaysMs?.[inspectionIndex] ?? 0;

        if (delayMs > 0) {
          await sleep(delayMs);
        }

        if (input.account?.inspectError) {
          throw new Error(input.account.inspectError);
        }

        return {
          ...defaultAccountQuote,
          address,
          recoveryAddress,
          ...quote,
          ...(registeredFid ? { fid: registeredFid } : {})
        };
      },
      registerFarcasterAccount: async () => {
        if (input.account?.registerError) {
          throw new Error(input.account.registerError);
        }

        const registration = {
          ...defaultRegistration,
          ...input.account?.registration
        };

        registeredFid = registration.fid;
        lastRegistrationTransactionHash = registration.transactionHash;
        return registration;
      },
      connectLocalFarcasterAccount: async ({
        fid,
        custodyAddress,
        registrationTransactionHash
      }) => {
        if (input.localWrite?.connectError) {
          throw new Error(input.localWrite.connectError);
        }

        if (
          lastRegistrationTransactionHash &&
          registrationTransactionHash !== lastRegistrationTransactionHash
        ) {
          throw new Error("The registration transaction hash was not forwarded to signer authorization.");
        }

        const connectedFid = registeredFid ?? fid ?? localSession.fid;

        return {
          ...localSession,
          fid: connectedFid,
          custodyAddress: (custodyAddress ?? localSession.custodyAddress) as Address
        };
      },
      publishSignedCast: async (options) => {
        if (input.localWrite?.castError) {
          throw new Error(input.localWrite.castError);
        }

        localWriteCalls.casts.push(options);
        signedCastPublishCount += 1;

        return {
          hash: `0x${String(signedCastPublishCount).padStart(40, "2")}`
        };
      },
      publishSignedReaction: async (options) => {
        if (input.localWrite?.reactionError) {
          throw new Error(input.localWrite.reactionError);
        }

        localWriteCalls.reactions.push(options);
      },
      removeSignedCast: async () => {
        if (input.localWrite?.removeCastError) {
          throw new Error(input.localWrite.removeCastError);
        }
      },
      publishSignedLink: async () => {
        if (input.localWrite?.linkError) {
          throw new Error(input.localWrite.linkError);
        }
      },
      publishSignedProfile: async () => {
        if (input.localWrite?.profileError) {
          throw new Error(input.localWrite.profileError);
        }
      },
      connectFarcasterWriteAccess: async ({ clientId, apiKey }) => {
        if (input.write?.connectError) {
          throw new Error(input.write.connectError);
        }

        return {
          ...defaultWrite,
          signer_uuid: input.write?.session?.signerUuid ?? defaultWrite.signer_uuid,
          fid: input.write?.session?.fid ?? defaultWrite.fid,
          user: {
            ...defaultWrite.user,
            fid: input.write?.session?.fid ?? defaultWrite.fid,
            username: input.write?.session?.username ?? defaultProfile.username,
            display_name: input.write?.session?.displayName ?? defaultProfile.displayName,
            pfp_url: input.write?.session?.pfpUrl ?? defaultProfile.pfpUrl,
            profile: {
              bio: {
                text: input.write?.session?.bio ?? defaultProfile.bio
              }
            }
          },
          clientId,
          apiKey
        };
      },
      publishReaction: async () => {
        if (input.write?.reactionError) {
          throw new Error(input.write.reactionError);
        }
      },
      publishCast: async () => {
        if (input.write?.castError) {
          throw new Error(input.write.castError);
        }

        castPublishCount += 1;

        return {
          hash: `0x${String(castPublishCount).padStart(40, "1")}`
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
